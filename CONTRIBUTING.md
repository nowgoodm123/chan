# 贡献指南

感谢参与 chan_code。项目目标是保持**零运行时依赖、可审查、跨平台、可测试**。

## 开发环境

```bash
git clone https://github.com/nowgoodm123/chan_code.git
cd chan_code
node --version        # >= 18.17
npm test
npm run lint
```

无需 `npm install`。直接用 `node bin/chan.js ...` 运行。

## 提交前检查

```bash
npm test
npm run lint
```

Linux/macOS 额外确认安装脚本可执行：`chmod +x scripts/install.sh`。

## 代码风格

- 纯 ESM（`"type": "module"`），使用 `node:` 前缀内置模块；
- 2 空格缩进、单引号、行尾分号；
- 不引入运行时依赖；如需新能力优先用 `fs` / `http` / `fetch`；
- 不添加无意义注释；注释解释「为什么」而非「做了什么」；
- 错误信息面向用户，包含可执行的下一步建议；
- 文件、网络、命令操作必须考虑 Windows 与 POSIX 差异。

## 添加工具

1. 新建 `src/tools/my-tool.js`，导出 `myTool`（`name/description/parameters/run`）；
2. 在 `src/tools/index.js` 的 `ALL_TOOLS` 注册；
3. 路径使用 `resolveWorkspacePath`；输出使用 `truncate`；
4. 在 `test/tools.test.js` 增加测试；
5. 在 `docs/TOOLS.md` 补充文档。

## 添加 Provider

1. 在 `src/providers/` 实现 `stream()` 异步生成器，产出 `text-delta` / `reasoning-delta` / `tool-call` / `done`；
2. 在 `src/providers/index.js` 注册类型；
3. 如需预设，在 `src/config.js` 的 `PROVIDER_PRESETS` 添加；
4. 使用 mock `fetch` 的测试覆盖 SSE 分片与工具参数拼接。

## 修改 Web UI

前端没有构建步骤：`src/server/web/index.html`、`style.css`、`app.js` 直接由服务端提供。注意保持 CSP（`default-src 'self'`），不要引入外部脚本或内联脚本。

## 提交信息

使用简短祈使句，例如：

```text
add ollama preset and local model docs
fix tool output truncation on windows
test: cover anthropic tool_result merging
```

## Pull Request 清单

- [ ] `npm test` 通过
- [ ] `npm run lint` 通过
- [ ] 新功能有文档与测试
- [ ] 未提交密钥、日志或临时文件
- [ ] 行为变化在 PR 描述中说明

## 行为准则

保持专业与尊重。讨论技术问题，不针对个人。安全问题请私下联系维护者而不是公开 issue。
