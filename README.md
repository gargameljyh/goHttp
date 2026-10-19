# goHttp (TypeScript)

QQ 群 AI 机器人：通过 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 的 `@snowluma/sdk` 接收 QQ 消息，调用智谱 GLM 大模型生成回复并发回聊天。

> 原 Java 版（go-cqhttp + 图灵机器人）已清空，代码在 git 历史中。

## 架构

```
QQ ⇄ SnowLuma 运行时 (OneBot v11, ws://127.0.0.1:3001)
              ⇄ 本项目 (@snowluma/sdk WebSocket 客户端)
                      ⇄ 智谱 GLM API (open.bigmodel.cn, OpenAI 兼容)
```

```
src/
  config.ts   环境变量 / .env 配置加载
  glm.ts      GLM /chat/completions 客户端（原生 fetch）
  session.ts  按会话（群/私聊）的内存对话历史
  bot.ts      SnowLuma 客户端与消息处理
  index.ts    入口
```

## 触发方式

- 群聊：`@机器人 你好`（去掉 @ 后的文本作为提问，回复时 @ 提问者）
- 私聊：直接发消息
- 命令：`/ai <问题>`（群聊、私聊通用）

每个群/私聊会话各自保留最近 `HISTORY_LIMIT` 条对话作为上下文（内存存储，重启清空）。

## 配置

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SNOWLUMA_WS_URL` | SnowLuma OneBot WebSocket 地址 | `ws://127.0.0.1:3001/` |
| `SNOWLUMA_TOKEN` | SnowLuma accessToken | 空（不鉴权） |
| `GLM_API_KEY` | 智谱开放平台 API Key，必填 | — |
| `GLM_BASE_URL` | GLM API 地址 | `https://open.bigmodel.cn/api/paas/v4` |
| `GLM_MODEL` | 模型名 | `glm-4-flash` |
| `BOT_SYSTEM_PROMPT` | 机器人人设 system prompt | 内置默认 |
| `HISTORY_LIMIT` | 每会话保留的历史条数 | `20` |

前提：本机需运行 SnowLuma 并已登录 QQ 账号、开启 OneBot WebSocket 连接（见 SnowLuma WebUI `http://localhost:5099`）。

## 运行

```bash
npm install
npm run dev        # tsx 热重载开发
npm run build      # 编译到 dist/
npm start          # 运行编译产物
npm run typecheck  # 仅类型检查
```
