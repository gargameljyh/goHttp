export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 单次调用的 token 用量（cachedTokens 是 promptTokens 中命中上下文缓存的部分） */
export interface GlmUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

export interface GlmStats extends GlmUsage {
  requests: number;
}

export interface GlmClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 每次调用拿到 usage 后回调（未返回 usage 的字段按 0 计） */
  onUsage?: (usage: GlmUsage) => void;
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
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

/** 智谱 GLM 开放平台聊天客户端（OpenAI 兼容的 /chat/completions 接口） */
export class GlmClient {
  private readonly stats: GlmStats = { requests: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  private last?: GlmUsage;

  constructor(private readonly options: GlmClientOptions) {}

  /** 最近一次调用的用量；响应未带 usage 时为空 */
  get lastUsage(): GlmUsage | undefined {
    return this.last;
  }

  getStats(): GlmStats {
    return { ...this.stats };
  }

  private recordUsage(data: ChatCompletionResponse): void {
    const usage: GlmUsage = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
    this.last = usage;
    this.stats.requests += 1;
    this.stats.promptTokens += usage.promptTokens;
    this.stats.cachedTokens += usage.cachedTokens;
    this.stats.completionTokens += usage.completionTokens;
    this.options.onUsage?.(usage);
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
    this.recordUsage(data);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new GlmApiError('GLM 返回结果中没有可用的回复内容');
    }
    return content;
  }
}
