# chan_code

**一个开源、零运行时依赖的 AI 编程 Agent：既能在终端里用，也能在浏览器里用。**

`chan_code`（命令名 `chan`）像一个住在你项目里的结对程序员。它会读代码、搜代码、改文件、跑命令、跑测试，并把每一步工具调用实时展示给你。它支持任意 OpenAI 兼容接口和 Anthropic 原生接口，支持流式输出、工具调用、图片理解、会话持久化与安全审批。

> 浏览器界面不是附加品：图片、文件、工具输出卡片、审批按钮、模型配置都在这里完成。
> 推荐工作方式：**需要看图/传文件时开浏览器，其余时间用终端。**

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 三种入口 | 交互式终端 REPL、一次性任务 `chan run`、浏览器 Web UI |
| 浏览器 UI | `chan serve` 后打开 `http://127.0.0.1:4731`，支持拖拽/粘贴图片与文件上传 |
| 多模型 | DeepSeek、OpenAI、Anthropic、OpenRouter、Groq、Qwen、Moonshot、GLM、Ollama、LM Studio、vLLM，以及任意兼容端点 |
| 两种协议 | OpenAI `chat/completions` 与 Anthropic `messages`，均支持流式 + 工具调用 + 视觉输入 |
| 真实工具 | `read` `write` `edit` `list` `glob` `grep` `bash` `webfetch` `todo_write` `todo_read` |
| 安全 | 工作区路径约束、危险命令识别、`auto/ask/deny` 审批模式、Web 服务 Token、默认仅本机监听 |
| 会话 | 按工作区保存到 `~/.chan_code/sessions`，可 `chan --resume <id>` 恢复 |
| 跨平台 | Windows（PowerShell）、macOS、Linux；纯 Node.js ESM，无第三方依赖 |
| 可测试 | 54 个离线测试，覆盖配置、工具、Provider、Agent、会话、命令面板、HTTP/SSE 服务 |
| 文档 | 完整使用、配置、工具、架构、API、测试文档 + 介绍网站 |

---

## 快速开始

环境要求：**Node.js ≥ 18.17**，无需安装任何 npm 依赖。

### Windows

```powershell
git clone https://github.com/nowgoodm123/chan_code.git
cd chan_code
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1

chan init --provider deepseek
$env:DEEPSEEK_API_KEY = "sk-..."
chan                      # 终端聊天
chan serve --open         # 浏览器 UI（自动打开）
```

### macOS / Linux

```bash
git clone https://github.com/nowgoodm123/chan_code.git
cd chan_code
bash ./scripts/install.sh

chan init --provider deepseek
export DEEPSEEK_API_KEY="sk-..."
chan                      # 终端聊天
chan serve --open         # 浏览器 UI
```

### 不安装，直接运行

```bash
node bin/chan.js --help
node bin/chan.js run "解释这个项目的结构"
node bin/chan.js serve --open
```

### 配置模型

```bash
# 写入 ~/.chan_code/config.json（密钥也可以只放在环境变量里）
chan config set providers.deepseek.apiKey=sk-...
chan config set providers.deepseek.model=deepseek-chat

# 完全本地、离线
chan config set providers.ollama.baseUrl=http://127.0.0.1:11434/v1
chan config set providers.ollama.model=qwen2.5-coder:7b
chan -p ollama

# 查看所有可用预设
chan models --presets
```

---

## 使用方式

### 1. 交互式终端（REPL）

```text
chan
╭──────────────────────────────────────────────────────────────╮
│ chan_code v0.1.0 · open-source AI coding agent               │
│ provider: deepseek   model: deepseek-chat                    │
│ workspace: D:\work\app   approval: auto                      │
╰──────────────────────────────────────────────────────────────╯

chan> 修复上传接口没有重试的问题，并补测试
● read src/routes/upload.ts
✓ 72 lines
● bash npm test
✓ exit 0 · 18 passing
...
```

斜杠命令：在空提示符输入 `/` 会自动弹出命令面板；按 `Tab` 补全命令、子命令与 Provider 名。

- `/session` — 会话管理：`list` / `new` / `resume <id>` / `delete <id>` / `rename <title>` / `show [id]`
- `/connect` — 交互式连接模型：选择 Provider，填写 Base URL、模型、API Key，并写入配置
- `/model` `/provider` `/approval` — 切换模型、Provider 或审批模式
- `/attach` `/detach` `/tools` `/web` `/cwd` `/config` `/help` `/exit` — 其他快捷操作

### 2. 一次性任务

```bash
chan run "给 config 加载逻辑补充单元测试"
chan -C ./packages/api -p anthropic -m claude-3-7-sonnet-latest run "review 这个模块"
echo "找出所有未处理的 Promise rejection" | chan run
chan chat --resume <session-id>
```

### 3. 浏览器 UI

```bash
chan serve                 # http://127.0.0.1:4731
chan serve --open          # 自动打开浏览器
chan serve --port 8080
chan serve --host 0.0.0.0 --token my-secret   # 局域网访问，必须设置 token
```

浏览器中可：

- 拖拽 / 粘贴 / 选择图片，直接发给支持视觉的模型；
- 上传任意文本或代码文件到 `.chan/uploads`，Agent 可以直接 `read`；
- 折叠查看每次工具调用、耗时与输出；
- 对危险命令点击 Approve / Deny；
- 在 Settings 中修改默认 Provider、模型、Base URL、API Key、审批模式、服务器 Token；
- 切换 / 删除历史会话。

宣传与介绍页：`http://127.0.0.1:4731/about`，也可单独部署：

```bash
npm run site                # http://127.0.0.1:8080（纯静态介绍网站）
npm run site -- --open      # 启动并打开浏览器
npm run site -- --port 8787
```

