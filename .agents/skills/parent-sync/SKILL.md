---
name: parent-sync
description: Use when syncing this fork against the upstream t3code parent, especially selective server-layer backports in `apps/server` such as provider runtime, adapters, `CodexAdapter`, `CodexSessionRuntime`, orchestration harnesses, `wsServer`, and `packages/effect-codex-app-server`. Trigger on upstream sync, parent merge, fork sync, cherry-picking parent fixes, comparing against `/tmp/t3code-parent`, server-layer divergence, or reviewing parent bug fixes and security fixes before porting them.
---

# Parent Sync

Use this skill when parent changes from `pingdotgg/t3code` need to be reviewed or ported into this fork.

This fork has diverged materially. Default to selective backports, not a blind `merge parent/main`.

This skill is self-maintaining. When a new parent-sync blocker, compatibility hazard, resolution pattern, or validated backport procedure is discovered, update this skill before concluding the work.

## Core Rules

- Protect the active worktree. If the current checkout is dirty, do comparison work in a separate worktree first.
- Scope the sync by subsystem before reading large diffs. For this repo, start with `apps/server`, then `packages/effect-codex-app-server` if Codex protocol/runtime drift is involved.
- Treat parent auth, HTTP, and startup layers as architectural changes, not routine cherry-picks.
- Treat a dry-run merge as a measurement tool only. If it explodes across transport, provider, auth, and package-layout seams, abort it and switch back to selective backports.
- Validate with `bun fmt`, `bun lint`, and `bun typecheck` before calling sync work complete.
- If required validation fails for an unrelated pre-existing issue, record the exact file and error and do not misreport it as a regression from the sync patch.
- When you hit a new blocker or solve one in a reusable way, say so plainly and update this skill. Preferred phrasing is direct, for example: `I'm updating the parent-sync skill so next time this blocker is handled correctly.`

## Default Workflow

1. Confirm the fork branch, dirty files, parent ref, and merge-base.
2. Diff `base..parent/main` and `base..HEAD` only in the target subsystem.
3. Create a separate review worktree for dry-run merge/conflict sizing.
4. Classify upstream deltas into:
   - `must-port now`
   - `evaluate if compatible`
   - `already present in fork`
   - `do not blind-merge`
5. Port minimal fixes into the fork's current architecture. Prefer small correctness backports such as restart conditions, probe timeout hardening, safer atomic writes, and subprocess teardown guards before touching parent transport/auth rewrites.
6. If the work exposed a new reusable lesson, update this skill and the relevant reference file before closeout.
7. Re-run required validation.

## Self-Maintenance Triggers

Update this skill when any of the following happens:

- A dry-run merge reveals a new recurring conflict hotspot.
- A parent fix looks important but cannot be backported cleanly, and the reason is now understood.
- A fork-local workaround is required because parent and fork architectures differ.
- A previously risky parent change is successfully ported and the safe porting pattern is now known.
- A security-sensitive exposure, auth gap, or protocol drift issue is identified.
- A validation trap appears, such as required checks failing for reasons unrelated to the skill files.

## Read These References

- Sync procedure and commands: [references/sync-playbook.md](references/sync-playbook.md)
- Scope, boundaries, and repo-specific rules: [references/scope-and-boundaries.md](references/scope-and-boundaries.md)
- Divergence hotspots and merge risk map: [references/conflict-hotspots.md](references/conflict-hotspots.md)
- Current known upstream gaps and fix candidates: [references/known-parent-gaps-2026-05-19.md](references/known-parent-gaps-2026-05-19.md)
- How and when to update this skill after blockers or fixes: [references/maintenance-loop.md](references/maintenance-loop.md)

## Fast Search Hints

Use targeted searches before opening large files:

```bash
rg -n "CodexProvider|CodexSessionRuntime|CodexAdapter|ProviderService|ProviderCommandReactor|ProviderRuntimeIngestion|wsServer" apps/server
rg -n "UPSTREAM_REF|app-server" packages/effect-codex-app-server
git diff --name-status <base>..parent/main -- apps/server packages/effect-codex-app-server
git diff --name-status <base>..HEAD -- apps/server packages/effect-codex-app-server
```
