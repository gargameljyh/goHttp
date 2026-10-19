import {
  SnowLumaWebSocketClient,
  at,
  fromCQString,
  text,
  type SnowLumaEventContext,
} from '@snowluma/sdk';
import type { JsonValue, OneBotMessageEvent } from '@snowluma/sdk/types';
import type { AppConfig } from './config.js';
import { GlmClient } from './glm.js';
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

function conversationKeyOf(event: OneBotMessageEvent): string {
  return event.message_type === 'group'
    ? `group:${(event as { group_id?: number }).group_id}`
    : `private:${event.user_id}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBot(config: AppConfig): Promise<void> {
  const glm = new GlmClient(config.glm);
  const sessions = new SessionStore(config.historyLimit);

  const bot = new SnowLumaWebSocketClient({
    url: config.snowluma.wsUrl,
    accessToken: config.snowluma.accessToken,
    reconnect: true,
    requestTimeoutMs: config.snowluma.requestTimeoutMs,
  });

  let selfId: number | null = null;

  async function answer(
    ctx: SnowLumaEventContext<OneBotMessageEvent>,
    conversationKey: string,
    prompt: string,
    senderId: number,
    mentionSender: boolean,
  ): Promise<void> {
    if (!config.glm.apiKey) {
      await ctx.reply(text('还没有配置 GLM_API_KEY，无法调用大模型'));
      return;
    }

    try {
      const reply = await glm.chat([
        { role: 'system', content: config.glm.systemPrompt },
        ...sessions.list(conversationKey),
        { role: 'user', content: prompt },
      ]);
      sessions.append(conversationKey, { role: 'user', content: prompt });
      sessions.append(conversationKey, { role: 'assistant', content: reply });
      console.log(`[bot] ${conversationKey} <- ${reply.slice(0, 120)}`);
      await ctx.reply(mentionSender ? at(senderId).text(` ${reply}`) : text(reply));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[bot] GLM 调用失败 (${conversationKey}):`, reason);
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
    await answer(ctx, `group:${event.group_id}`, prompt, event.user_id, true);
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
    await answer(ctx, `private:${event.user_id}`, prompt, event.user_id, false);
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
    );
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
    console.log('[bot] 正在退出');
    bot.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
