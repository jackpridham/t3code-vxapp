# External Role Authority Bootstrap Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make orchestration bootstrap, current-state hydration, and routed thread detail survive `external_role_authority_snapshot` contradictions so the CTO thread and orchestration sidebar keep rendering truthy local projection data instead of blanking the app.

**Architecture:** Add one shared server-side recovery helper for the specific owner failure `ownerErrorCode === "authority_contradiction"`, and make the bootstrap and operational projection queries degrade to an empty external-role-authority overlay instead of failing the whole read path. Keep owner-backed sidebar authority unchanged, and rely on the repaired read-model bootstrap to refresh web `threads` so stale `Active now` badges disappear naturally.

**Tech Stack:** TypeScript, Effect, Vitest, Bun, ws server, Zustand/TanStack Router bootstrap flow

---

## File Structure

- Create: `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.ts`
  - Shared recovery helper for contradictory external-role-authority owner failures.
- Create: `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts`
  - Unit tests for the new recovery helper.
- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts`
  - Use the shared recovery helper so bootstrap summary no longer throws on contradiction.
- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts`
  - Use the shared recovery helper so current-state, thread detail, and session-thread reads still work.
- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts`
  - Add regression coverage for degraded bootstrap-summary behavior.
- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts`
  - Add regression coverage for degraded current-state and routed-thread detail behavior.

## Scope Notes

- This is one subsystem plan, not two. The live symptoms are connected:
  - server projection bootstrap/current-state fails because external role authority errors are treated as fatal
  - web bootstrap then never receives a usable orchestration read model
  - stale browser thread state can keep sidebar activity badges alive until a hard refresh
- Do not change `server.getAgentsVxappSidebarAuthoritySnapshot`; the sidebar authority snapshot is still owner-backed and currently succeeds.
- Do not add a new browser-side fallback truth source. The fix belongs in the server read-model boundary.

### Task 1: Add Shared Contradiction-Recovery Helper

**Files:**

- Create: `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.ts`
- Test: `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add these tests to `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import {
  AgentsVxappExternalRoleAuthorityError,
  type AgentsVxappExternalRoleAuthoritySnapshot,
} from "./Services/AgentsVxappExternalRoleAuthority.ts";
import {
  EMPTY_EXTERNAL_ROLE_AUTHORITY_SNAPSHOT,
  isRecoverableExternalRoleAuthorityContradiction,
  recoverExternalRoleAuthoritySnapshot,
} from "./externalRoleAuthorityRecovery.ts";

