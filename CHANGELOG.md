# Changelog

All notable changes to chan_code are documented here.

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
