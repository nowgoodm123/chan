# 路线图与跨平台说明

## 当前状态（v0.1）

已经完成：

- 终端 REPL、一次性任务、Web UI 三种入口；
- OpenAI 兼容与 Anthropic 两种协议，流式、工具调用、视觉输入；
- 10 个工具、路径安全、危险命令审批、循环检测；
- 会话持久化与跨入口恢复；
- HTTP + SSE API、Token 鉴权、上传；
- Windows / macOS / Linux 安装脚本；
- 离线测试与介绍网站。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Windows 10/11 | 已支持 | bash 工具使用 PowerShell；安装脚本 `scripts/install.ps1` |
| macOS | 已支持 | 使用 `bash`；`scripts/install.sh`；Apple Silicon 与 Intel 均可 |
| Linux | 已支持 | 使用 `bash`；`scripts/install.sh` |
| WSL | 已支持 | 按 Linux 使用 |
| 无 Node 环境 | 暂不支持 | 后续可提供单文件可执行打包 |

跨平台注意点：

- 命令执行：Windows 使用 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass`，并包装退出码；POSIX 使用 `bash -lc`（回退 `sh`）。
- 路径比较：Windows 大小写不敏感。
- 进程树终止：Windows 使用 `taskkill /T /F`，POSIX 使用进程组。

## 近期（v0.2）

- [ ] 发布 npm 包，提供 `npx chan-code`
- [ ] Homebrew tap、winget、Scoop 清单
- [ ] 会话搜索、导出 Markdown / JSON
- [ ] 配置加载支持注释（JSONC）
- [ ] Web UI 支持多附件预览、拖拽排序、历史消息复制
- [ ] bash 输出实时流式显示（目前为完成后一次性返回）

## 中期（v0.3）

- [ ] MCP（Model Context Protocol）客户端：接入外部工具服务器
- [ ] 子 Agent / 并行任务（只读探查、代码审查）
- [ ] 自定义命令（项目内 pre/post hook、技能文件）
- [ ] 审批规则：命令前缀白名单、按路径授权
- [ ] 代码索引（本地符号搜索）以降低 grep 成本
- [ ] 环境变量与密钥的独立密钥库（OS keychain）

## 长期

- [ ] 插件系统（Provider、工具、UI 主题）
- [ ] 团队共享配置与策略下发
- [ ] 可选的本地模型自动检测与推荐
- [ ] 单文件二进制（Node SEA / Bun compile）
- [ ] 无障碍与国际化（中英界面切换）

## 非目标

- 不做云端账号体系；chan_code 是本地优先工具。
- 不内置任何模型额度或代理服务。
- 不默认上传代码/密钥到第三方；只有你配置的 Provider 会看到你的上下文。

## 贡献方向

适合新贡献者的任务：

1. 增加 Provider 预设（新的 OpenAI 兼容服务）；
2. 增加工具（例如 `apply_patch`、`json_query`）；
3. 完善 Web UI（会话搜索、附件预览）；
4. 补充测试与文档；
5. 跨平台问题反馈与修复。

提交前请运行 `npm test` 与 `npm run lint`。
