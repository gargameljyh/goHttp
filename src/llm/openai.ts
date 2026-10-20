import { BaseLlmClient, type ChatMessage, type LlmClientOptions, type LlmUsage } from './types.js';

interface ChatCompletionResponse {
  choices?: {
    message?: {
      role?: string;
      content?: string;
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

/**
 * OpenAI 兼容协议客户端（/chat/completions）。
 * 适用于 GLM、DeepSeek、Kimi、Qwen、OpenAI、Grok 等大多数厂商。
 */
export class OpenAiCompatibleClient extends BaseLlmClient {
  constructor(options: LlmClientOptions) {
    super(options);
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({ model: this.options.model, messages }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        this.fail(`请求超时（${this.options.timeoutMs}ms）`);
      }
      this.fail(`请求失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      this.fail(`HTTP ${response.status}: ${detail}`, response.status);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    this.recordUsage({
      promptTokens: data.usage?.prompt_tokens ?? 0,
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      this.fail('返回结果中没有可用的回复内容');
    }
    return content;
  }
}
