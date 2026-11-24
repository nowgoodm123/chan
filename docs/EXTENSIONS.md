# 扩展能力：MCP / Skills / Commands / Agents

chan_code 支持四类扩展。它们都是本地文件或配置，不需要安装 npm 依赖，CLI 与浏览器共用同一套实现。

---

## 1. MCP（Model Context Protocol）

MCP Server 提供的工具会自动出现在 Agent 的工具列表中，命名规则为 `<server>_<tool>`（非字母数字字符替换为 `_`）。

### 配置

```json
{
  "mcp": {
    "timeoutMs": 30000,
    "servers": {
      "context7": {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp",
        "headers": {
          "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
        }
      },
      "local-tools": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
        "cwd": ".",
        "environment": {
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `type` | `local`（stdio）或 `remote`（Streamable HTTP） |
| `command` | local 必填，数组：可执行文件 + 参数 |
| `cwd` | local 工作目录，相对当前 workspace |
| `environment` / `env` | local 附加环境变量 |
| `url` | remote 端点 |
| `headers` | remote 请求头，可用 `{env:NAME}` 引用环境变量 |
| `disabled` | `true` 时不连接 |

字符串参数中的 `{env:NAME}` 会在连接前替换为环境变量。

### 使用

```bash
chan mcp               # 查看连接状态与工具
chan mcp refresh       # 重新连接
```

REPL：

```text
/mcps
/mcps refresh
```

HTTP API：

```http
GET  /api/mcp
POST /api/mcp/refresh
```

模型会看到类似 `context7_resolve_library_id` 的工具。工具返回文本内容；图片块会被替换为 `[image ... omitted]` 占位。

### 当前限制

- 只实现 tools：`initialize`、`notifications/initialized`、`tools/list`、`tools/call`。
- 暂不支持 MCP prompts / resources / elicitation / OAuth。远程服务请使用 API key 或 Bearer Header。
- MCP 工具会绕过 Agent 的 base 工具白名单（例如 `plan` 的只读限制）。连接第三方 MCP 前请确认其能力。

---

## 2. Skills

Skill 是一段可复用工作流说明。Agent 在系统提示中只看到 id 与 description，需要时调用 `skill` 工具加载正文。

### 位置

| 范围 | 目录 |
| --- | --- |
| 全局 | `~/.chan_code/skills/` |
| 项目 | `<workspace>/.chan/skills/` |
| 兼容 | `<workspace>/.claude/skills/`、`<workspace>/.agents/skills/` |
| 额外 | 配置 `skills.dirs` 数组 |

两种文件形式：

```text
.chan/skills/
├── review.md                 # id = review
└── git-release/
    ├── SKILL.md              # id = git-release
    ├── scripts/
    │   └── changelog.js
    └── references/
        └── policy.md
```

目录形式可以携带脚本与参考资料；加载时会列出文件清单（最多 20 个），Agent 可再用 `read` 读取（仅限 workspace 内文件）。

### 文件格式

```markdown
---
name: Git Release
description: Prepare release notes, version bump and tag
---

## Workflow

1. Read `references/policy.md`.
2. Propose the version bump.
3. Update CHANGELOG and tag only after approval.
```

| 字段 | 说明 |
| --- | --- |
| `name` | 展示名，默认等于 id |
| `description` | 提供给模型判断是否使用；没有描述的技能不会出现在提示中 |
| `disable-model-invocation` / `opencode/autoinvoke: false` | 隐藏但仍可通过 `skill` 工具显式加载 |

项目内同名技能覆盖全局技能。文件支持 UTF-8 BOM。

### 查看

```bash
chan        # 然后输入 /skills
```

HTTP：

```http
GET /api/skills?cwd=<workspace>
```

---

## 3. 自定义命令（Commands）

把常用提示词保存为 `/name`。

### 位置

| 范围 | 目录 |
| --- | --- |
| 全局 | `~/.chan_code/commands/` |
| 项目 | `<workspace>/.chan/commands/` |
| 兼容 | `.claude/commands/`、`.agents/commands/` |
| 额外 | 配置 `commands.dirs` |

子目录会成为命令命名空间：`.chan/commands/team/review.md` → `/team/review`。

### 格式

```markdown
---
description: Review a file for bugs
agent: plan
model: deepseek/deepseek-chat
---

