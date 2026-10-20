import {
  SnowLumaWebSocketClient,
  at,
  fromCQString,
  text,
  type SnowLumaEventContext,
} from '@snowluma/sdk';
import type { JsonValue, OneBotMessageEvent } from '@snowluma/sdk/types';
import type { AppConfig } from './config.js';
import { createLlmClient, type LlmUsage } from './llm/index.js';
import { extractMemories, MemoryStore, type MemoryEntry, type MemoryRefs } from './memory.js';
import { SessionStore } from './session.js';

interface SegmentLike {
  type: string;
  data: Record<string, unknown>;
}

function messageToSegments(message: JsonValue): SegmentLike[] {
  if (typeof message === 'string') {
    const parsed = fromCQString(message) as unknown as {
      toSegments?: () => SegmentLike[];
    };
    return typeof parsed.toSegments === 'function'
      ? parsed.toSegments()
      : (parsed as unknown as SegmentLike[]);
  }
  if (Array.isArray(message)) {
    return message as unknown as SegmentLike[];
  }
  return [];
}

function segmentsToText(segments: SegmentLike[]): string {
  return segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => String((segment.data as { text?: string }).text ?? ''))
    .join('')
    .trim();
}

/** 群消息里 @机器人 时，返回去掉 @ 段后的剩余文本；否则返回 null */
export function promptWhenAtBot(message: JsonValue, selfId: number): string | null {
  const segments = messageToSegments(message);
  const atBot = segments.some(
    (segment) =>
      segment.type === 'at' && String(segment.data['qq'] ?? '') === String(selfId),
  );
  if (!atBot) {
    return null;
  }
  return segmentsToText(segments);
}

function cachePercent(cached: number, prompt: number): number {
  return prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
}

function logUsage(usage: LlmUsage | undefined): void {
  if (!usage || usage.promptTokens === 0) {
    return;
  }
  console.log(
    `[llm] 输入 ${usage.promptTokens} tok｜缓存命中 ${usage.cachedTokens} tok（${cachePercent(usage.cachedTokens, usage.promptTokens)}%）`,
  );
}

function conversationKeyOf(event: OneBotMessageEvent): string {
  return event.message_type === 'group'
    ? `group:${(event as { group_id?: number }).group_id}`
    : `private:${event.user_id}`;
}

function refsOf(event: OneBotMessageEvent): MemoryRefs {
  return {
    userRef: event.user_id,
    groupRef: event.message_type === 'group' ? (event as { group_id?: number }).group_id ?? null : null,
  };
}

