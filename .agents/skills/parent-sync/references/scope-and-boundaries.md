# Scope And Boundaries

## What This Skill Covers

This skill is for upstream sync work in this fork, with priority on:

- `apps/server/src/provider`
- `apps/server/src/orchestration`
- `apps/server/integration`
- `apps/server/src/wsServer.ts`
- `packages/effect-codex-app-server`

It is especially relevant when the user asks about:

- parent server-layer changes
- harness changes
- adapter changes
- `CodexAdapter`
- `CodexSessionRuntime`
- provider/runtime recovery
- upstream bug fixes
- upstream security fixes

## What This Skill Does Not Assume

- It does not assume parent and fork can be merged directly.
- It does not assume parent architecture is authoritative for this fork.
- It does not assume local dirty files are disposable.

## Repo-Specific Constraints

- `AGENTS.md` requires `bun fmt`, `bun lint`, and `bun typecheck` before completion.
- This repo is Codex-first and has custom orchestration, vxapp integration, and worker/runtime layering that do not exist upstream in the same shape.
- Duplicate truth and cross-repo ownership are active design concerns here. Avoid syncing parent code that reintroduces them.

## Current Architectural Boundary

Use narrow adapters where possible. A useful local principle already exists in:

- `packages/orchestration-core/README.md`

That boundary matters during parent sync:

- keep pure orchestration logic separate from server-owned runtime concerns
- avoid patching upstream-style modules directly when the fork has already extracted or wrapped them

## Dirty Worktree Rule

If target files are locally modified:

- inspect the local diff first
- patch on top of local edits only if the change is clearly compatible
- otherwise move the sync trial into a separate worktree and report the overlap

## Validation Boundary

Do not stop after "the diff looks right." A sync is incomplete until:

- formatting passes
- lint passes
- typecheck passes
- targeted tests cover the touched subsystem when the change is risky
