import type { ChatMessage } from './llm/index.js';

/** 按会话 key（group:<id> / private:<id>）在内存中维护对话历史 */
export class SessionStore {
  private readonly history = new Map<string, ChatMessage[]>();

  constructor(private readonly limit: number) {}

  list(key: string): readonly ChatMessage[] {
    return this.history.get(key) ?? [];
  }

  append(key: string, message: ChatMessage): void {
    const list = this.history.get(key) ?? [];
    list.push(message);
    this.history.set(key, list.slice(-this.limit));
  }

  clear(key: string): void {
    this.history.delete(key);
  }
}