/** 把检索到的记忆格式化后追加到 system prompt */
function withMemory(systemPrompt: string, memories: readonly MemoryEntry[]): string {
  if (memories.length === 0) {
    return systemPrompt;
  }
  const lines = memories.map(
    (memory) =>
      `- ${memory.createdAt.slice(0, 10)} ${memory.scope === 'user' ? '关于用户' : '群记忆'}: ${memory.content}`,
  );
  return `${systemPrompt}\n\n## 长期记忆（自然地运用这些记忆，不要生硬罗列或复述）\n${lines.join('\n')}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBot(config: AppConfig): Promise<void> {
  const llm = createLlmClient(config.llm);
  const sessions = new SessionStore(config.historyLimit);
  const memoryStore = config.memory.enabled ? new MemoryStore(config.memory) : null;
  /** 每个会话积累待提取的对话轮次；busy 防止提取任务重叠 */
  const pendingExtractions = new Map<string, { exchanges: Array<{ user: string; assistant: string }>; busy: boolean }>();

  const bot = new SnowLumaWebSocketClient({
    url: config.snowluma.wsUrl,
    accessToken: config.snowluma.accessToken,
    reconnect: true,
    requestTimeoutMs: config.snowluma.requestTimeoutMs,
  });

  let selfId: number | null = null;

  function scheduleExtraction(conversationKey: string, refs: MemoryRefs, exchange: { user: string; assistant: string }): void {
    if (!memoryStore) {
      return;
    }
    const state = pendingExtractions.get(conversationKey) ?? { exchanges: [], busy: false };
    state.exchanges.push(exchange);
    pendingExtractions.set(conversationKey, state);
    if (state.busy || state.exchanges.length < config.memory.extractEvery) {
      return;
    }
    const batch = state.exchanges.splice(0, state.exchanges.length);
    state.busy = true;
    extractMemories(llm, batch, refs)
      .then((items) => {
        let added = 0;
        for (const item of items) {
          const ref = item.scope === 'group' ? refs.groupRef : refs.userRef;
          if (ref !== null && memoryStore.add(item.scope, ref, item.content)) {
            added += 1;
          }
        }
        if (added > 0) {
          console.log(`[memory] ${conversationKey} 新增 ${added} 条记忆`);
        }
      })
      .catch((error) => {
        console.warn('[memory] 提取失败:', error instanceof Error ? error.message : error);
      })
      .finally(() => {
        state.busy = false;
      });
  }

  async function answer(
    ctx: SnowLumaEventContext<OneBotMessageEvent>,
    conversationKey: string,
    prompt: string,
    senderId: number,
    mentionSender: boolean,
    refs: MemoryRefs,
  ): Promise<void> {
    if (!config.llm.apiKey) {
      await ctx.reply(text('还没有配置 LLM_API_KEY，无法调用大模型'));
      return;
    }

    const systemPrompt = memoryStore
      ? withMemory(
          config.llm.systemPrompt,
          memoryStore.search(prompt, refs, config.memory.injectLimit),
        )
      : config.llm.systemPrompt;

    try {
      const reply = await llm.chat([
        { role: 'system', content: systemPrompt },
        ...sessions.list(conversationKey),
        { role: 'user', content: prompt },
      ]);
      sessions.append(conversationKey, { role: 'user', content: prompt });
      sessions.append(conversationKey, { role: 'assistant', content: reply });
      console.log(`[bot] ${conversationKey} <- ${reply.slice(0, 120)}`);
      logUsage(llm.lastUsage);
      scheduleExtraction(conversationKey, refs, { user: prompt, assistant: reply });
      await ctx.reply(mentionSender ? at(senderId).text(` ${reply}`) : text(reply));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[bot] LLM 调用失败 (${conversationKey}):`, reason);
      const notice = `AI 调用失败：${reason.slice(0, 200)}`;
      await ctx
        .reply(mentionSender ? at(senderId).text(` ${notice}`) : text(notice))
        .catch(() => {});
    }
  }

  // 群聊：@机器人 + 问题
  bot.onGroupMessage(async (event, ctx) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    const prompt = selfId === null ? null : promptWhenAtBot(event.message, selfId);
    if (!prompt) {
      return;
    }
    await answer(ctx, `group:${event.group_id}`, prompt, event.user_id, true, refsOf(event));
  });

  // 私聊：所有文本消息都交给 GLM
  bot.onPrivateMessage(async (event, ctx) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    const prompt = segmentsToText(messageToSegments(event.message));
    if (!prompt) {
      return;
    }
    await answer(ctx, `private:${event.user_id}`, prompt, event.user_id, false, refsOf(event));
  });

  // 命令：/ai <问题>，群聊私聊通用
  bot.command('ai', async (event, ctx, match) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    if (!match.rest) {
      await ctx.reply(text('用法：/ai <问题>'));
      return;
    }
    await answer(
      ctx,
      conversationKeyOf(event),
      match.rest,
      event.user_id,
      event.message_type === 'group',
      refsOf(event),
    );
  });

  // 命令：/remember <内容>，手动为说话人记一条记忆
  bot.command('remember', async (event, ctx, match) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    if (!memoryStore) {
      await ctx.reply(text('记忆系统未启用（MEMORY_ENABLED=false）'));
      return;
    }
    if (!match.rest) {
      await ctx.reply(text('用法：/remember <要记住的内容>'));
      return;
    }
    memoryStore.add('user', event.user_id, match.rest);
    console.log(`[memory] 手动记忆 user:${event.user_id} <- ${match.rest.slice(0, 80)}`);
    await ctx.reply(text('嗯，我记住了。'));
  });

  // 命令：/forget <关键词>，删除当前对话范围内匹配的记忆
  bot.command('forget', async (event, ctx, match) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    if (!memoryStore) {
      await ctx.reply(text('记忆系统未启用（MEMORY_ENABLED=false）'));
      return;
    }
    if (!match.rest) {
      await ctx.reply(text('用法：/forget <关键词>'));
      return;
    }
    const removed = memoryStore.removeMatching(match.rest, refsOf(event));
    await ctx.reply(text(removed > 0 ? `已经忘掉 ${removed} 条相关记忆` : '没有找到相关记忆'));
  });

  // 命令：/memories，查看当前对话范围内的记忆
  bot.command('memories', async (event, ctx) => {
    if (event.post_type === 'message_sent' || event.user_id === selfId) {
      return;
    }
    if (!memoryStore) {
      await ctx.reply(text('记忆系统未启用（MEMORY_ENABLED=false）'));
      return;
    }
    const memories = memoryStore.list(refsOf(event));
    if (memories.length === 0) {
      await ctx.reply(text('关于这边，我暂时还没有记住什么'));
      return;
    }
    const lines = memories.map(
      (memory, index) => `${index + 1}. ${memory.scope === 'user' ? '关于用户' : '群记忆'}: ${memory.content}`,
    );
    await ctx.reply(text(`我记住的（最近用过的在前）：\n${lines.join('\n')}`));
  });

  bot.on('open', () => {
    console.log(`[bot] 已连接 SnowLuma: ${config.snowluma.wsUrl}`);
  });
  bot.on('close', ({ code, reason }) => {
    console.warn(`[bot] 连接断开 code=${code}${reason ? ` reason=${reason}` : ''}，自动重连中`);
  });
  bot.on('error', (error) => {
    console.warn('[bot] 连接错误:', error instanceof Error ? error.message : error);
  });

  for (let attempt = 1; ; attempt++) {
    try {
      await bot.connect();
      break;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[bot] 连接 SnowLuma 失败（第 ${attempt} 次）：${reason}，5 秒后重试`);
      await delay(5_000);
    }
  }

  try {
    const login = await bot.getLoginInfo();
    selfId = login.user_id;
    console.log(`[bot] 机器人账号: ${selfId} (${login.nickname})`);
  } catch (error) {
    console.warn('[bot] 获取登录信息失败，@机器人 触发方式不可用:', error);
  }

  const shutdown = () => {
    const stats = llm.getStats();
    if (stats.requests > 0) {
      console.log(
        `[llm] 累计 ${stats.requests} 次调用：输入 ${stats.promptTokens} tok，缓存命中 ${stats.cachedTokens} tok（${cachePercent(stats.cachedTokens, stats.promptTokens)}%），输出 ${stats.completionTokens} tok`,
      );
    }
    console.log('[bot] 正在退出');
    bot.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
