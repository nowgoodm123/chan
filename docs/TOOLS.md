# 工具参考

所有工具都在工作目录（workspace）内运行，结果会返回给模型作为下一步的依据。单个结果默认截断到 `agent.maxOutputChars`（20000 字符）。

## read

读取文本文件，返回带行号的片段。

```json
{ "path": "src/app.js", "offset": 1, "limit": 2000 }
```

- `offset` 从 1 开始，默认 1；`limit` 默认 2000 行。
- 二进制/图片不会当作文本读取，会返回说明。
- 目录请用 `list`。

## write

创建或覆盖文件，自动创建父目录。

```json
{ "path": "src/new.ts", "content": "export const x = 1;\n" }
```

小修改优先用 `edit`，避免整体重写。

## edit

精确字符串替换。

```json
{ "path": "src/app.js", "oldString": "const a = 1;", "newString": "const a = 2;", "replaceAll": false }
```

- `oldString` 必须与文件内容完全一致（包括缩进）。
- 默认要求唯一匹配；多处匹配会报错并提示增加上下文或使用 `replaceAll`。
- 找不到时提示重新读取文件。

## list

列出目录条目（目录在前）。

```json
{ "path": "src", "limit": 200 }
```

## glob

按 glob 模式找文件，按修改时间排序。

```json
{ "pattern": "**/*.{ts,tsx}", "path": ".", "limit": 200 }
```

支持 `*`、`**`、`?`、`[abc]`、`{a,b}`。自动忽略 `.git`、`node_modules`、`.chan`、`.idea`、`__pycache__`、`dist` 之外常见的重型目录见 `src/util/fs.js`。

## grep

用 JavaScript 正则搜索文件内容。

```json
{ "pattern": "TODO|FIXME", "path": "src", "include": "*.ts", "ignoreCase": true, "limit": 100 }
```

输出格式：`相对路径:行号: 内容`。跳过二进制文件和大于 2MB 的文件。

## bash

在 workspace 中执行 shell 命令。

```json
{ "command": "npm test", "timeoutMs": 120000 }
```

- Windows 使用 PowerShell，macOS/Linux 使用 bash。
- 返回命令、cwd、状态（success / exit code / timeout）、stdout、stderr。
- 最大超时 10 分钟，超时会杀掉整个进程树。
- 危险命令（`rm -rf /`、格式化、fork bomb、`git push --force`、`curl | sh` 等）在 `auto` 模式下也会请求确认；`deny` 模式直接拒绝。

## webfetch

抓取 http(s) 页面并转成文本（HTML 去标签，JSON 美化）。

```json
{ "url": "https://example.com/docs", "format": "text", "timeoutMs": 30000 }
```

上限 2MB、默认 30 秒超时，结果截断到输出上限。

## todo_write / todo_read

维护当前会话的任务清单，前端与终端会显示。

```json
{
  "todos": [
    { "content": "阅读现有实现", "status": "completed" },
    { "content": "实现重试逻辑", "status": "in_progress" },
    { "content": "补充测试", "status": "pending" }
  ]
}
```

状态：`pending` `in_progress` `completed` `cancelled`。每次发送完整列表。

---

## 动态工具

以下工具按扩展配置动态出现：

| 工具 | 来源 | 说明 |
| --- | --- | --- |
| `skill` | `.chan/skills` 等 | 参数 `{ "id": "skill-id" }`，加载技能正文、目录与附带文件列表 |
| `subagent` | 内置 Agent 注册表 | 参数 `{ "agent": "explore", "prompt": "...", "model"?: "..." }`，在独立上下文运行子 Agent |
| `<server>_<tool>` | MCP 配置 | 由 MCP Server 声明的工具，参数遵循其 `inputSchema` |

`skill` 与 `subagent` 不受 Agent 的 base 工具白名单影响；MCP 工具同样直接追加。详见 [EXTENSIONS.md](EXTENSIONS.md)。

## 工具实现约定（扩展开发）

在 `src/tools/<name>.js` 中导出：

```js
export const myTool = {
  name: 'my_tool',
  description: '给模型看的一句话说明',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: '...' } },
    required: ['path'],
  },
  async run(args, ctx) {
    // ctx: { cwd, session, approve, signal, allowOutsideWorkspace,
    //        allowDangerous, commandTimeoutMs, maxOutputChars }
    return '字符串结果';
  },
};
```

然后在 `src/tools/index.js` 的 `ALL_TOOLS` 中注册。要求：

- `run` 返回字符串（非字符串会被 JSON 序列化）；
- 抛错会被转成 `Error: ...` 工具结果，不影响后续回合；
- 路径必须通过 `resolveWorkspacePath`；
- 长输出使用 `truncate`；
- 需要用户确认时调用 `await ctx.approve({...})`。

## 安全约束

| 约束 | 位置 |
| --- | --- |
| 路径必须位于 workspace | `src/util/paths.js` |
| 危险命令模式 | `src/tools/bash.js` (`DANGEROUS_PATTERNS`) |
| 命令超时与进程树清理 | `src/tools/bash.js` |
| 输出截断 | `agent.maxOutputChars` |
| 循环检测（相同调用 3 次） | `src/agent.js` |
| 上传类型/大小 | `src/server/server.js` |