站点是纯静态 `site/index.html`，可直接部署到 GitHub Pages / Nginx / 任意静态托管。

---

## 支持的模型

| Provider | 类型 | 默认模型 | 环境变量 |
| --- | --- | --- | --- |
| deepseek | OpenAI 兼容 | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| openai | OpenAI 兼容 | `gpt-4o-mini` | `OPENAI_API_KEY` |
| anthropic | Anthropic | `claude-3-7-sonnet-latest` | `ANTHROPIC_API_KEY` |
| openrouter | OpenAI 兼容 | `anthropic/claude-sonnet-4` | `OPENROUTER_API_KEY` |
| groq | OpenAI 兼容 | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| moonshot | OpenAI 兼容 | `moonshot-v1-32k` | `MOONSHOT_API_KEY` |
| qwen | OpenAI 兼容 | `qwen-max` | `DASHSCOPE_API_KEY` |
| zhipu | OpenAI 兼容 | `glm-4-plus` | `ZHIPU_API_KEY` |
| ollama | 本地 OpenAI 兼容 | `qwen2.5-coder:7b` | — |
| lmstudio | 本地 OpenAI 兼容 | `local-model` | — |
| vllm | 本地 OpenAI 兼容 | `local-model` | — |

自定义端点同样简单：

```bash
chan config set providers.my.provider=openai
chan config set providers.my.baseUrl=https://my-gateway/v1
chan config set providers.my.model=my-model
chan config set providers.my.apiKey=sk-...
chan -p my
```

环境变量覆盖（优先级高于配置文件）：`CHAN_PROVIDER` `CHAN_MODEL` `CHAN_BASE_URL` `CHAN_API_KEY` `CHAN_PORT` `CHAN_HOST` `CHAN_TOKEN` `CHAN_APPROVAL` `CHAN_MAX_STEPS` `CHAN_HOME`。

---

## 安全模型

- **路径约束**：文件工具只能访问工作目录内的路径；`agent.allowOutsideWorkspace=true` 才放开。
- **危险命令**：`rm -rf /`、磁盘格式化、fork bomb、强制推送、`curl | sh` 等会被识别；默认需要审批，`agent.allowDangerous=true` 才允许直接执行。
- **审批模式**：`auto`（默认，仅危险命令询问）、`ask`（所有 bash 前询问）、`deny`（禁止 bash）。
- **Web 安全**：默认只监听 `127.0.0.1`；非本机监听强制要求 Token；API 支持 `Authorization: Bearer` 与 `?token=`；上传扩展名与大小受限。
- **密钥**：支持 `env:VAR` 引用，`chan config show` 与 Web 设置页都会打码。

---

## 项目结构

```text
bin/chan.js               命令行入口
src/
  agent.js                Agent 主循环（流式、工具执行、循环检测、用量统计）
  config.js               配置合并、预设、环境变量、密钥解析、打码
  sessions.js             会话持久化、图片数据回填
  index.js                公共 API
  providers/
    openai.js             OpenAI 兼容流式协议（含工具调用与视觉）
    anthropic.js          Anthropic messages 流式协议
    index.js              Provider 工厂与校验
  tools/                  read write edit list glob grep bash webfetch todo
  util/                   SSE、HTTP 重试、路径安全、glob、文本处理
  server/
    server.js             HTTP + SSE API、静态资源、审批队列
    web/                  浏览器单页应用（HTML/CSS/JS）
  cli/                    args / main / repl / runner / ui
test/                     node:test 测试（离线）
site/index.html           介绍网站（可直接静态部署）
docs/                     使用与架构文档
scripts/                  install.ps1 / install.sh / lint.js
```

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 测试与质量

```bash
npm test        # 54 个测试，无需网络与 API Key
npm run lint    # 语法检查 + 入口与文档完整性检查
```

覆盖内容：

- 配置合并、环境变量覆盖、密钥打码、项目级配置；
- 工具：读写编辑、glob/grep、bash 退出码与危险命令、路径越界、todo、webfetch；
- Provider：OpenAI/Anthropic 的 SSE 分片解析、工具调用拼接、视觉消息、错误提示；
- Agent：工具结果回填、未知工具、非法参数、循环检测、步数上限、错误传播；
- 会话：持久化、工作区隔离、图片 data URL 剥离与回填；
- 服务端：健康检查、配置、会话 CRUD、SSE 聊天、上传校验、静态页面、Token 鉴权、审批接口。

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | 安装、配置、第一次对话 |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | 完整配置项、环境变量、模型接入 |
| [docs/TOOLS.md](docs/TOOLS.md) | 每个工具的输入输出与安全约束 |
| [docs/WEB_UI.md](docs/WEB_UI.md) | 浏览器功能、上传、远程访问 |
| [docs/API.md](docs/API.md) | HTTP/SSE 接口文档 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 模块划分、消息流、扩展点 |
| [docs/TESTING.md](docs/TESTING.md) | 测试结构、如何写新测试 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 路线图与跨平台说明 |

---

## 路线图

- [x] Windows / macOS / Linux 的 CLI 与 Web UI
- [x] OpenAI 兼容 + Anthropic Provider（流式、工具、视觉）
- [x] 会话持久化、审批、Token 鉴权
- [ ] 发布到 npm / Homebrew / winget / Scoop
- [ ] 会话内全文搜索与导出（Markdown / JSON）
- [ ] MCP（Model Context Protocol）工具接入
- [ ] 多 Agent 子任务与并行工具执行
- [ ] 更细粒度的审批规则（按命令前缀白名单）

欢迎贡献，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT © chan_code contributors
