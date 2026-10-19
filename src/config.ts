// Node 20.12+ 内置 .env 加载；文件不存在时忽略
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 文件，直接使用环境变量
}

export interface AppConfig {
  snowluma: {
    wsUrl: string;
    accessToken: string | undefined;
    requestTimeoutMs: number;
  };
  glm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    systemPrompt: string;
  };
  /** 每个会话保留的历史消息条数 */
  historyLimit: number;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.GLM_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[config] 未设置 GLM_API_KEY，收到提问时将无法调用大模型');
  }

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
    glm: {
      apiKey,
      baseUrl: process.env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
      model: process.env.GLM_MODEL ?? 'glm-4-flash',
      timeoutMs: 60_000,
      systemPrompt:
        process.env.BOT_SYSTEM_PROMPT ??
        '你是一个运行在 QQ 里的智能助手，用中文回答，风格友好，回答保持简洁。',
    },
    historyLimit,
  };
}
