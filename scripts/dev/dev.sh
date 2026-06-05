#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(git -C "$BOOTSTRAP_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$PROJECT_ROOT" ]; then
    printf 'FAIL: Unable to resolve the git checkout that contains %s\n' "$BOOTSTRAP_SCRIPT_DIR/dev.sh" >&2
    exit 1
fi

SCRIPT_DIR="$PROJECT_ROOT/scripts/dev"

if [ "$BOOTSTRAP_SCRIPT_DIR" != "$SCRIPT_DIR" ]; then
    printf 'FAIL: scripts/dev/dev.sh must run from the checkout that contains scripts/dev\n' >&2
    exit 1
fi

exec node "$SCRIPT_DIR/manager.ts" "$@"
