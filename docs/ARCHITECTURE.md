# 架构说明

## 总览

```text
┌─────────────┐     ┌─────────────┐
│  CLI / REPL │     │  Web UI     │
│  (src/cli)  │     │ (src/server/web)
└──────┬──────┘     └──────┬──────┘
       │                   │ HTTP + SSE
       │                   ▼
       │            ┌─────────────┐
       └───────────▶│   Agent     │
                    │ (src/agent) │
                    └──┬───┬───┬──┘
                       │   │   │
          ┌────────────┘   │   └────────────┐
          ▼                ▼                ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │ Providers │    │   Tools   │    │ Sessions  │
    │ openai /  │    │ read/edit │    │  per-cwd  │
    │ anthropic │    │ bash/...  │    │  JSON     │
    └───────────┘    └───────────┘    └───────────┘
```

同一套 Agent 核心同时服务终端与浏览器，避免两套行为不一致。

## 消息模型

内部使用统一的消息格式，Provider 负责转换：

```js
// 用户
{ role: 'user', content: 'text', images: [{ name, mediaType, dataUrl, path }] }

// 助手（文本 + 可选工具调用）
{ role: 'assistant', content: '...', toolCalls: [{ id, name, arguments }], reasoning?: '...' }

// 工具结果（严格按 toolCallId 对应）
{ role: 'tool', toolCallId: '...', name: 'read', content: '...' }

// 系统提示单独传递
runAgent({ system, messages })
```

OpenAI：转换为 `system` 消息、`tool_calls`、`role: 'tool'`、图片 `image_url`。
Anthropic：转换为 `system` 字段、`tool_use` / `tool_result` 内容块、图片 base64 块；连续 tool_result 会合并进同一个 user 消息。

## Agent 主循环

`src/agent.js` 的 `runAgent()` 是异步生成器，逐事件输出：

```js
while (steps < maxSteps) {
  for await (event of provider.stream(...)) { 收集文本 / 工具调用 / usage }
  追加 assistant 消息
  若无工具调用 → 结束
  顺序执行每个工具：
    - 解析参数（非法 JSON → 错误结果）
    - 查找工具（未知 → 错误结果）
    - 相同 name+args 重复 3 次 → 判定循环并停止
    - 执行，异常转成 "Error: ..." 结果
    - 追加 tool 消息，继续下一轮
}
```

事件类型：

| 事件 | 说明 |
| --- | --- |
| `step` | 新回合开始 |
| `text-delta` | 文本增量 |
| `reasoning-delta` | 推理/思考增量（如 DeepSeek R1、Claude thinking） |
| `assistant` | 一条完整 assistant 消息（文本 + toolCalls + 用量） |
| `tool-call` | 即将执行工具（含参数） |
| `tool-result` | 工具结果（ok、output、durationMs） |
| `warning` | 例如触达步数上限 |
| `error` | Provider 错误 |
| `done` | 结束，附带 reason、steps、usage、messages |

终端直接消费这些事件渲染；服务端把它们编码成 SSE 转发给浏览器。

## 扩展运行时（runtime）

`src/runtime.js` 在每次对话前组装：

1. `loadSkills()` 扫描 `.chan/skills`、全局目录与兼容目录；
2. `loadAgents()` 加载内置 build/plan/explore/general 与自定义 Agent；
3. `McpManager.ready()` 返回已连接的 MCP 工具适配器；
4. `createTools()` 合并 base 工具、`skill`、`subagent` 与 MCP 工具（按 Agent 的 `tools` 白名单过滤 base 工具）；
5. `buildSystemPrompt()` 追加技能与可用子 Agent 列表。

主 Agent 通过 `subagent` 工具调用 `createRuntime()` 创建子运行时：使用子会话、独立 messages、子 Agent 的工具白名单与模型，`depth=1` 时不再注入 `subagent` 工具，从而限制嵌套。子 Agent 的事件不流式转发，只把最终文本与步数/工具数汇总回父会话。

