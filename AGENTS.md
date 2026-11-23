# Agent notes for chan_code

## What this repo is

`chan_code` is a zero-dependency Node.js (>= 18.17) ESM project: an AI coding agent with a terminal REPL, one-shot CLI runs, and a local web UI. Everything ships as source; there is no build step and no `npm install` step.

## Commands

```bash
npm test          # node --test (offline, no API key)
npm run lint      # syntax check + bin/docs integrity (scripts/lint.js)
node bin/chan.js --help
node bin/chan.js serve --port 4731
```

Tests run on Windows, macOS and Linux. Never require real network or API keys in tests; mock `fetch` or inject a fake `providerFactory`.

## Layout

- `src/agent.js` — agent loop, event stream, tool execution, loop detection.
- `src/providers/` — `openai.js`, `anthropic.js`, factory in `index.js`.
- `src/tools/` — one file per tool; register in `ALL_TOOLS` (`src/tools/index.js`).
- `src/server/server.js` — HTTP + SSE API and static file serving.
- `src/server/web/` — vanilla HTML/CSS/JS UI (no framework, CSP `default-src 'self'`).
- `src/cli/` — `args.js`, `main.js`, `repl.js`, `runner.js`, `ui.js`.
- `test/` — `node:test` suites.
- `docs/` — Chinese documentation; `site/index.html` — landing page.

## Conventions

- 2-space indent, single quotes, semicolons, `node:` import prefixes.
- No runtime dependencies. Do not add npm packages.
- All file tools must use `resolveWorkspacePath`; truncate long outputs.
- Cross-platform: PowerShell on Windows, bash on POSIX; handle path separators and exit codes.
- Keep the SSE event contract stable (`ready`, `step`, `text-delta`, `reasoning-delta`, `assistant`, `tool-call`, `tool-result`, `approval-request`, `warning`, `error`, `done`, `session`, `end`).
- When changing behavior, update the matching doc in `docs/` and add/extend tests.

## Verification checklist before finishing

1. `npm test` — all tests pass.
2. `npm run lint` — clean.
3. Smoke test CLI: `node bin/chan.js models`, `node bin/chan.js tools`.
4. Smoke test server: start `node bin/chan.js serve --port 0` and hit `/api/health`, `/`, `/about`.
