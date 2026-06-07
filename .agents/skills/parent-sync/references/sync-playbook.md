# Parent Sync Playbook

## Goal

Review and port upstream parent fixes into this fork without destabilizing the fork's server architecture or overwriting local work.

## Safe Procedure

### 1. Confirm state first

Run:

```bash
git status --short
git branch --show-current
git rev-parse --short HEAD
git -C /tmp/t3code-parent rev-parse --short HEAD
```

If the active worktree is dirty in target files, do not merge there.

### 2. Fetch parent refs into the fork clone

If `parent/main` is not already available:

```bash
git fetch /tmp/t3code-parent '+refs/heads/*:refs/remotes/parent/*'
```

Then compute the shared base:

```bash
BASE=$(git merge-base HEAD parent/main)
echo "$BASE"
```

If a repo-local upstream remote already exists, prefer reusing it for comparison first. In this fork, `t3code/main` may already be present and is useful for quick confirmation before fetching from `/tmp/t3code-parent`.

### 3. Diff by subsystem

Examples:

```bash
git diff --name-status $BASE..parent/main -- apps/server
git diff --name-status $BASE..HEAD -- apps/server
git log --oneline --no-merges $BASE..parent/main -- apps/server/src/provider
```

Start narrow:

- `apps/server/src/provider`
- `apps/server/src/orchestration`
- `apps/server/integration`
- `apps/server/src/wsServer.ts`
- `packages/effect-codex-app-server`

### 4. Use a separate review worktree

Create one from the fork's committed head:

```bash
git worktree add /tmp/t3code-sync-review -b sync/<date>-review HEAD
```

Dry-run merge there only:

```bash
git -C /tmp/t3code-sync-review merge --no-commit --no-ff parent/main
git -C /tmp/t3code-sync-review merge --abort
```

Use the dry-run only to measure conflict shape. Do not treat it as the sync strategy.

After aborting, verify the review worktree is clean again before continuing:

```bash
git -C /tmp/t3code-sync-review status --short
```

### 5. Classify parent deltas

Sort changes into:

- `must-port now`
  Small correctness, crash, or security fixes that fit current fork architecture.
- `evaluate if compatible`
  Useful fixes that depend on nearby parent refactors.
- `already present in fork`
  Parent fix exists here under different code.
- `do not blind-merge`
  Parent architecture changes that would destabilize the fork if pulled wholesale.

### 6. Port minimally

Prefer patching the fork's current files over importing whole parent modules when:

- parent deleted the fork file entirely
- parent moved logic to a different transport or startup model
- the fork already has vxapp-specific or orchestration-specific behavior layered on top

Validated safe backport patterns in this fork now include:

- add missing restart conditions in existing reactor logic instead of replacing the whole reactor
- widen probe timeouts in the current provider layer without importing parent maintenance/driver infrastructure
- add subprocess teardown guards like `forceKillAfter` in the current runtime spawn path
- extract small reusable local helpers like atomic file writes instead of importing parent persistence/layout changes

### 7. Validate

Required repo checks:

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test <path>` only when targeted tests are needed. Never use `bun test`.

If `bun typecheck` fails in an unrelated pre-existing area, record:

- the exact file
- the exact type mismatch category
- that formatting/lint still passed

Do not silently waive it, and do not misreport it as caused by the server sync.

## Current Practical Rule

For this repo, a broad merge from parent is not a viable first move. The normal path is:

1. review
2. classify
3. backport targeted fixes
4. validate
