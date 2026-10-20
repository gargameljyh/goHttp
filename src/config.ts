// Node 20.12+ 内置 .env 加载；文件不存在时忽略
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 文件，直接使用环境变量
}

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProvider, PROVIDER_PRESETS, type LlmProtocol } from './llm/index.js';

/** 包根目录：源码运行（src/）与编译运行（dist/）都向上两级即项目根 */
const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../../', import.meta.url)));

export interface AppConfig {
  snowluma: {
    wsUrl: string;
    accessToken: string | undefined;
    requestTimeoutMs: number;
  };
  llm: {
    provider: string;
    protocol: LlmProtocol;
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    /** 单次响应最大输出 token（Anthropic 协议必填） */
    maxTokens: number;
    systemPrompt: string;
  };
  /** 每个会话保留的历史消息条数 */
  historyLimit: number;
  memory: {
    enabled: boolean;
    /** 记忆文件目录（相对项目根目录） */
    dir: string;
    /** 每积累多少轮对话后触发一次自动提取 */
    extractEvery: number;
    /** 单次回复最多注入的记忆条数 */
    injectLimit: number;
    /** 单个用户/群最多保留的记忆条数 */
    maxPerUser: number;
  };
}

/** 追加在角色人设文件之后的 QQ 场景适配说明 */
const QQ_SCENE_SUFFIX = `

---

## 场景适配（QQ 聊天）

你现在通过 QQ 与大家聊天。请遵守：
- 始终保持当前角色卡的身份回复，不要提及自己是 AI、模型或助手
- 像对待开拓者那样，温柔地对待每一位和你聊天的人
- QQ 消息要简短自然，通常 1~3 句话，不要长篇大论，不要使用 Markdown 格式
- 语气轻松日常，可以自然地使用「嘿嘿」「嗯…」「那个…」等语气词
- 遇到与角色设定无关的问题时，也以角色口吻尽力回答
`;

/** 优先级：BOT_PERSONA_FILE > BOT_SYSTEM_PROMPT > 内置默认 */
function loadSystemPrompt(): string {
  const personaFile = process.env.BOT_PERSONA_FILE?.trim();
  if (personaFile) {
    // 先按当前工作目录解析（支持外部角色卡），找不到再回退到包内自带角色卡
    const cwdPath = resolve(process.cwd(), personaFile);
    const fullPath = existsSync(cwdPath) ? cwdPath : resolve(PACKAGE_ROOT, personaFile);
    try {
      return readFileSync(fullPath, 'utf8').trim() + QQ_SCENE_SUFFIX;
    } catch {
      console.warn(`[config] 无法读取 BOT_PERSONA_FILE（${fullPath}），回退到默认 system prompt`);
    }
  }
  return (
    process.env.BOT_SYSTEM_PROMPT ??
    '你是一个运行在 QQ 里的智能助手，用中文回答，风格友好，回答保持简洁。'
  );
}

function intEnv(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} 必须是不小于 ${min} 的整数`);
  }
  return value;
}

/** 读取环境变量；空白值视为未设置（避免 .env 里的空串覆盖预设） */
function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * 解析 LLM 配置。
 * 变量：LLM_PROVIDER / LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_TIMEOUT_MS / LLM_MAX_TOKENS
 */
function loadLlmConfig(): AppConfig['llm'] {
  const preset = resolveProvider(envValue('LLM_PROVIDER') ?? 'glm');

  const baseUrl = envValue('LLM_BASE_URL') ?? preset.baseUrl;
  if (!baseUrl) {
    const known = Object.keys(PROVIDER_PRESETS).join('、');
    throw new Error(
      `LLM_PROVIDER=${preset.provider} 不是内置厂商（${known}），必须额外设置 LLM_BASE_URL 指定其 OpenAI 兼容接口地址`,
    );
  }

  const model = envValue('LLM_MODEL') ?? preset.model;
  const apiKey = envValue('LLM_API_KEY') ?? '';
  if (!apiKey) {
    console.warn(`[config] 未设置 LLM_API_KEY（厂商 ${preset.provider}），收到提问时将无法调用大模型`);
  }

  return {
    provider: preset.provider,
    protocol: preset.protocol,
    apiKey,
    baseUrl,
    model,
    timeoutMs: intEnv('LLM_TIMEOUT_MS', 60_000, 1_000),
    maxTokens: intEnv('LLM_MAX_TOKENS', 2_048, 1),
    systemPrompt: loadSystemPrompt(),
  };
}

export function loadConfig(): AppConfig {
  const historyLimit = Number(process.env.HISTORY_LIMIT ?? 20);
  if (!Number.isInteger(historyLimit) || historyLimit < 2) {
    throw new Error('HISTORY_LIMIT 必须是不小于 2 的整数');
  }

  return {
    snowluma: {
      wsUrl: process.env.SNOWLUMA_WS_URL ?? 'ws://127.0.0.1:3001/',
      accessToken: process.env.SNOWLUMA_TOKEN || undefined,
      requestTimeoutMs: 30_000,
    },
    llm: loadLlmConfig(),
    historyLimit,
    memory: {
      enabled: process.env.MEMORY_ENABLED !== 'false',
      dir: process.env.MEMORY_DIR ?? 'data/memory',
      extractEvery: intEnv('MEMORY_EXTRACT_EVERY', 5, 1),
      injectLimit: intEnv('MEMORY_INJECT_LIMIT', 8, 1),
      maxPerUser: intEnv('MEMORY_MAX_PER_USER', 50, 5),
    },
  };
}