Review $ARGUMENTS. Report bugs first, then missing tests.
```

| 字段 | 说明 |
| --- | --- |
| `description` | 显示在 `/commands` 与 `/help` |
| `agent` | 本次使用的主 Agent（如 `plan`） |
| `model` | 本次模型覆盖，支持 `model` 或 `provider/model` |
| `subagent` | `true` 时交给子 Agent 后台执行，结果为最终报告 |

### 参数

| 写法 | 行为 |
| --- | --- |
| `$ARGUMENTS` | 完整参数字符串 |
| `$1` … `$9` | 位置参数；最高位参数会吞掉其余参数 |
| 无占位符 | 参数会追加到模板末尾 |

引号可用于包含空格的参数：

```text
/review src/auth.ts "error handling"
```

### Shell 插值

```markdown
Review this diff:

!`git diff --stat && git diff`
```

`!`...`` 会在命令展开时执行，并把输出插入提示词。**注意**：这一步发生在 Agent 工具权限流程之外，只应运行可信命令。

### 使用

```text
/commands
/review src/auth.ts
/team/audit package-name
```

浏览器输入框直接发送 `/review src/auth.ts` 也会由服务端展开。

HTTP：

```http
GET /api/commands?cwd=<workspace>
```

---

## 4. Agents 与子 Agent

Agent 由 system prompt、可用工具、模型、步数组合而成。

### 内置 Agent

| 名称 | 模式 | 用途 |
| --- | --- | --- |
| `build` | primary | 默认，完整工具权限 |
| `plan` | primary | 只读分析与计划，无 write/edit/bash |
| `explore` | subagent | 只读搜索与探索 |
| `general` | subagent | 通用研究，完整工具（不能再嵌套子 Agent） |

切换主 Agent：

```text
/agent plan
/agent build
/agent               # 查看当前与可选项
```

`/agent plan` 后写入类工具会从工具列表中移除，适合先调研再切换回 build 实施。

### 自定义 Agent

位置：

- `~/.chan_code/agents/`
- `<workspace>/.chan/agents/`
- `.claude/agents/`、`.agents/agents/`
- 配置 `agents.dirs`

```markdown
---
description: Reviews changes for correctness and regressions
mode: subagent
tools: [read, grep, glob]
model: anthropic/claude-3-7-sonnet-latest
steps: 8
---

Review the current changes. List findings by severity with file:line references. Do not edit files.
```

| 字段 | 说明 |
| --- | --- |
| `mode` | `primary` / `subagent` / `all`（默认 `all`） |
| `tools` | base 工具白名单；省略表示全部。`skill`、`subagent`、MCP 工具不受此列表限制 |
| `model` | 该 Agent 使用的模型 |
| `steps` | 最大步数 |
| `hidden` | 不在列表中展示，但仍可被显式调用 |

### 子 Agent 工具

主 Agent 会看到 `subagent` 工具：

```json
{ "agent": "explore", "prompt": "Find where authentication is implemented", "model": "optional-model" }
```

- 子 Agent 使用全新上下文与独立 messages；
- 结果以摘要 + 最终文本返回父会话；
- 嵌套深度最多 1 层（子 Agent 不会再获得 `subagent` 工具）；
- 审批模式与中断信号继承父会话；
- `plan`/`explore` 等只读 Agent 不会修改文件。

查看：

```text
/agents
```

HTTP：

```http
GET /api/agents?cwd=<workspace>
```

---

## 加载与热更新

- Skills / Commands / Agents 在**每一轮**开始时从磁盘重新读取，新增或修改文件后直接发下一条消息即可生效。
- MCP 连接在启动时建立；修改 `mcp.servers` 后执行 `/mcps refresh` 或 `chan mcp refresh`（Web 端可 `POST /api/mcp/refresh`）。
- 配置项修改后，Web 服务会重建 MCP 管理器。

## 安全建议

1. 只把可信目录加入 `skills.dirs` / `commands.dirs` / `agents.dirs`。
2. 自定义命令中的 shell 插值不受审批保护，代码审查时重点检查。
3. 子 Agent 与 MCP 工具最终仍由你在 `auto/ask/deny` 模式下控制 bash 审批。
4. 远程 MCP 优先使用 Header 传递 API key，不要把密钥写入仓库配置。
5. 使用 `permissions` 规则限制工具、路径、命令与 MCP 工具；详见 [PERMISSIONS.md](PERMISSIONS.md)。MCP 工具的动作名就是其暴露名（如 `context7_resolve_library_id`）。

## 验证

```bash
npm test        # 包含 MCP、skills、commands、agents/runtime 测试
npm run lint
chan mcp
```

相关测试：`test/mcp.test.js`、`test/skills.test.js`、`test/commands.test.js`、`test/agents.test.js`。
