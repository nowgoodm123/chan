# 配置参考

配置文件位置：

- 全局：`~/.chan_code/config.json`（Windows 为 `C:\Users\<你>\.chan_code\config.json`）
- 可用 `CHAN_HOME` 改变整个目录
- 项目级：`<项目>/chan.config.json` 或 `<项目>/.chan/config.json`

优先级（后者覆盖前者）：默认配置 → 全局配置 → 项目配置 → 环境变量 → 命令行参数。

```bash
chan config show      # 查看合并后的配置（密钥打码）
chan config path      # 配置文件路径
chan config get agent.maxSteps
chan config set agent.maxSteps=30 providers.deepseek.model=deepseek-reasoner
chan config edit      # 用 $EDITOR / notepad 打开
```

## 完整结构

```json
{
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": {
      "type": "openai",
      "label": "DeepSeek",
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "apiKey": "env:DEEPSEEK_API_KEY",
      "maxTokens": 8192,
      "temperature": 0.2,
      "streamUsage": true,
      "extraHeaders": {}
    }
  },
  "agent": {
    "maxSteps": 40,
    "approval": "auto",
    "allowOutsideWorkspace": false,
    "allowDangerous": false,
    "commandTimeoutMs": 120000,
    "maxOutputChars": 20000,
    "temperature": 0.2,
    "systemPrompt": ""
  },
  "server": {
    "host": "127.0.0.1",
    "port": 4731,
    "token": ""
  },
  "ui": {
    "theme": "dark"
  }
}
```

## providers.*

| 字段 | 说明 |
| --- | --- |
| `type` | `openai`（兼容 chat/completions）或 `anthropic`（messages） |
| `baseUrl` | API 根地址，不含 `/chat/completions` 或 `/messages` |
| `model` | 模型名，会原样发送 |
| `apiKey` | 密钥原文，或 `env:VAR_NAME` 引用环境变量 |
| `apiKeyEnv` | 预设中的环境变量名（通常不用改） |
| `maxTokens` | 仅 Anthropic 默认使用，默认 8192 |
| `temperature` | Provider 级温度，Agent 级会覆盖 |
| `streamUsage` | 是否发送 `stream_options.include_usage`，个别兼容服务不支持时设为 `false` |
| `extraHeaders` | 附加 HTTP 头，例如网关鉴权 |

内置预设（`chan models --presets`）：

| 名称 | type | baseUrl | 默认模型 |
| --- | --- | --- | --- |
| openai | openai | https://api.openai.com/v1 | gpt-4o-mini |
| anthropic | anthropic | https://api.anthropic.com/v1 | claude-3-7-sonnet-latest |
| deepseek | openai | https://api.deepseek.com/v1 | deepseek-chat |
| openrouter | openai | https://openrouter.ai/api/v1 | anthropic/claude-sonnet-4 |
| groq | openai | https://api.groq.com/openai/v1 | llama-3.3-70b-versatile |
| moonshot | openai | https://api.moonshot.cn/v1 | moonshot-v1-32k |
| qwen | openai | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-max |
| zhipu | openai | https://open.bigmodel.cn/api/paas/v4 | glm-4-plus |
| ollama | openai | http://127.0.0.1:11434/v1 | qwen2.5-coder:7b |
| lmstudio | openai | http://127.0.0.1:1234/v1 | local-model |
| vllm | openai | http://127.0.0.1:8000/v1 | local-model |

### 添加自定义 Provider

```bash
chan config set providers.gw.type=openai
chan config set providers.gw.baseUrl=https://gateway.example.com/v1
chan config set providers.gw.model=my-coder
chan config set providers.gw.apiKey=env:MY_GATEWAY_KEY
chan config set providers.gw.extraHeaders='{"X-Org":"team"}'
chan -p gw
```

### Anthropic 兼容网关

```bash
chan config set providers.claude-gw.type=anthropic
chan config set providers.claude-gw.baseUrl=https://my-proxy/v1
chan config set providers.claude-gw.model=claude-3-7-sonnet-latest
chan config set providers.claude-gw.apiKey=sk-ant-...
```

## agent.*

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `maxSteps` | 40 | 单轮最多「模型→工具→模型」循环次数 |
| `approval` | auto | `auto`：危险命令才询问；`ask`：每次 bash 都询问；`deny`：禁止 bash |
| `allowOutsideWorkspace` | false | 允许文件工具访问工作区以外路径 |
| `allowDangerous` | false | 跳过危险命令拦截（不建议） |
| `commandTimeoutMs` | 120000 | bash 默认超时，最大 600000 |
| `maxOutputChars` | 20000 | 单个工具结果返回给模型的最大字符数 |
| `temperature` | 0.2 | 采样温度 |
| `systemPrompt` | "" | 追加到系统提示前的自定义指令 |

## server.*

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `host` | 127.0.0.1 | 监听地址；非本机地址必须配置 token |
| `port` | 4731 | 端口，`0` 表示随机端口 |
| `token` | "" | 设置后所有 `/api/*` 需要 `Authorization: Bearer <token>` 或 `?token=` |

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CHAN_HOME` | 覆盖 `~/.chan_code` 目录 |
| `CHAN_PROVIDER` | 默认 Provider |
| `CHAN_MODEL` | 覆盖当前 Provider 的模型 |
| `CHAN_BASE_URL` | 覆盖当前 Provider 的 baseUrl |
| `CHAN_API_KEY` | 覆盖当前 Provider 的 apiKey |
| `CHAN_PORT` / `CHAN_HOST` | Web 服务监听地址 |
| `CHAN_TOKEN` | Web 服务 Token |
| `CHAN_APPROVAL` | auto / ask / deny |
| `CHAN_MAX_STEPS` | 步数上限 |
| `CHAN_SHELL` | bash 工具使用的 shell |
| `NO_COLOR` | 关闭终端颜色 |
| `CHAN_DEBUG` | 输出更多错误堆栈 |

## 命令行参数

```text
-p, --provider <name>
-m, --model <name>
-C, --cwd <dir>
    --approval <auto|ask|deny>
    --max-steps <n>
-f, --file <path>        可重复，附加文本文件到 prompt
    --resume <id>        恢复会话
    --system <text>      追加系统提示
-V, --verbose            完整显示工具输出
    --json               JSON 输出（models/tools）
    --port/--host/--token/--open    serve 专用
```

## 配置示例

### 用 DeepSeek 做主力，Ollama 做离线备用

```json
{
  "defaultProvider": "deepseek",
  "providers": {
    "deepseek": { "type": "openai", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat", "apiKey": "env:DEEPSEEK_API_KEY" },
    "ollama": { "type": "openai", "baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen2.5-coder:14b", "apiKey": "" }
  },
  "agent": { "approval": "ask", "maxSteps": 60 },
  "server": { "host": "127.0.0.1", "port": 4731, "token": "" }
}
```

### 团队网关 + 强制审批

```json
{
  "defaultProvider": "gateway",
  "providers": {
    "gateway": {
      "type": "openai",
      "baseUrl": "https://ai-gateway.corp/v1",
      "model": "coding-pro",
      "apiKey": "env:CORP_AI_KEY",
      "extraHeaders": { "X-Team": "platform" }
    }
  },
  "agent": { "approval": "ask", "maxSteps": 50 },
  "server": { "host": "127.0.0.1", "port": 4731, "token": "team-secret" }
}
```
