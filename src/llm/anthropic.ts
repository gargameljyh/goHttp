import { BaseLlmClient, type ChatMessage, type LlmClientOptions } from './types.js';

interface AnthropicResponse {
  content?: {
    type: string;
    text?: string;
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Anthropic 原生协议客户端（/messages）。
 * system prompt 提取为顶层参数，首条消息必须是 user，max_tokens 必填。
 */
export class AnthropicClient extends BaseLlmClient {
  constructor(options: LlmClientOptions) {
    super(options);
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
      .trim();

    // Anthropic 要求第一条对话消息必须是 user；丢弃开头的 assistant 消息
    const dialogue = messages
      .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
      .map((message) => ({ role: message.role, content: message.content }));
    while (dialogue.length > 0 && dialogue[0]!.role === 'assistant') {
      dialogue.shift();
    }
    if (dialogue.length === 0) {
      this.fail('没有可发送的对话内容（system 之外的消息为空）');
    }

    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          ...(system ? { system } : {}),
          messages: dialogue,
        }),
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

    const data = (await response.json()) as AnthropicResponse;
    const inputTokens = data.usage?.input_tokens ?? 0;
    const cacheRead = data.usage?.cache_read_input_tokens ?? 0;
    const cacheCreation = data.usage?.cache_creation_input_tokens ?? 0;
    this.recordUsage({
      // input_tokens 不含缓存命中的部分，三者相加才是完整输入
      promptTokens: inputTokens + cacheRead + cacheCreation,
      cachedTokens: cacheRead,
      completionTokens: data.usage?.output_tokens ?? 0,
    });
    const content = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (content.length === 0) {
      this.fail('返回结果中没有可用的回复内容');
    }
    return content;
  }
}
