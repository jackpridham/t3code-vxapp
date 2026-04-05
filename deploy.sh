#!/usr/bin/env bash

set -euo pipefail

IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN_BIN="${BUN_BIN:-/home/gizmo/.bun/bin/bun}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
SERVICE_NAME="${SERVICE_NAME:-t3code}"
HOST="${T3CODE_HOST:-0.0.0.0}"
PORT="${T3CODE_PORT:-7421}"
NO_BROWSER_FLAG="--no-browser"
LOG_FILE="${DEPLOY_LOG_FILE:-/tmp/t3code-vxapp-deploy.log}"
PID_FILE="${DEPLOY_PID_FILE:-/tmp/t3code-vxapp-deploy.pid}"

export PATH="$(dirname "$BUN_BIN"):$PATH"

usage() {
    cat <<'EOF'
Usage: ./deploy.sh [--full|--build-only|--restart-only|--status]

Default mode is --full:
  1. bun install
  2. bun run build
  3. restart the live server
  4. verify http://127.0.0.1:7421/

Fallback behavior:
  - Uses systemd restart when available.
  - Falls back to a direct background Node process only if the systemd
    service is not active.
EOF
}

log() {
    printf '%s\n' "$*"
}

step() {
    printf '\n==> %s\n' "$*"
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'Missing required command: %s\n' "$1" >&2
        exit 1
    fi
}

service_is_active() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 1
    fi
    systemctl is-active --quiet "$SERVICE_NAME"
}

can_use_sudo_systemctl() {
    command -v systemctl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

wait_for_http() {
    local url="http://127.0.0.1:${PORT}/"
    local attempt

    for attempt in $(seq 1 30); do
        if curl -fsS --max-time 3 "$url" >/dev/null; then
            return 0
        fi
        sleep 1
    done

    printf 'Server did not respond at %s after 30 seconds.\n' "$url" >&2
    return 1
}

run_install() {
    step "Installing dependencies"
    cd "$REPO_ROOT"
    "$BUN_BIN" install
}

run_build() {
    step "Building production assets"
    cd "$REPO_ROOT"
    "$BUN_BIN" run build
}

restart_via_systemd() {
    step "Restarting systemd service"

    if can_use_sudo_systemctl; then
        sudo -n systemctl restart "$SERVICE_NAME" --no-block
        wait_for_http
        return 0
    fi

    if systemctl restart "$SERVICE_NAME" --no-block >/dev/null 2>&1; then
        wait_for_http
        return 0
    fi

    return 1
}

start_direct_process() {
    step "Starting direct Node process"

    mkdir -p /tmp
    pkill -f "/home/gizmo/t3code-vxapp/apps/server/dist/index.mjs --host ${HOST} --port ${PORT} --no-browser" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"

    nohup env \
        PATH="/home/gizmo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
        NODE_ENV=production \
        "$NODE_BIN" "$REPO_ROOT/apps/server/dist/index.mjs" \
        --host "$HOST" \
        --port "$PORT" \
        "$NO_BROWSER_FLAG" \
        >"$LOG_FILE" 2>&1 &

    echo $! >"$PID_FILE"
    wait_for_http

    log "Direct process started with pid $(cat "$PID_FILE")"
    log "Log file: $LOG_FILE"
}

show_status() {
    step "Status"

    if service_is_active; then
        log "Service: ${SERVICE_NAME} active"
    else
        log "Service: ${SERVICE_NAME} inactive"
    fi

    if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/" >/dev/null; then
        log "HTTP:    http://127.0.0.1:${PORT}/ responding"
    else
        log "HTTP:    http://127.0.0.1:${PORT}/ not responding"
    fi
}

main() {
    local mode="${1:---full}"

    require_cmd curl
    require_cmd "$BUN_BIN"
    require_cmd "$NODE_BIN"

    case "$mode" in
        -h|--help|help)
            usage
            ;;
        --status)
            show_status
            ;;
        --build-only)
            run_install
            run_build
            ;;
        --restart-only)
            if service_is_active; then
                if ! restart_via_systemd; then
                    printf 'systemd restart is unavailable, but %s is active. No safe fallback exists.\n' "$SERVICE_NAME" >&2
                    exit 1
                fi
            else
                start_direct_process
            fi
            ;;
        --full)
            run_install
            run_build
            if service_is_active; then
                if ! restart_via_systemd; then
                    printf 'systemd restart is unavailable while %s is active. Cannot complete deploy.\n' "$SERVICE_NAME" >&2
                    exit 1
                fi
            else
                start_direct_process
            fi
            show_status
            ;;
        *)
            printf 'Unknown mode: %s\n\n' "$mode" >&2
            usage >&2
            exit 1
            ;;
    esac
}

main "$@"
