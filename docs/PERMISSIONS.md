# 权限规则

chan_code 支持按「动作 + 资源」配置细粒度权限，默认全部允许，但内置了对 `.env` 文件读取的询问规则。

## 配置

```json
{
  "permissions": [
    { "action": "shell", "resource": "git status *", "effect": "allow" },
    { "action": "shell", "resource": "git push *", "effect": "deny" },
    { "action": "read", "resource": "secrets/*", "effect": "deny" },
    { "action": "read", "resource": "*.env", "effect": "ask" },
    { "action": "webfetch", "resource": "https://docs.example.com/*", "effect": "allow" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `action` | 见下表，可用 `*` 通配 |
| `resource` | 路径、命令、URL、skill id、agent 名或 MCP 工具名；可用 `*`、`?` 通配 |
| `effect` | `allow` / `ask` / `deny` |

规则按顺序匹配，**最后一条匹配的规则生效**。没有匹配时默认允许（内置 `.env` 规则除外）。

## 动作与资源

| 动作 | 工具 | 资源示例 |
| --- | --- | --- |
| `read` | read / list / glob / grep | 工作区相对路径，如 `src/app.js` |
| `edit` | write / edit | 目标路径 |
| `shell` | bash | 原始命令字符串 |
| `webfetch` | webfetch | 完整 URL |
| `skill` | skill | 技能 id |
| `subagent` | subagent | Agent 名称 |
| `*` | 所有工具 | 任意资源 |
| `<server>_<tool>` | MCP 工具 | `*` |

路径统一转换为 `/` 分隔；Windows 下匹配大小写不敏感。以 ` *` 结尾的 shell 规则也能匹配不带参数的命令，例如 `git status *` 同时匹配 `git status` 与 `git status --short`。

内置默认规则：

```json
[
  { "action": "read", "resource": "*.env", "effect": "ask" },
  { "action": "read", "resource": "*.env.*", "effect": "ask" },
  { "action": "read", "resource": "*.env.example", "effect": "allow" }
]
```

## 与审批模式的关系

- `effect: deny`：直接拒绝，不进入审批。
- `effect: ask`：无论当前 `agent.approval` 是什么（除 `deny` 外）都会请求审批。
- `effect: allow`：跳过该工具的审批询问；显式允许的 shell 规则也会跳过 `ask` 模式与普通危险命令提示（危险命令仍建议谨慎配置）。
- `agent.approval=deny` 仍然会拒绝所有 bash。
- 没有匹配规则时沿用原有行为：`auto` 仅危险命令询问，`ask` 每次 bash 询问。

## 记住选择（Always allow）

审批时可以保存为规则：

- CLI：输入 `a`（always）
- Web UI：点击 **Always allow**

保存的规则是 `allow`，写入全局配置 `permissions` 数组，立即生效。示例：

```json
{ "action": "shell", "resource": "git status *", "effect": "allow" }
```

保存的规则不会覆盖已有的 `deny` 规则（因为 deny 优先匹配且通常写在后面，可用 `chan config show` 检查顺序）。

## 常用示例

```json
{
  "permissions": [
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "npm test *", "effect": "allow" },
    { "action": "shell", "resource": "npm run lint *", "effect": "allow" },
    { "action": "shell", "resource": "git push *", "effect": "deny" },
    { "action": "edit", "resource": "package-lock.json", "effect": "deny" },
    { "action": "read", "resource": "*.pem", "effect": "deny" }
  ]
}
```

## 限制

- 仅覆盖内置工具与 MCP 工具调用；自定义命令里的 shell 插值不受此机制保护（见 [EXTENSIONS.md](EXTENSIONS.md)）。
- 工作区外路径仍由 `agent.allowOutsideWorkspace` 控制，权限规则不会绕过该限制。
- 规则是字符串通配，不是正则表达式。
- 目前没有按项目隔离的“记住”存储；保存的规则写入全局配置。
