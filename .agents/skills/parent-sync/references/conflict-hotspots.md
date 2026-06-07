# Conflict Hotspots

## Summary

This fork and parent have diverged enough that merge conflicts cluster around architecture seams, not just file edits.

## High-Risk Hotspots

### 1. `apps/server/src/wsServer.ts` vs parent HTTP/auth/server split

The fork still owns a large `wsServer.ts`.

Parent moved significant startup and transport responsibilities into:

- `apps/server/src/server.ts`
- `apps/server/src/http.ts`
- `apps/server/src/auth/*`

Implication:

- do not try to transplant parent transport/auth files wholesale into the fork without a deliberate redesign

### 2. Provider runtime stack

Parent expanded and refactored provider infrastructure across:

- `ProviderRegistry`
- `ProviderService`
- `ProviderSessionDirectory`
- `CodexProvider`
- `CodexAdapter`
- `CodexSessionRuntime`
- driver and maintenance layers

The fork has overlapping but not identical runtime ownership and vxapp integration.

Implication:

- cherry-pick correctness fixes
- avoid broad provider-layer merges

### 3. Orchestration coupling

Files such as:

- `ProviderCommandReactor.ts`
- `ProviderRuntimeIngestion.ts`
- `ProjectionPipeline.ts`
- `projector.ts`

carry fork-specific orchestration semantics.

Implication:

- parent fixes in these files must be reviewed semantically, not mechanically

### 4. `packages/effect-codex-app-server`

This package is a major sync seam because:

- it tracks upstream Codex protocol schema refs
- parent and fork can both change generated files and wrapper APIs

Implication:

- always compare `UPSTREAM_REF`
- treat generator changes and wrapper changes separately

### 5. Parent auth and pairing system

Parent added:

- auth bootstrap
- pairing/session credentials
- secret store hardening
- CORS handling for remote pairing routes

This fork currently does not mirror that full system.

Implication:

- review as a security delta
- do not assume it is a drop-in backport

## Current Overlap With Dirty Local Files

As of the review that informed this skill, local uncommitted edits overlapped with:

- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/wsServer.ts`

Those are precisely the kinds of files where parent sync work should be layered carefully, not force-merged.

## Dry-Run Merge Interpretation

If a review worktree shows very high conflict counts, that is evidence for selective porting, not a signal to spend hours resolving a broad merge.

During the 2026-05-19 review, a dry-run merge from `parent/main` produced:

- `167` conflicted paths
- `1103` changed paths before abort

That run also confirmed another practical hotspot:

### 6. Package-layout and app-surface divergence

Parent still carries large surfaces this fork has deleted or restructured, including:

- `apps/desktop/*`
- `apps/marketing/*`
- parent `server.ts` / `http.ts` / `auth/*` split
- parent-side contract and generated package moves

Implication:

- a broad merge will spend most of its effort on non-target architecture conflicts before you even reach the intended server-layer fixes
- if the user only cares about harness, adapters, provider runtime, `wsServer`, or Codex protocol drift, do not expand scope into these app-surface conflicts
