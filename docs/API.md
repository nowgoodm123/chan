# HTTP / SSE API

启动：`chan serve`（默认 `http://127.0.0.1:4731`）。

鉴权：

- 未配置 `server.token` 时仅允许回环地址访问；
- 配置后，所有 `/api/*` 请求需要：

```http
Authorization: Bearer <token>
```

或 `?token=<token>`（方便首次打开页面）。

所有请求/响应均为 JSON（上传除外）。错误格式：

```json
{ "error": "message" }
```

## GET /api/health

```json
{
  "ok": true,
  "name": "chan_code",
  "version": "0.1.0",
  "cwd": "D:\\work\\app",
  "provider": "deepseek",
  "providers": ["deepseek", "openai", "anthropic", "ollama"],
  "platform": "win32",
  "node": "v22.14.0"
}
```

## GET /api/config

返回打码后的配置与 Provider 状态：

```json
{
  "config": { "defaultProvider": "deepseek", "providers": { "deepseek": { "apiKey": "sk-d***" } }, "agent": {}, "server": {} },
  "providers": [
    { "name": "deepseek", "label": "DeepSeek", "type": "openai", "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com/v1", "hasApiKey": true, "error": null }
  ],
  "defaultProvider": "deepseek"
}
```

## PUT /api/config

深合并并保存到 `~/.chan_code/config.json`。

```json
{
  "defaultProvider": "openai",
  "agent": { "approval": "ask", "maxSteps": 50 },
  "providers": { "openai": { "model": "gpt-4.1-mini", "apiKey": "sk-..." } },
  "server": { "token": "secret" }
}
```

返回 `{ "ok": true, "config": {...} }`。

## GET /api/models

```json
{ "defaultProvider": "deepseek", "providers": [ ... ] }
```

## GET /api/tools

返回工具名、描述与 JSON Schema。

## GET /api/sessions

```json
{
  "sessions": [
    { "id": "uuid", "title": "修复上传重试", "cwd": "D:\\work\\app", "provider": "deepseek", "model": "deepseek-chat", "createdAt": "...", "updatedAt": "...", "messageCount": 8, "usage": { "inputTokens": 1200, "outputTokens": 430, "totalTokens": 1630 } }
  ]
}
```

## POST /api/sessions

```json
{ "cwd": "D:\\work\\app", "provider": "deepseek", "model": "deepseek-chat", "approval": "auto" }
```

`cwd` 可选，必须是已存在目录，默认服务端工作目录。返回 201：

```json
{ "session": { "id": "uuid", "title": "New session", "messages": [], "todos": [] } }
```

## GET /api/sessions/:id

返回包含完整 `messages` 的会话（图片已回填 data URL）。不存在返回 404。

## PATCH /api/sessions/:id

```json
{ "title": "新标题", "provider": "openai", "model": "gpt-4o-mini", "approval": "deny" }
```

## DELETE /api/sessions/:id

```json
{ "ok": true }
```

## POST /api/sessions/:id/chat

核心接口，以 SSE 流式返回 Agent 事件。

请求：

```json
{
  "message": "修复这个 bug",
  "images": [
    { "name": "error.png", "mediaType": "image/png", "dataUrl": "data:image/png;base64,..." }
  ],
  "provider": "deepseek",
  "model": "deepseek-chat",
  "approval": "auto",
  "maxSteps": 40
}
```

响应头：`Content-Type: text/event-stream`。

事件格式：

```text
event: ready
data: {"sessionId":"...","title":"...","provider":"deepseek","model":"deepseek-chat","approval":"auto"}

event: step
data: {"type":"step","step":1,"maxSteps":40}

event: text-delta
data: {"type":"text-delta","text":"我来检查一下"}

event: tool-call
data: {"type":"tool-call","id":"call_1","name":"read","arguments":"{\"path\":\"src/a.ts\"}"}

event: tool-result
data: {"type":"tool-result","id":"call_1","name":"read","ok":true,"output":"...","durationMs":4}

event: approval-request
data: {"callId":"...","tool":"bash","command":"rm -rf build","danger":"recursive delete of root/home","requiresConfirmation":true}

event: done
data: {"type":"done","reason":"completed","steps":3,"usage":{...}}

event: session
data: {"session":{...}}

event: end
data: {"sessionId":"...","usage":{...}}
```

可能出现的其他事件：`reasoning-delta`、`assistant`、`warning`、`error`、`aborted`。

错误状态码：

| 状态 | 原因 |
| --- | --- |
| 400 | message 与 images 均为空，或超过长度限制 |
| 404 | 会话不存在 |
| 409 | 该会话已有进行中的请求 |
| 401 | Token 缺失或错误 |

### 浏览器端消费示例

```js
const res = await fetch(`/api/sessions/${id}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ message: 'hi' }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let i;
  while ((i = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, i);
    buffer = buffer.slice(i + 2);
    // 解析 event:/data: 行
  }
}
```

## POST /api/approve

```json
{ "callId": "uuid", "approved": true }
```

未知或过期的 callId 返回 404。

## POST /api/upload

```json
{ "name": "screenshot.png", "dataUrl": "data:image/png;base64,...", "cwd": "D:\\work\\app" }
```

成功：

```json
{ "path": ".chan/uploads/1712345678-screenshot.png", "absolute": "D:\\work\\app\\.chan\\uploads\\...", "size": 12345, "mediaType": "image/png", "name": "screenshot.png" }
```

限制：单文件 12MB；仅允许常见图片、PDF、文本与代码扩展名。

## 静态路由

| 路径 | 内容 |
| --- | --- |
| `/` | Web UI |
| `/assets/app.js` | 前端逻辑 |
| `/assets/style.css` | 样式 |
| `/about` | 介绍页（`site/index.html`） |
| `/healthz` | `ok` 纯文本，无鉴权 |
