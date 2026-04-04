#!/bin/bash
#=============================================================================
# dev.sh — Start T3 Code dev server (hot-reload, isolated DB)
#=============================================================================
#
# Runs Vite (web) + bun (server) in dev mode:
#   - Web:    http://0.0.0.0:5733  (Vite HMR, hot-reload on file changes)
#   - Server: http://0.0.0.0:3773  (WS/API backend)
#   - DB:     ~/.t3/dev/state.sqlite  (isolated from production)
#
# Production (port 7421) is NOT affected.
#
# Usage:
#   ./dev.sh          # start both server + web
#   ./dev.sh stop     # kill running dev processes
#
#=============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST_IP="${HOST_IP:-192.168.100.42}"
SERVER_PORT=3773
WEB_PORT=5733

cleanup() {
    echo ""
    echo "Shutting down dev server..."
    kill $(jobs -p) 2>/dev/null
    wait 2>/dev/null
    echo "Done."
}

stop_dev() {
    echo "Stopping dev server..."
    pkill -f "bun run src/index.ts" 2>/dev/null || true
    pkill -f "vite.*--host" 2>/dev/null || true
    echo "Done."
}

if [[ "${1:-}" == "stop" ]]; then
    stop_dev
    exit 0
fi

# Kill any stale dev processes
stop_dev 2>/dev/null

trap cleanup EXIT INT TERM

# Build contracts first (server + web depend on them)
echo "Building contracts..."
cd "$REPO_ROOT" && npx turbo run build --filter=@t3tools/contracts 2>&1 | tail -3

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  T3 Code Dev Server                         │"
echo "  │                                             │"
echo "  │  Web:    http://${HOST_IP}:${WEB_PORT}/     │"
echo "  │  Server: ws://${HOST_IP}:${SERVER_PORT}/    │"
echo "  │  DB:     ~/.t3/dev/state.sqlite             │"
echo "  │                                             │"
echo "  │  Ctrl+C to stop                             │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# Start server (background)
(
    export T3CODE_PORT=$SERVER_PORT
    export T3CODE_HOST=0.0.0.0
    export T3CODE_MODE=web
    export T3CODE_HOME="$HOME/.t3"
    export T3CODE_NO_BROWSER=1
    export T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1
    export T3CODE_LOG_WS_EVENTS=1
    export VITE_DEV_SERVER_URL="http://${HOST_IP}:${WEB_PORT}"
    cd "${REPO_ROOT}/apps/server"
    exec bun run src/index.ts
) 2>&1 | sed 's/^/[server] /' &

# Wait for server to start
sleep 3

# Start Vite web (foreground — catches Ctrl+C)
export PORT=$WEB_PORT
export VITE_WS_URL="ws://${HOST_IP}:${SERVER_PORT}"
cd "${REPO_ROOT}/apps/web"
exec npx vite --host 0.0.0.0
