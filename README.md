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

## 记忆系统

机器人在对话之外维护**长期记忆**（文件持久化，重启不丢）：

- **自动提取**：每个会话每积累 `MEMORY_EXTRACT_EVERY` 轮对话，后台调用一次 GLM 提取值得长期记住的事实（用户称呼、喜好、约定、进行中的事），去重后存入 `data/memory/memories.jsonl`
- **检索注入**：每次回复前按与当前提问的相似度检索相关记忆（只检索当前说话人/所在群的记忆，避免跨用户泄露），注入 system prompt
- **容量控制**：单个用户/群最多 `MEMORY_MAX_PER_USER` 条，超出淘汰命中最少且最旧的
- **手动管理**（群聊私聊通用）：
  - `/remember <内容>` —— 手动记一条关于自己的记忆
  - `/forget <关键词>` —— 删除匹配的记忆
  - `/memories` —— 查看当前对话相关的记忆

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MEMORY_ENABLED` | 是否启用记忆系统 | `true` |
| `MEMORY_DIR` | 记忆文件目录 | `data/memory` |
| `MEMORY_EXTRACT_EVERY` | 每多少轮对话提取一次 | `5` |
| `MEMORY_INJECT_LIMIT` | 单次回复最多注入条数 | `8` |
| `MEMORY_MAX_PER_USER` | 单个用户/群容量上限 | `50` |

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
| `BOT_PERSONA_FILE` | 角色卡 Markdown 文件路径（相对项目根目录），设置后作为 system prompt 加载并优先生效 | 空 |
| `HISTORY_LIMIT` | 每会话保留的历史条数 | `20` |

## 角色卡（skill）

`skills/firefly.skill/` 是《崩坏：星穹铁道》流萤的角色卡：`firefly_persona.md` 定义分层人设与说话风格，`references/plot dialogue.md` 收录原作对话 488 条（语感参考，未加载进 prompt）。`.env` 里默认通过 `BOT_PERSONA_FILE` 启用该人设，机器人会以流萤的口吻对话（保持角色、回复简短、不使用 Markdown）。换角色时把目录换成新的角色卡并改 `BOT_PERSONA_FILE` 即可。

前提：本机需运行 SnowLuma 并已登录 QQ 账号、开启 OneBot WebSocket 连接（见 SnowLuma WebUI `http://localhost:5099`）。

## 运行

```bash
npm install
npm run dev        # tsx 热重载开发
npm run build      # 编译到 dist/
npm start          # 运行编译产物
npm run typecheck  # 仅类型检查
```
