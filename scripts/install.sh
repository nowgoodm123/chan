#!/usr/bin/env bash
# chan_code installer for macOS and Linux
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${NPM_PREFIX:-}"

info() { printf '\033[36m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
fail() { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

info "chan_code installer"
info "source: $ROOT"

command -v node >/dev/null 2>&1 || fail "Node.js was not found. Install Node.js 18.17+ from https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "npm was not found. Reinstall Node.js with npm included."

NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18.17+ is required (found $NODE_VERSION)"
info "node:   v$NODE_VERSION"

cd "$ROOT"
if [ -n "$PREFIX" ]; then
  mkdir -p "$PREFIX"
  info "installing to npm prefix: $PREFIX"
  npm install -g . --prefix "$PREFIX"
elif npm install -g .; then
  :
else
  warn "Global install failed (permissions?)."
  warn "Try one of:"
  echo "  npm install -g . --prefix \"\$HOME/.npm-global\""
  echo "  sudo npm install -g ."
  echo "  npm link"
  echo "  node bin/chan.js --help   (run without installing)"
  exit 1
fi

if command -v chan >/dev/null 2>&1; then
  chan --version
else
  warn '"chan" is not on PATH yet. Add your npm global bin directory to PATH.'
fi

cat <<'EOF'

installed. next steps:
  chan init --provider deepseek
  export DEEPSEEK_API_KEY="sk-..."
  chan                     # terminal chat
  chan serve --open        # browser UI with image/file upload

docs: docs/GETTING_STARTED.md
EOF
