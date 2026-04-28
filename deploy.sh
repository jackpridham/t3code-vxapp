#!/usr/bin/env bash

set -euo pipefail

IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN_BIN="${BUN_BIN:-/home/gizmo/.bun/bin/bun}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
VX_BIN="${VX_BIN:-/home/gizmo/vortex-scripts/bin/vx}"
SERVICE_NAME="${SERVICE_NAME:-t3code}"
HOST="${T3CODE_HOST:-0.0.0.0}"
PORT="${T3CODE_PORT:-7421}"
NO_BROWSER_FLAG="--no-browser"
LOG_FILE="${DEPLOY_LOG_FILE:-/tmp/t3code-vxapp-deploy.log}"
PID_FILE="${DEPLOY_PID_FILE:-/tmp/t3code-vxapp-deploy.pid}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-120}"
WS_READY_TIMEOUT_SECONDS="${WS_READY_TIMEOUT_SECONDS:-60}"
NO_WAKE_MARKER="${T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE_MARKER:-/tmp/t3code-vxapp-no-wake}"
NO_WAKE=0

export PATH="$(dirname "$BUN_BIN"):$PATH"

usage() {
    cat <<'EOF'
Usage: ./deploy.sh [--full|--build-only|--ui-only|--restart-only|--status] [--no-wake]

Default mode is --full:
  1. bun install
  2. bun run build
  3. restart the live server
  4. verify http://127.0.0.1:7421/

`--ui-only`:
  1. bun install
  2. build only the web workspace
  3. refresh apps/server/dist/client
  4. keep the current server process running

Options:
  --no-wake       Skip the post-deploy CTO wake after restart.

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
    local url="http://127.0.0.1:${PORT}/health/ready"
    local attempt

    for attempt in $(seq 1 "$READY_TIMEOUT_SECONDS"); do
        if curl -fsS --max-time 3 "$url" >/dev/null; then
            return 0
        fi
        sleep 1
    done

    printf 'Server did not respond at %s after %s seconds.\n' "$url" "$READY_TIMEOUT_SECONDS" >&2
    return 1
}

verify_systemd_service() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        return 0
    fi

    printf 'Systemd reports %s is not active after restart.\n' "$SERVICE_NAME" >&2
    systemctl status "$SERVICE_NAME" --no-pager || true
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

run_web_build() {
    step "Building web UI assets"
    cd "$REPO_ROOT"
    "$BUN_BIN" run build --filter=@t3tools/web
}

bundle_web_client() {
    step "Refreshing bundled web client assets"
    cd "$REPO_ROOT/apps/server"
    "$NODE_BIN" scripts/cli.ts bundle-client
}

prepare_startup_wake_suppression() {
    step "Suppressing startup orchestrator wake drain"
    mkdir -p "$(dirname "$NO_WAKE_MARKER")"
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$NO_WAKE_MARKER"
    log "No-wake marker: $NO_WAKE_MARKER"
}

wait_for_t3_ws() {
    local attempt
    local doctor_json=""

    for attempt in $(seq 1 "$WS_READY_TIMEOUT_SECONDS"); do
        if doctor_json=$("$VX_BIN" t3 doctor --json 2>/dev/null); then
            if printf '%s\n' "$doctor_json" | jq -e '.ws_roundtrip.ok == true' >/dev/null 2>&1; then
                return 0
            fi
        fi
        sleep 1
    done

    printf 'T3 WebSocket did not become ready after %s seconds.\n' "$WS_READY_TIMEOUT_SECONDS" >&2
    if [[ -n "$doctor_json" ]]; then
        printf '%s\n' "$doctor_json" >&2
    fi
    return 1
}

