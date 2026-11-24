# Changelog

All notable changes to chan_code are documented here.

## [0.3.0] - 2026-11-24

### Added

- Fine-grained permission rules: `allow` / `ask` / `deny` by action and resource (paths, shell commands, URLs, skills, agents, MCP tools); last match wins; `.env` reads ask by default.
- "Always allow" approvals in the CLI and web UI, saved to the global `permissions` config.
- Session tools: fork (optionally before a message index), export to Markdown or JSON, and context compaction with the active model.
- CLI: `/session fork|export|compact`, updated `/session` help and tab completion.
- HTTP: `POST /api/sessions/:id/fork`, `GET /api/sessions/:id/export`, `POST /api/sessions/:id/compact`, and `remember` support in `/api/approve`.
- Web UI: agent selector, custom command slash menu, Fork / Export / Compact buttons, "Always allow" approval action.
- Docs: `docs/PERMISSIONS.md`; updated configuration, API, web UI, testing, extensions, tools and roadmap.
- New tests for permissions and session tools (82 total).

## [0.2.0] - 2026-11-24

### Added

- MCP support: local stdio and remote Streamable HTTP servers, tool discovery, `chan mcp`, `/mcps`, and `/api/mcp`.
- Skills: `SKILL.md` discovery from `.chan/skills`, `~/.chan_code/skills`, `.claude` and `.agents`, plus a `skill` tool.
- Custom commands: Markdown templates with `$ARGUMENTS` / positional args, shell interpolation, agent/model overrides and `subagent: true`.
- Agents: built-in `build` / `plan` / `explore` / `general`, custom agent files, `/agent`, and a `subagent` tool with one level of nesting.
- Extension HTTP endpoints: `/api/mcp`, `/api/mcp/refresh`, `/api/skills`, `/api/commands`, `/api/agents`.
- New tests for MCP, skills, commands, agents/runtime, extension endpoints and MCP tool calls (72 total).
- Docs: `docs/EXTENSIONS.md`; updated configuration, tools, API, architecture and roadmap.

## [0.1.0] - 2026-11-23

### Added

- Initial release of chan_code: an open-source AI coding agent for terminal and browser.
- Interactive CLI (`chan`), one-shot runs (`chan run`), and local web UI (`chan serve`).
- OpenAI-compatible and Anthropic providers with streaming, tool calling, and vision.
- Tools: `read`, `write`, `edit`, `list`, `glob`, `grep`, `bash`, `webfetch`, `todo_write`, `todo_read`.
- Workspace path safety, dangerous-command detection, and `auto` / `ask` / `deny` approval modes.
- Session persistence per workspace with resume support and image rehydration.
- HTTP + SSE API: sessions, chat streaming, uploads, approvals, config, health.
- Browser UI with image/file upload, tool cards, approval buttons, provider settings, session sidebar.
- Token-protected server, localhost-only by default.
- Installers for Windows (PowerShell), macOS and Linux (bash).
- Interactive slash command palette: type `/` in the REPL to list commands, with Tab completion for commands, subcommands, providers and image paths.
- `/session` management (list/new/resume/delete/rename/show) and `/connect` wizard for providers (type, base URL, model, API key).
- Offline test suite (54 tests) using `node:test`.
- Landing site (`site/index.html`) and full documentation in `docs/`.
- Provider presets: DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Moonshot, Qwen, Zhipu, Ollama, LM Studio, vLLM.
