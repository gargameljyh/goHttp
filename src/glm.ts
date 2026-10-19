export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GlmClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class GlmApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GlmApiError';
  }
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      role?: string;
      content?: string;
    };
  }[];
}

/** 智谱 GLM 开放平台聊天客户端（OpenAI 兼容的 /chat/completions 接口） */
export class GlmClient {
  constructor(private readonly options: GlmClientOptions) {}

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
        throw new GlmApiError(`GLM 请求超时（${this.options.timeoutMs}ms）`);
      }
      throw new GlmApiError(
        `GLM 请求失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new GlmApiError(`GLM HTTP ${response.status}: ${detail}`, response.status);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new GlmApiError('GLM 返回结果中没有可用的回复内容');
    }
    return content;
  }
}
