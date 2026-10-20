import { AnthropicClient } from './anthropic.js';
import { OpenAiCompatibleClient } from './openai.js';
import type { LlmClient, LlmClientOptions } from './types.js';

/** 支持的协议实现 */
export type LlmProtocol = 'openai' | 'anthropic';

/** 厂商预设：协议 + 默认 baseUrl + 默认模型 */
export interface ProviderPreset {
  protocol: LlmProtocol;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  glm: { protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  deepseek: { protocol: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  kimi: { protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  qwen: { protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  openai: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  grok: { protocol: 'openai', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini' },
  anthropic: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
};

/** 解析 LLM_PROVIDER：内置预设名直接返回；未内置的按 OpenAI 兼容处理（需提供 LLM_BASE_URL） */
export function resolveProvider(name: string): ProviderPreset & { provider: string } {
  const key = name.toLowerCase();
  const preset = PROVIDER_PRESETS[key];
  if (preset) {
    return { provider: key, ...preset };
  }
  return { provider: key, protocol: 'openai', baseUrl: '', model: '' };
}

/** 按协议创建对应客户端 */
export function createLlmClient(options: LlmClientOptions & { protocol: LlmProtocol }): LlmClient {
  return options.protocol === 'anthropic'
    ? new AnthropicClient(options)
    : new OpenAiCompatibleClient(options);
}

export { AnthropicClient } from './anthropic.js';
export { OpenAiCompatibleClient } from './openai.js';
export {
  BaseLlmClient,
  LlmApiError,
  type ChatMessage,
  type LlmClient,
  type LlmClientOptions,
  type LlmStats,
  type LlmUsage,
} from './types.js';
