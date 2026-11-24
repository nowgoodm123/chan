# 浏览器 UI 使用指南

浏览器界面和终端使用同一个 Agent 引擎，主要用来解决两类终端不擅长的事情：**传图片** 与 **传文件**，以及更直观地查看工具调用。

## 启动

```bash
chan serve                 # http://127.0.0.1:4731
chan serve --open          # 自动打开默认浏览器
chan serve --port 8080
chan serve --host 127.0.0.1
```

在 REPL 中也可以直接输入：

```text
/web          # 启动并打印地址
/web open     # 启动并打开浏览器
/web stop     # 停止
```

## 界面

- **左侧栏**：新建会话、历史会话（按工作区隔离）、删除、切换主题、关于页入口。
- **顶栏**：Provider 下拉、模型输入、审批模式、设置。
- **消息区**：用户消息、Markdown 渲染的助手回复、可折叠的工具卡片（状态/参数/输出/耗时）。
- **输入区**：图片 / 文件按钮、拖拽与粘贴上传、发送与停止。
- **Settings**：默认 Provider、模型、Base URL、API Key、审批模式、最大步数、系统提示、工作目录、服务器 Token。

快捷键：`Enter` 发送，`Shift+Enter` 换行，`Ctrl/Cmd+N` 新建会话。

扩展在浏览器中同样生效：直接发送 `/review src/auth.ts` 会展开自定义命令；Agent 可以使用 `skill`、`subagent` 与已连接的 MCP 工具。MCP 状态可通过 `GET /api/mcp` 查看，或在终端执行 `chan mcp`。

## 图片

三种方式：

1. 点击 **Image** 选择文件；
2. 直接把截图/图片拖进窗口；
3. 在输入框 `Ctrl+V` 粘贴剪贴板图片。

图片以 data URL 随消息发送给支持视觉的模型（例如 GPT-4o、Claude 3.7、Qwen-VL 等）。非视觉模型收到图片可能报错或忽略，请切换模型。

适合场景：报错截图、UI 设计稿、接口返回截图、白板草图。

## 文件

点击 **File** 选择任意允许类型（代码、文本、PDF、图片等）。文件会立即上传到：

```text
<workspace>/.chan/uploads/<时间戳>-<文件名>
```

消息里会自动附加 `Attached file: .chan/uploads/...`，Agent 可以用 `read` 工具读取。`.chan/` 已加入 `.gitignore` 建议，避免误提交。

也可在终端里手动指明路径，让 Agent 读取已存在的文件。

## 审批

`auto` 模式下，遇到危险命令会出现审批卡片，点击 Approve / Deny：

```text
Approval required · recursive delete of root/home
rm -rf build
[Approve] [Deny]
```

5 分钟未响应默认拒绝。`ask` 模式下所有 bash 命令都会询问，`deny` 模式下 bash 不可用。

## 设置模型

打开 **Settings**：

1. 选择 Default provider；
2. 在 "Edit provider" 里选择具体 Provider，填写 Model、Base URL、API Key；
3. 保存即写入 `~/.chan_code/config.json`，立即生效。

API Key 输入框留空表示保持原值（配置接口不会回传明文密钥，只返回打码值）。

## 工作目录

"Workspace directory for new sessions" 决定新建会话的工作目录（保存在浏览器 localStorage）。为空时使用 `chan serve` 启动时所在的目录。路径必须存在。

## 安全与远程访问

默认只监听 `127.0.0.1`：其他机器无法访问，适合个人使用。

需要局域网访问时：

```bash
chan serve --host 0.0.0.0 --token s3cret
```

- 没有 token 的情况下，程序拒绝监听非本机地址；
- 打开地址后可在 URL 中带一次 token：`http://192.168.1.20:4731/?token=s3cret`，页面会保存到 localStorage；
- 也可在 Settings 或 `chan config set server.token=...` 修改；
- 建议仅在可信网络中使用，并配合系统防火墙限制来源 IP。

## 会话与恢复

浏览器和终端共享同一套会话文件。在浏览器中创建的会话可以在终端恢复：

```bash
chan sessions
chan chat --resume <id>
```

反之亦然。图片附件以 `path` 持久化，恢复时从 `.chan/uploads` 读取，若文件被删除则只剩文件名。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 401 Unauthorized | 在提示框中输入服务器 Token，或用 `?token=` 打开 |
| 页面提示 Could not connect | 确认 `chan serve` 仍在运行、端口正确 |
| 发送后立刻 400/500 | 检查 Provider 配置、API Key、baseUrl、model |
| "session is already processing" | 等待当前回复或点击 Stop |
| 上传失败 | 检查扩展名是否受支持、文件是否超过 12MB |
