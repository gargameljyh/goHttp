# goHttp (TypeScript)

QQ 群 AI 机器人：通过 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 的 `@snowluma/sdk` 接收 QQ 消息，调用大模型（GLM / DeepSeek / Kimi / 通义 / OpenAI / Grok / Claude 等）生成回复并发回聊天。

> 原 Java 版（go-cqhttp + 图灵机器人）已清空，代码在 git 历史中。

## 架构

```
QQ ⇄ SnowLuma 运行时 (OneBot v11, ws://127.0.0.1:3001)
              ⇄ 本项目 (@snowluma/sdk WebSocket 客户端)
                      ⇄ 任意大模型厂商（OpenAI 兼容协议或 Anthropic 协议）
```

```
src/
  config.ts   环境变量 / .env 配置加载
  llm/        大模型通用抽象
    types.ts      LlmClient 接口、用量统计基类
    openai.ts     OpenAI 兼容协议（/chat/completions，多数厂商）
    anthropic.ts  Anthropic 原生协议（/messages）
    index.ts      厂商预设表 + 客户端工厂
  session.ts  按会话（群/私聊）的内存对话历史
  memory.ts   长期记忆（JSONL 持久化 + 相似度检索）
  bot.ts      SnowLuma 客户端与消息处理
  patch-sdk.ts 启动时修补 @snowluma/sdk 的 ESM 导入（替代 postinstall）
  index.ts    入口（bin）
```

## 大模型厂商配置

通过 `LLM_PROVIDER` 切换厂商，内置预设自动带默认 API 地址和默认模型：

| LLM_PROVIDER | 协议 | 默认 API 地址 | 默认模型 |
| --- | --- | --- | --- |
| `glm` | OpenAI 兼容 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| `deepseek` | OpenAI 兼容 | `https://api.deepseek.com` | `deepseek-chat` |
| `kimi` | OpenAI 兼容 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| `qwen` | OpenAI 兼容 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| `openai` | OpenAI 兼容 | `https://api.openai.com/v1` | `gpt-4o-mini` |
| `grok` | OpenAI 兼容 | `https://api.x.ai/v1` | `grok-3-mini` |
| `anthropic` | Anthropic 原生 | `https://api.anthropic.com/v1` | `claude-sonnet-4-5` |

其它任意厂商（如硅基流动、OpenRouter、vLLM 自部署等）：`LLM_PROVIDER` 随便命名，按 OpenAI 兼容协议处理，但必须设置 `LLM_BASE_URL`。

缓存命中统计对两类协议统一：OpenAI 兼容读 `usage.prompt_tokens_details.cached_tokens`，Anthropic 读 `usage.cache_read_input_tokens`。

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
| `LLM_PROVIDER` | 大模型厂商，见上表 | `glm` |
| `LLM_API_KEY` | 对应厂商 API Key，必填 | — |
| `LLM_BASE_URL` | 覆盖默认 API 地址 | 厂商预设 |
| `LLM_MODEL` | 模型名 | 厂商预设 |
| `LLM_TIMEOUT_MS` | 请求超时（毫秒） | `60000` |
| `LLM_MAX_TOKENS` | 单次最大输出 token（Anthropic 协议必填） | `2048` |
| `BOT_SYSTEM_PROMPT` | 机器人人设 system prompt | 内置默认 |
| `BOT_PERSONA_FILE` | 角色卡 Markdown 文件路径（相对项目根目录），设置后作为 system prompt 加载并优先生效 | 空 |
| `HISTORY_LIMIT` | 每会话保留的历史条数 | `20` |

## 角色卡（skill）

`skills/firefly.skill/` 是《崩坏：星穹铁道》流萤的角色卡：`firefly_persona.md` 定义分层人设与说话风格，`references/plot dialogue.md` 收录原作对话 488 条（语感参考，未加载进 prompt）。`.env` 里默认通过 `BOT_PERSONA_FILE` 启用该人设，机器人会以流萤的口吻对话（保持角色、回复简短、不使用 Markdown）。换角色时把目录换成新的角色卡并改 `BOT_PERSONA_FILE` 即可。

前提：本机需运行 SnowLuma 并已登录 QQ 账号、开启 OneBot WebSocket 连接（见 SnowLuma WebUI `http://localhost:5099`）。

## 运行

**方式一：npx 直接运行**（需 Node 24+，首次会自动下载构建）

```bash
# 从 GitHub 仓库直接运行
npx github:gargameljyh/goHttp
# 发布到 npm 后
npx gohttp
```

npx 场景下在**当前目录**放一份 `.env`（参考 `.env.example`）即可；`BOT_PERSONA_FILE` 角色卡路径先按当前目录解析、找不到时回退到包内自带的 `skills/`；记忆数据写在当前目录 `data/` 下。启动时会自动修补 `@snowluma/sdk` 的 ESM 导入问题，无需其它操作。

**方式二：克隆安装**

```bash
npm install
npm run dev        # tsx 热重载开发
npm run build      # 编译到 dist/
npm start          # 运行编译产物
npm run typecheck  # 仅类型检查
```
