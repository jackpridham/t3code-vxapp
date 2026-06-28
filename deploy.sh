#!/usr/bin/env bash

set -euo pipefail

IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_CONFIG="${DEPLOY_CONFIG:-$REPO_ROOT/.vx/deploy.yaml}"
TOOLCHAIN_CONFIG="${TOOLCHAIN_CONFIG:-$REPO_ROOT/.vx/toolchain.yaml}"

yaml_top_value() {
    local file="$1"
    local key="$2"
    awk -v key="$key" '
        $0 ~ "^[[:space:]]*" key ":[[:space:]]*" {
            sub("^[[:space:]]*" key ":[[:space:]]*", "")
            print
            exit
        }
    ' "$file"
}

yaml_nested_value() {
    local file="$1"
    local section="$2"
    local key="$3"
    awk -v section="$section" -v key="$key" '
        $0 ~ "^" section ":[[:space:]]*$" { in_section=1; next }
        in_section && /^[^[:space:]]/ { exit }
        in_section && $0 ~ "^[[:space:]]{2}" key ":[[:space:]]*" {
            sub("^[[:space:]]{2}" key ":[[:space:]]*", "")
            print
            exit
        }
    ' "$file"
}

yaml_tool_value() {
    local file="$1"
    local tool="$2"
    local key="$3"
    awk -v tool="$tool" -v key="$key" '
        /^tools:[[:space:]]*$/ { in_tools=1; next }
        in_tools && /^[^[:space:]]/ { exit }
        in_tools && $0 ~ "^[[:space:]]{2}" tool ":[[:space:]]*$" { in_tool=1; next }
        in_tool && $0 ~ "^[[:space:]]{2}[[:alnum:]_-]+:[[:space:]]*$" { exit }
        in_tool && $0 ~ "^[[:space:]]{4}" key ":[[:space:]]*" {
            sub("^[[:space:]]{4}" key ":[[:space:]]*", "")
            print
            exit
        }
    ' "$file"
}

require_config() {
    local file="$1"
    if [[ ! -r "$file" ]]; then
        printf 'Missing required config: %s\n' "$file" >&2
        exit 1
    fi
}

require_config "$DEPLOY_CONFIG"
require_config "$TOOLCHAIN_CONFIG"

BUN_BIN="${BUN_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" bun default)}"
NODE_BIN="${NODE_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" node default)}"
VX_BIN="${VX_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" vx default)}"
SERVICE_NAME="${SERVICE_NAME:-$(yaml_top_value "$DEPLOY_CONFIG" serviceName)}"
SYSTEMD_DROPIN_DIR="/etc/systemd/system/${SERVICE_NAME}.service.d"
REPO_ROOT_DROPIN="${SYSTEMD_DROPIN_DIR}/30-agents-vxapp-repo-root.conf"
AUTORESUME_DROPIN="${SYSTEMD_DROPIN_DIR}/20-jasper-autoresume.conf"
AUTORESUME_UNIT_BASENAME="t3code-autoresume.service"
AUTORESUME_UNIT="/etc/systemd/system/${AUTORESUME_UNIT_BASENAME}"
HOST_ENV_KEY="$(yaml_nested_value "$DEPLOY_CONFIG" host env)"
HOST_DEFAULT="$(yaml_nested_value "$DEPLOY_CONFIG" host default)"
PORT_ENV_KEY="$(yaml_nested_value "$DEPLOY_CONFIG" port env)"
PORT_DEFAULT="$(yaml_nested_value "$DEPLOY_CONFIG" port default)"
HOST="${!HOST_ENV_KEY:-$HOST_DEFAULT}"
PORT="${!PORT_ENV_KEY:-$PORT_DEFAULT}"
NO_BROWSER_FLAG="--no-browser"
LOG_FILE="${DEPLOY_LOG_FILE:-$(yaml_top_value "$DEPLOY_CONFIG" logFile)}"
PID_FILE="${DEPLOY_PID_FILE:-$(yaml_top_value "$DEPLOY_CONFIG" pidFile)}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-$(yaml_top_value "$DEPLOY_CONFIG" readyTimeoutSeconds)}"
WS_READY_TIMEOUT_SECONDS="${WS_READY_TIMEOUT_SECONDS:-$(yaml_top_value "$DEPLOY_CONFIG" wsReadyTimeoutSeconds)}"
FALLBACK_DIRECT_NODE_ALLOWED="${FALLBACK_DIRECT_NODE_ALLOWED:-$(yaml_nested_value "$DEPLOY_CONFIG" fallbackDirectNode allowedWhenSystemdUnavailable)}"
NO_WAKE_MARKER="${T3CODE_SUPPRESS_STARTUP_ORCHESTRATOR_WAKE_MARKER:-$(yaml_top_value "$DEPLOY_CONFIG" noWakeMarker)}"
NO_WAKE=0
AGENTS_VXAPP_REPO_ROOT=""
AGENTS_VXAPP_REPO_ROOT_ALIASES=(
    T3_AGENTS_VXAPP_REPO_ROOT
    AGENTS_VXAPP_REPO_ROOT
    VX_AGENTS_REPO_ROOT
)
AGENTS_VXAPP_REQUIRED_ENTRYPOINTS=(
    scripts/tools/t3-control-plane-owner
    scripts/tools/role-session-owner
)

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
  - Uses the configured systemd unit whenever it exists.
  - Falls back to a direct background Node process only when systemd is
    unavailable or the service unit is not installed.
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