MCP 管理器（`src/mcp/`）在 CLI 启动或 Web 首次对话时初始化，连接失败只记录状态，不影响 Agent 启动；`/mcps refresh` 或 `POST /api/mcp/refresh` 可重建连接。

## 流式协议解析

`src/util/sse.js` 自己实现 SSE 分帧（不依赖库），正确处理：

- 跨网络分片的事件行；
- `\r\n` 与 `\n`；
- 多行 `data:`；
- 注释行 `:`；
- `[DONE]` 结束标记。

OpenAI 工具调用按 `index` 聚合 `id`、`name`、`arguments` 增量；Anthropic 按 `content_block` 的 `index` 聚合 `input_json_delta`，`content_block_stop` 时生成完整调用。

## 会话持久化

- 目录：`~/.chan_code/sessions/<sha1(workspace).slice(0,12)>/<uuid>.json`
- 内容：标题、provider/model、approval、messages、todos、usage、时间戳。
- 标题：首条用户消息截断生成。
- 图片：上传文件保存在 `<workspace>/.chan/uploads`，会话落盘时剥离 `dataUrl`，只存 `path`；加载时从磁盘回填 base64，避免会话文件膨胀。
- 恢复：`chan --resume <id>`、REPL `/resume <id>`、Web 侧边栏点击。

## 审批与安全

`approval` 模式在工具执行前决定：

- `auto`：普通命令直接执行；危险命令（`DANGEROUS_PATTERNS`）触发审批。
- `ask`：所有 bash 都审批。
- `deny`：bash 直接拒绝。

CLI：通过同一个 readline 接口询问 `approve ...? [y/N]`。
Web：SSE 下发 `approval-request`，浏览器 POST `/api/approve`，服务端用 `callId` 匹配 Promise 并在 5 分钟超时后默认拒绝。

路径安全由 `resolveWorkspacePath` 统一保证（大小写不敏感的 Windows 也能正确处理）。

## Web 服务

`src/server/server.js` 只是一个类：

```js
const server = new ChanServer({ cwd, config, providerFactory });
const info = await server.listen({ port: 4731, host: '127.0.0.1' });
```

- 通过构造参数注入 `providerFactory`，测试时替换为假 Provider，无需网络。
- API 与静态资源同一端口；`/` 返回 Web UI，`/about` 返回介绍页。
- 鉴权：未设置 token 时只允许回环地址；设置 token 后 `/api/*` 必须携带 Bearer 或 query token。
- 同一会话同时只允许一个进行中的对话（`inFlight`），重复请求返回 409。
- 客户端断开（关闭页面/Stop）→ 服务端 `res.on('close')` 触发 AbortController，终止模型流与工具。

## 扩展点

| 想做什么 | 改哪里 |
| --- | --- |
| 新 Provider 协议 | `src/providers/`，实现 `stream()` 异步生成器 |
| 新工具 | `src/tools/<name>.js` + 在 `ALL_TOOLS` 注册 |
| 新扩展类型 | 参考 `src/skills.js` / `src/commands.js` / `src/agents.js`，在 `createRuntime` 组装 |
| 新 MCP 传输 | 实现 `src/mcp/client.js` 的 `start/initialize/listTools/callTool/close` |
| 新 CLI 命令 | `src/cli/main.js` 的命令表与处理函数 |
| 新 Web 接口 | `src/server/server.js` 的 `handleApi` |
| 新会话字段 | `src/sessions.js`（注意图片落盘策略） |

## 设计取舍

- **零依赖**：安装体积小、供应链风险低、审查容易；代价是自己维护 SSE/glob/HTTP 重试等少量代码。
- **统一消息格式**：Provider 转换在边界处完成，Agent 核心不感知厂商差异。
- **默认本机监听 + 显式 Token**：浏览器 UI 是强能力入口，默认不应暴露到局域网。
- **工具即函数**：每个工具独立文件、独立测试，便于增加与替换。