wake_cto_after_deploy() {
    if [[ "$NO_WAKE" == "1" ]]; then
        step "Skipping CTO wake"
        log "Post-deploy CTO wake disabled via --no-wake"
        return 0
    fi

    step "Waking CTO post-deploy"
    require_cmd "$VX_BIN"
    require_cmd jq
    wait_for_t3_ws || return 1

    local status_json=""
    local ensure_json=""
    local cto_thread_id=""
    local jasper_thread_id=""
    local wake_message=""

    status_json=$("$VX_BIN" t3 cto status --json)
    cto_thread_id=$(printf '%s\n' "$status_json" | jq -r '.cto.currentThread.id // empty' 2>/dev/null || true)

    if [[ -z "$cto_thread_id" ]]; then
        ensure_json=$("$VX_BIN" t3 cto ensure --json)
        cto_thread_id=$(printf '%s\n' "$ensure_json" | jq -r '.threadId // empty' 2>/dev/null || true)
        status_json=$("$VX_BIN" t3 cto status --json)
    fi

    if [[ -z "$cto_thread_id" ]]; then
        printf 'CTO wake failed: unable to resolve current CTO thread.\n' >&2
        return 1
    fi

    jasper_thread_id=$(printf '%s\n' "$status_json" | jq -r '.jasper.currentThread.id // empty' 2>/dev/null || true)

    wake_message=$(cat <<EOF
deploy-complete

t3code-vxapp was restarted successfully and passed http://127.0.0.1:${PORT}/health/ready.

Review executive attention and decide whether Jasper needs a continuation nudge.
This deploy now suppresses the old startup orchestrator wake drain and routes the post-deploy review to CTO instead.

CTO thread id: ${cto_thread_id}
Jasper thread id: ${jasper_thread_id:-none}

Inspect:
- vx t3 cto attention --json
- vx t3 cto operate --once --json
EOF
)

    "$VX_BIN" t3 threads start --thread "$cto_thread_id" --message "$wake_message" --json >/dev/null
    log "CTO wake sent to thread $cto_thread_id"
}

restart_via_systemd() {
    step "Restarting systemd service"
    prepare_startup_wake_suppression

    if can_use_sudo_systemctl; then
        sudo -n systemctl restart "$SERVICE_NAME"
        wait_for_http || return 1
        verify_systemd_service || return 1
        wake_cto_after_deploy || return 1
        return 0
    fi

    if systemctl restart "$SERVICE_NAME" >/dev/null 2>&1; then
        wait_for_http || return 1
        verify_systemd_service || return 1
        wake_cto_after_deploy || return 1
        return 0
    fi

    return 1
}

start_direct_process() {
    step "Starting direct Node process"
    prepare_startup_wake_suppression

    mkdir -p /tmp
    pkill -f "/home/gizmo/t3code-vxapp/apps/server/dist/index.mjs --host ${HOST} --port ${PORT} --no-browser" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"

    nohup env \
        PATH="/home/gizmo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
        NODE_ENV=production \
        T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE="$NO_WAKE" \
        T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE_MARKER="$NO_WAKE_MARKER" \
        "$NODE_BIN" "$REPO_ROOT/apps/server/dist/index.mjs" \
        --host "$HOST" \
        --port "$PORT" \
        "$NO_BROWSER_FLAG" \
        >"$LOG_FILE" 2>&1 &

    echo $! >"$PID_FILE"
    wait_for_http

    log "Direct process started with pid $(cat "$PID_FILE")"
    log "Log file: $LOG_FILE"
    wake_cto_after_deploy
}

show_status() {
    step "Status"

    if service_is_active; then
        log "Service: ${SERVICE_NAME} active"
    else
        log "Service: ${SERVICE_NAME} inactive"
    fi

    if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health/ready" >/dev/null; then
        log "Ready:   http://127.0.0.1:${PORT}/health/ready responding"
    else
        log "Ready:   http://127.0.0.1:${PORT}/health/ready not responding"
    fi
}

main() {
    local mode="--full"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --full|--build-only|--ui-only|--restart-only|--status|-h|--help|help)
                mode="$1"
                ;;
            --no-wake)
                NO_WAKE=1
                ;;
            *)
                printf 'Unknown option: %s\n\n' "$1" >&2
                usage >&2
                exit 1
                ;;
        esac
        shift
    done

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
        --ui-only)
            run_install
            run_web_build
            bundle_web_client
            show_status
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