canonical_path() {
    local candidate="$1"
    if [[ -d "$candidate" ]]; then
        (cd "$candidate" && pwd -P)
    else
        printf '%s\n' "$candidate"
    fi
}

has_agents_vxapp_entrypoints() {
    local repo_root="$1"
    local entrypoint

    for entrypoint in "${AGENTS_VXAPP_REQUIRED_ENTRYPOINTS[@]}"; do
        if [[ ! -e "$repo_root/$entrypoint" ]]; then
            return 1
        fi
    done

    return 0
}

resolve_agents_vxapp_repo_root() {
    if [[ -n "$AGENTS_VXAPP_REPO_ROOT" ]]; then
        return 0
    fi

    local alias
    local value
    local resolved=""
    local details=()

    for alias in "${AGENTS_VXAPP_REPO_ROOT_ALIASES[@]}"; do
        value="${!alias:-}"
        if [[ -z "$value" ]]; then
            continue
        fi

        value="$(canonical_path "$value")"
        details+=("$alias=$value")
        if [[ -z "$resolved" ]]; then
            resolved="$value"
        elif [[ "$resolved" != "$value" ]]; then
            printf 'agents-vxapp repo-root env aliases disagree: %s\n' "${details[*]}" >&2
            return 1
        fi
    done

    if [[ -z "$resolved" ]]; then
        resolved="$(canonical_path "$REPO_ROOT/../agents-vxapp")"
        log "Using sibling agents-vxapp checkout: $resolved"
    fi

    if ! has_agents_vxapp_entrypoints "$resolved"; then
        printf 'Unable to resolve a valid agents-vxapp checkout at %s. Set one of %s.\n' \
            "$resolved" "${AGENTS_VXAPP_REPO_ROOT_ALIASES[*]}" >&2
        return 1
    fi

    AGENTS_VXAPP_REPO_ROOT="$resolved"
    export T3_AGENTS_VXAPP_REPO_ROOT="$AGENTS_VXAPP_REPO_ROOT"
}

service_is_active() {
    if ! systemd_is_available; then
        return 1
    fi
    systemctl is-active --quiet "$SERVICE_NAME"
}

systemd_is_available() {
    command -v systemctl >/dev/null 2>&1
}

systemd_service_load_state() {
    if ! systemd_is_available; then
        return 1
    fi

    systemctl show "$SERVICE_NAME" --property=LoadState --value 2>/dev/null || true
}

systemd_service_is_defined() {
    local load_state
    load_state="$(systemd_service_load_state)"
    [[ -n "$load_state" && "$load_state" != "not-found" ]]
}

