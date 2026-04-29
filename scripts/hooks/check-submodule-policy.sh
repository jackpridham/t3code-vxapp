#!/usr/bin/env bash
set -euo pipefail

path=""
label="submodule"
expected_branch=""
remote="origin"
pointer_source="head"
advisory=0
fetch_remote=0
require_remote_match=0
check_branch_only=0
enforce_branch=0
declare -a enforce_branch_when_parent=()

usage() {
    echo "usage: $0 --path <submodule> [--label <label>] [--expected-branch <branch>] [--remote <remote>] [--pointer-source <head|index>] [--advisory] [--fetch-remote] [--require-remote-match] [--check-branch-only] [--enforce-branch] [--enforce-branch-when-parent <branch>]" >&2
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)
            path="${2:-}"
            shift 2
            ;;
        --label)
            label="${2:-}"
            shift 2
            ;;
        --expected-branch)
            expected_branch="${2:-}"
            shift 2
            ;;
        --remote)
            remote="${2:-}"
            shift 2
            ;;
        --pointer-source)
            pointer_source="${2:-}"
            shift 2
            ;;
        --advisory)
            advisory=1
            shift
            ;;
        --fetch-remote)
            fetch_remote=1
            shift
            ;;
        --require-remote-match)
            require_remote_match=1
            shift
            ;;
        --check-branch-only)
            check_branch_only=1
            shift
            ;;
        --enforce-branch)
            enforce_branch=1
            shift
            ;;
        --enforce-branch-when-parent)
            enforce_branch_when_parent+=("${2:-}")
            shift 2
            ;;
        *)
            usage
            ;;
    esac
done

if [[ -z "$path" ]]; then
    usage
fi

if [[ "$pointer_source" != "head" && "$pointer_source" != "index" ]]; then
    echo "invalid --pointer-source: $pointer_source" >&2
    exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

parent_branch="$(git branch --show-current 2>/dev/null || true)"

should_enforce_branch="$enforce_branch"
if [[ "$should_enforce_branch" -eq 0 && "${#enforce_branch_when_parent[@]}" -gt 0 ]]; then
    for branch in "${enforce_branch_when_parent[@]}"; do
        if [[ "$parent_branch" == "$branch" ]]; then
            should_enforce_branch=1
            break
        fi
    done
fi

declare -a lines=()
declare -a recovery=()

if ! current_head="$(git -C "$path" rev-parse HEAD 2>/dev/null)"; then
    lines+=("- git access failed for $path")
    lines+=("- initialize the submodule and verify $path is a valid git worktree")
else
    current_branch="$(git -C "$path" branch --show-current 2>/dev/null || true)"
    status_output="$(git -C "$path" status --short --untracked-files=normal 2>/dev/null || true)"

    if [[ "$should_enforce_branch" -eq 1 ]]; then
        if [[ -z "$current_branch" ]]; then
            lines+=("- $label is detached; expected branch ${expected_branch:-<branch>}")
            if [[ -n "$expected_branch" ]]; then
                recovery+=("git -C $path switch $expected_branch")
            fi
        elif [[ -n "$expected_branch" && "$current_branch" != "$expected_branch" ]]; then
            lines+=("- $label is on branch $current_branch; expected $expected_branch")
            recovery+=("git -C $path switch $expected_branch")
        fi
    fi

    if [[ "$check_branch_only" -eq 0 ]]; then
        if [[ -n "$status_output" ]]; then
            lines+=("- $label has uncommitted or untracked changes")
            recovery+=("git -C $path status --short")
        fi

        pointer_commit=""
        if [[ "$pointer_source" == "index" ]]; then
            pointer_commit="$(git ls-files --stage -- "$path" | awk '/^160000 / { print $2; exit }')"
            pointer_label="staged gitlink"
        else
            pointer_commit="$(git ls-tree HEAD "$path" | awk '/^160000 commit / { print $3; exit }')"
            pointer_label="committed gitlink"
        fi

        if [[ -z "$pointer_commit" ]]; then
            lines+=("- $pointer_label is missing for $path")
        elif [[ "$current_head" != "$pointer_commit" ]]; then
            lines+=("- $pointer_label records ${pointer_commit:0:7} instead of ${current_head:0:7}")
            recovery+=("git add $path")
            if [[ "$pointer_source" == "head" ]]; then
                recovery+=("git commit -m \"chore: update $path submodule\"")
            fi
        fi

        remote_head=""
        remote_ref="${remote}/${expected_branch:-$current_branch}"
        if [[ "$fetch_remote" -eq 1 && -n "$expected_branch" ]]; then
            if ! git -C "$path" fetch --quiet "$remote" "$expected_branch" 2>/dev/null; then
                lines+=("- failed to fetch $remote/$expected_branch")
                recovery+=("git -C $path fetch $remote $expected_branch")
            fi
        fi

        if [[ "$require_remote_match" -eq 1 ]]; then
            if remote_head="$(git -C "$path" rev-parse "$remote_ref" 2>/dev/null)"; then
                if [[ "$current_head" != "$remote_head" ]]; then
                    lines+=("- $label commit ${current_head:0:7} must match $remote_ref ${remote_head:0:7}")
                    recovery+=("git -C $path pull --ff-only $remote ${expected_branch:-$current_branch}")
                fi
            else
                lines+=("- could not resolve $remote_ref")
                if [[ -n "$expected_branch" ]]; then
                    recovery+=("git -C $path fetch $remote $expected_branch")
                fi
            fi
        fi
    fi
fi

if [[ "${#lines[@]}" -eq 0 ]]; then
    exit 0
fi

if [[ "${#recovery[@]}" -gt 0 ]]; then
    lines+=("- recovery:")
    declare -A seen=()
    for command in "${recovery[@]}"; do
        if [[ -n "${seen[$command]:-}" ]]; then
            continue
        fi
        seen["$command"]=1
        lines+=("  $command")
    done
fi

if [[ "$advisory" -eq 1 ]]; then
    echo "Advisory: $label should stay clean, attached, and in sync before you push." >&2
    echo >&2
    echo "Submodule policy requirements failed for $path" >&2
    printf '%s\n' "${lines[@]}" >&2
    exit 0
fi

echo "Submodule policy requirements failed for $path" >&2
printf '%s\n' "${lines[@]}" >&2
exit 1
