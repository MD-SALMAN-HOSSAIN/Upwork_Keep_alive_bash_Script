#!/usr/bin/env bash
#
# Launcher for keepalive.js (macOS, Linux, WSL, or Git Bash).
# Usage:
#   chmod +x run.sh
#   ./run.sh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export DASHBOARD_URL="${DASHBOARD_URL:-https://www.upwork.com/nx/find-work/}"
export CDP_URL="${CDP_URL:-http://127.0.0.1:9222}"
export MIN_MINUTES="${MIN_MINUTES:-2}"
export MAX_MINUTES="${MAX_MINUTES:-5}"

info() {
  printf '[run.sh] %s\n' "$*" >&2
}

die() {
  printf '[run.sh] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die "Node.js 18+ is required: https://nodejs.org/"

if [ ! -d "node_modules/puppeteer-core" ]; then
  command -v npm >/dev/null 2>&1 || die "npm is required to install dependencies."
  info "Installing dependencies (first run)..."
  npm install --no-audit --no-fund
fi

if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS --max-time 3 "${CDP_URL%/}/json/version" >/dev/null 2>&1; then
    cat >&2 <<'EOF'
[run.sh] Chrome is not reachable on the remote-debugging port.

Start Chrome with remote debugging first, then log in to the dashboard once:

  macOS:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --remote-debugging-port=9222 \
      --user-data-dir="$HOME/.chrome-debug-profile"

  Linux:
    google-chrome --remote-debugging-port=9222 \
      --user-data-dir="$HOME/.chrome-debug-profile"

  Windows (PowerShell):
    & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
      --remote-debugging-port=9222 `
      --user-data-dir="$env:USERPROFILE\.chrome-debug-profile"

Chrome 136+ requires the non-default --user-data-dir flag.
Set CDP_URL if Chrome is listening on a different host or port.
EOF
    exit 1
  fi
else
  info "curl not found; skipping the CDP reachability check."
fi

info "Starting keep-alive for ${DASHBOARD_URL} (every ${MIN_MINUTES}-${MAX_MINUTES} min)"
exec node keepalive.js
