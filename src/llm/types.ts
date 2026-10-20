export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 单次调用的 token 用量（cachedTokens 是 promptTokens 中命中上下文缓存的部分） */
export interface LlmUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

export interface LlmStats extends LlmUsage {
  requests: number;
}

/** 所有厂商客户端实现的统一接口 */
export interface LlmClient {
  /** 发起一轮对话；返回模型回复文本 */
  chat(messages: ChatMessage[]): Promise<string>;
  /** 最近一次调用的用量；响应未带 usage 时为空 */
  readonly lastUsage: LlmUsage | undefined;
  getStats(): LlmStats;
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmApiError';
  }
}

export interface LlmClientOptions {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 单次响应最大输出 token（部分协议必填，如 Anthropic） */
  maxTokens: number;
  /** 每次调用拿到 usage 后回调（未返回 usage 的字段按 0 计） */
  onUsage?: (usage: LlmUsage) => void;
}

/** 各协议适配器共享的用量统计逻辑 */
export abstract class BaseLlmClient implements LlmClient {
  private readonly stats: LlmStats = { requests: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  private last?: LlmUsage;

  protected constructor(protected readonly options: LlmClientOptions) {}

  get lastUsage(): LlmUsage | undefined {
    return this.last;
  }

  getStats(): LlmStats {
    return { ...this.stats };
  }

  protected recordUsage(usage: LlmUsage): void {
    this.last = usage;
    this.stats.requests += 1;
    this.stats.promptTokens += usage.promptTokens;
    this.stats.cachedTokens += usage.cachedTokens;
    this.stats.completionTokens += usage.completionTokens;
    this.options.onUsage?.(usage);
  }

  protected fail(message: string, status?: number): never {
    throw new LlmApiError(`[${this.options.provider}] ${message}`, status);
  }

  abstract chat(messages: ChatMessage[]): Promise<string>;
}