describe("externalRoleAuthorityRecovery", () => {
  it("classifies owner authority_contradiction as recoverable", () => {
    const error = new AgentsVxappExternalRoleAuthorityError({
      operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
      detail: "External role authority project points at a non-authoritative root thread.",
      ownerCommand: "t3code-external-role-authority-snapshot",
      authoritySurface: "external_role_authority_snapshot",
      ownerErrorCode: "authority_contradiction",
    });

    expect(isRecoverableExternalRoleAuthorityContradiction(error)).toBe(true);
  });

  it("does not classify unrelated external-role-authority failures as recoverable", () => {
    const error = new AgentsVxappExternalRoleAuthorityError({
      operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
      detail: "transport failed",
      ownerCommand: "t3code-external-role-authority-snapshot",
      authoritySurface: "external_role_authority_snapshot",
      ownerErrorCode: "transport_error",
    });

    expect(isRecoverableExternalRoleAuthorityContradiction(error)).toBe(false);
  });

  it("returns an empty overlay snapshot for recoverable contradictions", async () => {
    const error = new AgentsVxappExternalRoleAuthorityError({
      operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
      detail: "External role authority project points at a non-authoritative root thread.",
      ownerCommand: "t3code-external-role-authority-snapshot",
      authoritySurface: "external_role_authority_snapshot",
      ownerErrorCode: "authority_contradiction",
    });

    const result = await Effect.runPromise(
      recoverExternalRoleAuthoritySnapshot({
        error,
        logScope: "ProjectionOperationalQuery.externalRoleAuthority",
        mapIrrecoverable: (cause) => cause,
      }),
    );

    expect(result).toEqual(
      EMPTY_EXTERNAL_ROLE_AUTHORITY_SNAPSHOT satisfies AgentsVxappExternalRoleAuthoritySnapshot,
    );
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts
```

Expected: FAIL because `externalRoleAuthorityRecovery.ts` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

Create `apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.ts` with:

```ts
import { Effect } from "effect";

import {
  AgentsVxappExternalRoleAuthorityError,
  type AgentsVxappExternalRoleAuthoritySnapshot,
} from "./Services/AgentsVxappExternalRoleAuthority.ts";

export const EMPTY_EXTERNAL_ROLE_AUTHORITY_SNAPSHOT = {
  projects: [],
  threadSummaries: [],
} satisfies AgentsVxappExternalRoleAuthoritySnapshot;

export function isRecoverableExternalRoleAuthorityContradiction(
  error: unknown,
): error is AgentsVxappExternalRoleAuthorityError {
  return (
    error instanceof AgentsVxappExternalRoleAuthorityError &&
    error.ownerErrorCode === "authority_contradiction"
  );
}

export function recoverExternalRoleAuthoritySnapshot<TError>(input: {
  error: unknown;
  logScope: string;
  mapIrrecoverable: (error: unknown) => TError;
}) {
  if (isRecoverableExternalRoleAuthorityContradiction(input.error)) {
    return Effect.logWarning(`${input.logScope}:degraded`, {
      detail: input.error.detail,
      ownerCommand: input.error.ownerCommand,
      authoritySurface: input.error.authoritySurface,
      ownerErrorCode: input.error.ownerErrorCode,
    }).pipe(Effect.as(EMPTY_EXTERNAL_ROLE_AUTHORITY_SNAPSHOT));
  }

  return Effect.fail(input.mapIrrecoverable(input.error));
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts
```

Expected: PASS with 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.ts apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts
git commit -m "fix: add external role authority contradiction recovery helper"
```

### Task 2: Degrade Bootstrap Summary Instead Of Throwing

**Files:**

- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts`
- Test: `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts`

- [ ] **Step 1: Write the failing bootstrap regression test**

Add this test to `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts`:

```ts
it("degrades contradictory external-role authority and still returns bootstrap data", async () => {
  const projectId = ProjectId.makeUnsafe("project-local");
  const threadId = ThreadId.makeUnsafe("thread-local");

  const layer = Layer.mergeAll(
    ProjectionProjectRepositoryLive,
    ProjectionThreadRepositoryLive,
    OrchestrationProjectionBootstrapSummaryQueryLive,
  ).pipe(Layer.provide(SqlitePersistenceMemory));

  const fullLayer = Layer.mergeAll(
    layer,
    Layer.succeed(AgentsVxappExternalRoleAuthority, {
      getSnapshot: () =>
        Effect.fail(
          new AgentsVxappExternalRoleAuthorityError({
            operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
            detail: "External role authority project points at a non-authoritative root thread.",
            ownerCommand: "t3code-external-role-authority-snapshot",
            authoritySurface: "external_role_authority_snapshot",
            ownerErrorCode: "authority_contradiction",
          }),
        ),
      getRuntimePaths: () =>
        Effect.succeed({
          runtimeRoot: "/runtime",
          roleSessionsRoot: "/runtime/role-sessions",
          roleStateRoot: "/runtime/role-state",
          workspaceRuntimeMetadataDir: ".agents/runtime",
          env: {
            runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
            stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
          },
          roles: {
            cto: {
              role: "cto" as const,
              generatedWorkspaceRoot: "/runtime/role-sessions/cto",
              stateRoot: "/runtime/role-state/cto",
              sessionsRoot: "/runtime/role-state/cto/sessions",
              reservationsRoot: "/runtime/role-state/cto/reservations",
            },
            jasper: {
              role: "jasper" as const,
              generatedWorkspaceRoot: "/runtime/role-sessions/jasper",
              stateRoot: "/runtime/role-state/jasper",
              sessionsRoot: "/runtime/role-state/jasper/sessions",
              reservationsRoot: "/runtime/role-state/jasper/reservations",
            },
          },
        }),
    }),
    Layer.succeed(AgentsVxappControlPlane, {
      getBindingAuthorityExport: () => Effect.die("unexpected control-plane call"),
      getProgramAuthorityExport: () => Effect.die("unexpected control-plane call"),
      getAttentionSummaryExport: () => Effect.die("unexpected control-plane call"),
      getNotificationSummaryExport: () =>
        Effect.succeed({
          authorityStore: "sqlite",
          authoritySource: "owner-command",
          legacyFallbackUsed: false as const,
          notifications: [],
          attention: [],
        }),
      getWatchSummaryExport: () => Effect.die("unexpected control-plane call"),
      getProjectionAuthoritySnapshot: () => Effect.die("unexpected control-plane call"),
      getProgramsAuthoritySnapshot: () =>
        Effect.succeed({
          programs: [],
          pagination: { page: 1, limit: 20, total: 0, hasMore: false },
          authority: { source: "vx_sqlite_program_authority", legacyFallbackUsed: false },
          hints: [],
        }),
      getProgramsTodosSnapshot: () => Effect.die("unexpected control-plane call"),
      createProgram: () => Effect.die("unexpected control-plane call"),
      updateProgram: () => Effect.die("unexpected control-plane call"),
      deleteProgram: () => Effect.die("unexpected control-plane call"),
      setProgramLifecycle: () => Effect.die("unexpected control-plane call"),
      createTodo: () => Effect.die("unexpected control-plane call"),
      updateTodo: () => Effect.die("unexpected control-plane call"),
      deleteTodo: () => Effect.die("unexpected control-plane call"),
    }),
  );

  const readModel = await Effect.runPromise(
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const threads = yield* ProjectionThreadRepository;
      yield* projects.upsert({
        projectId,
        title: "Local Project",
        workspaceRoot: "/tmp/local-project",
        kind: "project",
        sidebarParentProjectId: null,
        currentSessionRootThreadId: threadId,
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: "2026-06-10T05:00:00.000Z",
        updatedAt: "2026-06-10T05:00:00.000Z",
        deletedAt: null,
      });
      yield* threads.upsert({
        threadId,
        projectId,
        title: "Local Thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/tmp/local-project",
        latestTurnId: null,
        createdAt: "2026-06-10T05:00:00.000Z",
        updatedAt: "2026-06-10T05:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        orchestratorProjectId: null,
        orchestratorThreadId: null,
        parentThreadId: null,
        spawnRole: null,
        spawnedBy: null,
        workflowId: null,
        programId: null,
        executiveProjectId: null,
        executiveThreadId: null,
      });

      const query = yield* ProjectionBootstrapSummaryQuery;
      return yield* query.getBootstrapSummary();
    }).pipe(Effect.provide(fullLayer)),
  );

  expect(readModel.projects).toEqual([
    expect.objectContaining({ id: projectId, currentSessionRootThreadId: threadId }),
  ]);
  expect(readModel.threads).toEqual([expect.objectContaining({ id: threadId, projectId })]);
});
```

- [ ] **Step 2: Run the bootstrap regression test to verify it fails**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts
```

Expected: FAIL with a thrown `PersistenceSqlError` rooted in `ProjectionBootstrapSummaryQuery.externalRoleAuthority:query`.

- [ ] **Step 3: Implement contradiction recovery in bootstrap summary**

Update `apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts` so `getExternalSnapshot()` uses the shared helper:

```ts
import { recoverExternalRoleAuthoritySnapshot } from "../externalRoleAuthorityRecovery.ts";
```

Replace the `onSome` branch body with:

```ts
onSome: (externalRoleAuthority) =>
  externalRoleAuthority.getSnapshot().pipe(
    Effect.flatMap((snapshot) =>
      Effect.try({
        try: () => validateExternalRoleAuthoritySnapshot(snapshot),
        catch: (error) =>
          toProjectionSqlError(
            "ProjectionBootstrapSummaryQuery.externalRoleAuthority:validate",
            error,
          ),
      }),
    ),
    Effect.catchAll((error) =>
      recoverExternalRoleAuthoritySnapshot({
        error,
        logScope: "ProjectionBootstrapSummaryQuery.externalRoleAuthority",
        mapIrrecoverable: (cause) =>
          isPersistenceError(cause)
            ? cause
            : toProjectionSqlError(
                "ProjectionBootstrapSummaryQuery.externalRoleAuthority:query",
                cause,
              ),
      }),
    ),
  ),
```

- [ ] **Step 4: Run the bootstrap regression test to verify it passes**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts
```

Expected: PASS, including the new contradiction-recovery test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts
git commit -m "fix: degrade bootstrap summary on authority contradiction"
```

### Task 3: Degrade Operational Queries And Routed Thread Detail

**Files:**

- Modify: `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts`
- Test: `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts`

- [ ] **Step 1: Write the failing operational regression tests**

Add these tests to `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts`:

```ts
it("degrades contradictory external-role authority and still returns current state", async () => {
  const projectId = ProjectId.makeUnsafe("project-local");
  const threadId = ThreadId.makeUnsafe("thread-local");

  const sqliteLayer = Layer.mergeAll(
    ProjectionProjectRepositoryLive,
    ProjectionThreadRepositoryLive,
    ProjectionThreadSessionRepositoryLive,
    OrchestrationProjectionOperationalQueryLive,
  ).pipe(Layer.provide(SqlitePersistenceMemory));

  const layer = Layer.mergeAll(
    sqliteLayer,
    Layer.succeed(AgentsVxappExternalRoleAuthority, {
      getSnapshot: () =>
        Effect.fail(
          new AgentsVxappExternalRoleAuthorityError({
            operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
            detail: "External role authority project points at a non-authoritative root thread.",
            ownerCommand: "t3code-external-role-authority-snapshot",
            authoritySurface: "external_role_authority_snapshot",
            ownerErrorCode: "authority_contradiction",
          }),
        ),
      getRuntimePaths: () =>
        Effect.succeed({
          runtimeRoot: "/runtime",
          roleSessionsRoot: "/runtime/role-sessions",
          roleStateRoot: "/runtime/role-state",
          workspaceRuntimeMetadataDir: ".agents/runtime",
          env: {
            runtimeRoot: "VX_AGENTS_ROLE_SESSION_RUNTIME_ROOT",
            stateRoot: "VX_AGENTS_ROLE_SESSION_STATE_ROOT",
          },
          roles: {
            cto: {
              role: "cto" as const,
              generatedWorkspaceRoot: "/runtime/role-sessions/cto",
              stateRoot: "/runtime/role-state/cto",
              sessionsRoot: "/runtime/role-state/cto/sessions",
              reservationsRoot: "/runtime/role-state/cto/reservations",
            },
            jasper: {
              role: "jasper" as const,
              generatedWorkspaceRoot: "/runtime/role-sessions/jasper",
              stateRoot: "/runtime/role-state/jasper",
              sessionsRoot: "/runtime/role-state/jasper/sessions",
              reservationsRoot: "/runtime/role-state/jasper/reservations",
            },
          },
        }),
    }),
    Layer.succeed(AgentsVxappControlPlane, {
      getBindingAuthorityExport: () =>
        Effect.succeed({
          authorityStore: "sqlite",
          authoritySource: "owner-command",
          legacyFallbackUsed: false as const,
          diagnostics: null,
          jasper: null,
        }),
      getProgramAuthorityExport: () => Effect.die("unexpected control-plane call"),
      getAttentionSummaryExport: () =>
        Effect.succeed({
          authorityStore: "sqlite",
          authoritySource: "owner-command",
          legacyFallbackUsed: false as const,
          attention: [],
          resolvedAttention: [],
          passiveNotifications: [],
        }),
      getNotificationSummaryExport: () =>
        Effect.succeed({
          authorityStore: "sqlite",
          authoritySource: "owner-command",
          legacyFallbackUsed: false as const,
          notifications: [],
          attention: [],
        }),
      getWatchSummaryExport: () => Effect.die("unexpected control-plane call"),
      getProjectionAuthoritySnapshot: () => Effect.die("unexpected control-plane call"),
      getProgramsAuthoritySnapshot: () =>
        Effect.succeed({
          programs: [],
          pagination: { page: 1, limit: 20, total: 0, hasMore: false },
          authority: { source: "vx_sqlite_program_authority", legacyFallbackUsed: false },
          hints: [],
        }),
      getProgramsTodosSnapshot: () => Effect.die("unexpected control-plane call"),
      createProgram: () => Effect.die("unexpected control-plane call"),
      updateProgram: () => Effect.die("unexpected control-plane call"),
      deleteProgram: () => Effect.die("unexpected control-plane call"),
      setProgramLifecycle: () => Effect.die("unexpected control-plane call"),
      createTodo: () => Effect.die("unexpected control-plane call"),
      updateTodo: () => Effect.die("unexpected control-plane call"),
      deleteTodo: () => Effect.die("unexpected control-plane call"),
    }),
  );

  const readModel = await Effect.runPromise(
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const threads = yield* ProjectionThreadRepository;
      const sessions = yield* ProjectionThreadSessionRepository;
      yield* projects.upsert({
        projectId,
        title: "Local Project",
        workspaceRoot: "/tmp/local-project",
        kind: "project",
        sidebarParentProjectId: null,
        currentSessionRootThreadId: threadId,
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: "2026-06-10T05:00:00.000Z",
        updatedAt: "2026-06-10T05:00:00.000Z",
        deletedAt: null,
      });
      yield* threads.upsert({
        threadId,
        projectId,
        title: "Local Thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/tmp/local-project",
        latestTurnId: null,
        createdAt: "2026-06-10T05:00:00.000Z",
        updatedAt: "2026-06-10T05:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        orchestratorProjectId: null,
        orchestratorThreadId: null,
        parentThreadId: null,
        spawnRole: null,
        spawnedBy: null,
        workflowId: null,
        programId: null,
        executiveProjectId: null,
        executiveThreadId: null,
      });
      yield* sessions.upsert({
        threadId,
        status: "stopped",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-06-10T05:00:00.000Z",
      });

      const query = yield* ProjectionOperationalQuery;
      return yield* query.getCurrentState();
    }).pipe(Effect.provide(layer)),
  );

  expect(readModel.projects).toEqual([expect.objectContaining({ id: projectId })]);
  expect(readModel.threads).toEqual([
    expect.objectContaining({
      id: threadId,
      projectId,
      session: expect.objectContaining({ status: "stopped" }),
    }),
  ]);
});

it("degrades contradictory external-role authority and still returns thread detail", async () => {
  const threadId = ThreadId.makeUnsafe("thread-local");

  const readModel = await Effect.runPromise(
    Effect.gen(function* () {
      const query = yield* ProjectionOperationalQuery;
      return yield* query.getThreadById({ threadId });
    }).pipe(Effect.provide(layerFromPreviousTestFactory(threadId))),
  );

  expect(readModel).toEqual(
    expect.objectContaining({
      id: threadId,
      session: expect.objectContaining({ status: "stopped" }),
    }),
  );
});
```

In the real file, do not use `layerFromPreviousTestFactory`. Write the shared setup inline or extract a local test helper inside `ProjectionOperationalQuery.test.ts`.

- [ ] **Step 2: Run the operational regression test to verify it fails**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts
```

Expected: FAIL with `ProjectionOperationalQuery.externalRoleAuthority:query` before the assertions run.

- [ ] **Step 3: Implement contradiction recovery in operational queries**

Update `apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts` exactly like the bootstrap query:

```ts
import { recoverExternalRoleAuthoritySnapshot } from "../externalRoleAuthorityRecovery.ts";
```

Replace the `onSome` branch body inside `getExternalSnapshot()` with:

```ts
onSome: (externalRoleAuthority) =>
  externalRoleAuthority.getSnapshot().pipe(
    Effect.flatMap((snapshot) =>
      Effect.try({
        try: () => validateExternalRoleAuthoritySnapshot(snapshot),
        catch: (error) =>
          toProjectionSqlError(
            "ProjectionOperationalQuery.externalRoleAuthority:validate",
            error,
          ),
      }),
    ),
    Effect.catchAll((error) =>
      recoverExternalRoleAuthoritySnapshot({
        error,
        logScope: "ProjectionOperationalQuery.externalRoleAuthority",
        mapIrrecoverable: (cause) =>
          isPersistenceError(cause)
            ? cause
            : toProjectionSqlError(
                "ProjectionOperationalQuery.externalRoleAuthority:query",
                cause,
              ),
      }),
    ),
  ),
```

Do not touch `getRuntimePaths()` in this task. Runtime-path failures should remain fatal where the boundary explicitly requires them.

- [ ] **Step 4: Run the operational regression test to verify it passes**

Run:

```bash
bun --cwd apps/server run test -- src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts
```

Expected: PASS, including the new `getCurrentState()` and `getThreadById()` contradiction tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts
git commit -m "fix: degrade operational reads on authority contradiction"
```

### Task 4: Run Focused Regression Suite And Repo Gates

**Files:**

- Modify: `docs/superpowers/plans/2026-06-10-external-role-authority-bootstrap-recovery.md`

- [ ] **Step 1: Run the focused server regression suite**

Run:

```bash
bun --cwd apps/server run test -- \
  src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts \
  src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts \
  src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts
```

Expected: PASS with all new contradiction-recovery coverage green.

- [ ] **Step 2: Verify the live user-facing path manually**

Run:

```bash
bun --cwd apps/web - <<'BUN'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('http://127.0.0.1:7421/thread-3323f8d5fb2e', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(8000);
console.log(await page.locator('body').innerText());
await browser.close();
BUN
```

Expected: the CTO thread route renders thread content instead of a blank ChatView shell, and the sidebar no longer depends on stale `Active now` state after a hard refresh.

- [ ] **Step 3: Run formatting, lint, and typecheck**

Run:

```bash
bun fmt
bun lint
bun typecheck
```

Expected: all three commands exit `0`.

- [ ] **Step 4: Update the plan checklist and note final verification evidence**

Append a short execution note at the bottom of this plan after implementation:

```md
## Execution Notes

- Focused server regression suite: PASS
- Live CTO route check on `http://127.0.0.1:7421/thread-3323f8d5fb2e`: PASS
- `bun fmt`: PASS
- `bun lint`: PASS
- `bun typecheck`: PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.ts \
  apps/server/src/extensions/vxapp/externalRoleAuthorityRecovery.test.ts \
  apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.ts \
  apps/server/src/extensions/vxapp/Layers/ProjectionBootstrapSummaryQuery.test.ts \
  apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.ts \
  apps/server/src/extensions/vxapp/Layers/ProjectionOperationalQuery.test.ts \
  docs/superpowers/plans/2026-06-10-external-role-authority-bootstrap-recovery.md
git commit -m "fix: recover bootstrap from external authority contradiction"
```

## Self-Review

- Spec coverage:
  - Blank CTO thread after deploy: covered by Task 3 and Task 4 live verification.
  - Sidebar `Active now` mismatch after hard refresh: covered indirectly by repairing current-state hydration in Task 3.
  - Root cause in `external_role_authority_snapshot` contradiction: covered by Tasks 1-3.
- Placeholder scan:
  - Removed placeholders; every task includes concrete files, commands, and code snippets.
- Type consistency:
  - Shared helper API uses `recoverExternalRoleAuthoritySnapshot`, `EMPTY_EXTERNAL_ROLE_AUTHORITY_SNAPSHOT`, and `isRecoverableExternalRoleAuthorityContradiction` consistently across all tasks.