can_use_sudo_systemctl() {
    systemd_is_available && command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

can_manage_systemd_service() {
    systemd_service_is_defined && ([[ "${EUID:-$(id -u)}" -eq 0 ]] || can_use_sudo_systemctl)
}

can_use_direct_process_fallback() {
    [[ "${FALLBACK_DIRECT_NODE_ALLOWED,,}" == "true" ]] || return 1

    if systemd_service_is_defined; then
        return 1
    fi

    return 0
}

run_system_service_cmd() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        "$@"
        return 0
    fi

    sudo -n "$@"
}

install_repo_root_dropin() {
    resolve_agents_vxapp_repo_root
    run_system_service_cmd install -d "$SYSTEMD_DROPIN_DIR"
    printf '[Service]\nEnvironment=T3_AGENTS_VXAPP_REPO_ROOT=%s\n' "$AGENTS_VXAPP_REPO_ROOT" |
        run_system_service_cmd tee "$REPO_ROOT_DROPIN" >/dev/null
}

retire_autoresume_systemd_units() {
    run_system_service_cmd rm -f "$AUTORESUME_DROPIN" "$AUTORESUME_UNIT"
}

wait_for_http() {
    local url="http://127.0.0.1:${PORT}/health/ready"
    local attempt

    for attempt in $(seq 1 "$READY_TIMEOUT_SECONDS"); do
        if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done

    printf 'Server did not respond at %s after %s seconds.\n' "$url" "$READY_TIMEOUT_SECONDS" >&2
    return 1
}

verify_systemd_service() {
    if ! systemd_is_available; then
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
    local status_json=""

    for attempt in $(seq 1 "$WS_READY_TIMEOUT_SECONDS"); do
        if status_json=$("$VX_BIN" t3 status --json 2>/dev/null); then
            if printf '%s\n' "$status_json" | jq -e '.ok == true' >/dev/null 2>&1; then
                return 0
            fi
        fi
        sleep 1
    done

    printf 'T3 owner CLI did not become ready after %s seconds.\n' "$WS_READY_TIMEOUT_SECONDS" >&2
    if [[ -n "$status_json" ]]; then
        printf '%s\n' "$status_json" >&2
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
    if ! can_manage_systemd_service; then
        return 1
    fi

    install_repo_root_dropin
    retire_autoresume_systemd_units
    run_system_service_cmd systemctl daemon-reload
    run_system_service_cmd systemctl restart "$SERVICE_NAME"
    wait_for_http || return 1
    verify_systemd_service || return 1
    wake_cto_after_deploy || return 1
    return 0

}

start_direct_process() {
    step "Starting direct Node process"
    prepare_startup_wake_suppression
    resolve_agents_vxapp_repo_root

    mkdir -p /tmp
    pkill -f "$REPO_ROOT/apps/server/dist/index.mjs --host ${HOST} --port ${PORT} --no-browser" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"

    nohup env \
        NODE_ENV=production \
        T3_AGENTS_VXAPP_REPO_ROOT="$AGENTS_VXAPP_REPO_ROOT" \
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

deploy_with_runtime_restart() {
    if systemd_service_is_defined; then
        if ! restart_via_systemd; then
            printf 'systemd manages %s on this host. Fix the unit or sudo access instead of starting a parallel direct process.\n' "$SERVICE_NAME" >&2
            exit 1
        fi
        return 0
    fi

    if can_use_direct_process_fallback; then
        start_direct_process
        return 0
    fi

    printf 'No usable runtime owner found for %s. Install the systemd unit or explicitly allow the direct-process fallback.\n' "$SERVICE_NAME" >&2
    exit 1
}

show_status() {
    step "Status"

    if service_is_active; then
        log "Service: ${SERVICE_NAME} active"
    elif systemd_service_is_defined; then
        log "Service: ${SERVICE_NAME} installed but inactive"
    else
        log "Service: ${SERVICE_NAME} not installed"
    fi

    if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health/ready" >/dev/null 2>&1; then
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
            deploy_with_runtime_restart
            ;;
        --full)
            run_install
            run_build
            deploy_with_runtime_restart
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
