# 快速开始

## 1. 环境要求

- Node.js **18.17 或更高版本**（推荐 20/22 LTS）
- 支持的平台：Windows 10/11、macOS、Linux
- 不需要编译、不需要安装任何 npm 依赖

检查版本：

```bash
node --version
npm --version
```

## 2. 获取代码

```bash
git clone https://github.com/nowgoodm123/chan_code.git
cd chan_code
```

## 3. 安装命令

### Windows（PowerShell）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

如果全局安装存在权限问题，可以安装到用户目录：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Prefix "$env:USERPROFILE\.npm-global"
# 然后把该目录加入 PATH
```

### macOS / Linux

```bash
bash ./scripts/install.sh

# 无权限时：
npm install -g . --prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
```

### 不安装

```bash
node bin/chan.js --help
```

`chan` 与 `chan-code` 是等价的命令名。

## 4. 初始化配置

```bash
chan init --provider deepseek
```

这会创建 `~/.chan_code/config.json`，包含 deepseek / openai / anthropic / ollama 四个 Provider 模板。

默认配置会通过环境变量读取密钥：

| Provider | 环境变量 |
| --- | --- |
| deepseek | `DEEPSEEK_API_KEY` |
| openai | `OPENAI_API_KEY` |
| anthropic | `ANTHROPIC_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| groq | `GROQ_API_KEY` |
| moonshot | `MOONSHOT_API_KEY` |
| qwen | `DASHSCOPE_API_KEY` |
| zhipu | `ZHIPU_API_KEY` |

也可以直接写入配置：

```bash
chan config set providers.deepseek.apiKey=sk-...
```

## 5. 第一次对话

### 终端

```bash
chan
```

输入任务，例如：

```text
解释这个项目的目录结构，并告诉我如何运行测试
```

### 终端快捷命令

在空提示符直接输入 `/` 会弹出命令面板，按 `Tab` 可补全命令、子命令、Provider 名和图片路径：

- `/session list|new|resume <id>|delete <id>|fork [index]|export [path]|compact|rename <title>|show [id]` — 会话管理
- `/connect [provider]` — 交互式连接模型：类型、Base URL、模型、API Key，保存后立即生效
- `/model`、`/provider`、`/approval` — 快速切换模型 / Provider / 审批模式
- `/attach <image>`、`/detach`、`/tools`、`/web [open|stop]`、`/config`、`/help`、`/exit`
- `/agent [name]`、`/agents`、`/skills`、`/commands`、`/mcps` — Agent 与扩展管理

连接示例：

```text
chan> /connect mock
type [openai|anthropic] (openai): openai
Base URL (required): http://127.0.0.1:4999/v1
Model (required): local-model
API key (blank for local or keyless endpoints): ****
connected: mock · local-model
  http://127.0.0.1:4999/v1 · key configured
  saved to C:\Users\<you>\.chan_code\config.json
```

### 一次性任务

```bash
chan run "找出 TODO 并给出优先级"
```

### 浏览器

```bash
chan serve --open
```

打开 `http://127.0.0.1:4731`。图片可直接拖入输入框，文件会上传到 `.chan/uploads`。

## 6. 验证安装

```bash
chan --version
chan models
chan tools
npm test        # 在源码目录中运行，离线
```

## 常见问题

**`chan` 不是内部或外部命令**
说明 npm 全局 bin 目录不在 PATH 中。执行 `npm bin -g`（旧版本）或 `npm config get prefix`，把对应目录加入 PATH，或直接使用 `node bin/chan.js`。

**提示缺少 API key**
运行 `chan config set providers.<name>.apiKey=...`，或设置对应环境变量后重开终端。

**公司代理 / 自建网关**
设置 `baseUrl` 与自定义请求头：

```bash
chan config set providers.gw.baseUrl=https://gateway.example.com/v1
chan config set providers.gw.model=internal-model
chan config set providers.gw.apiKey=...
chan -p gw
```

**本地模型**
Ollama：先执行 `ollama serve` 并 `ollama pull qwen2.5-coder:7b`，然后：

```bash
chan -p ollama
```

**Windows 下 bash 工具使用什么 shell？**
PowerShell（`powershell.exe`，非交互、绕过执行策略）。可以用 `CHAN_SHELL` 指定其他 shell。
