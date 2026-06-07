# Ollama Persistence Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION MODE: Use a subagent-driven task-by-task workflow when available, or execute the plan inline with explicit checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing automated coverage that proves Ollama-backed chat history, restart recovery, rollback trimming, and model/session persistence are correct in SQLite-backed orchestration flows.

**Architecture:** Keep the current Ollama runtime implementation and extend coverage at the orchestration and persistence boundaries where correctness actually matters. Prefer integration tests that exercise the real server layers, SQLite projections, and provider runtime ingestion path, while keeping a few focused unit tests for helper-level persistence invariants.

**Tech Stack:** Bun, Vitest, Effect, SQLite persistence layers, orchestration engine integration harness, T3 provider runtime services

---

**Context:** This repo is being edited in the main workspace, not an isolated worktree. Do not assume any helper-managed worktree lifecycle.

## File Map

### Existing files to modify

- `apps/server/integration/orchestrationEngine.integration.test.ts`
  Owns end-to-end orchestration integration coverage, including restart, checkpoint, and provider-backed turn flows. This is the right place for SQLite-backed Ollama persistence tests.
- `apps/server/integration/OrchestrationEngineHarness.integration.ts`
  Provides the reusable integration harness. Extend it only if the new Ollama tests need small helpers for reading thread messages, restarting runtimes, or injecting provider settings.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
  Already proves authoritative Ollama `conversationHistory` construction. Add only narrowly-scoped assertions here if a persistence-oriented unit gap appears during implementation.
- `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`
  Already covers provider rollback sequencing. Extend only if rollback tests need a focused assertion about `history-replay` providers.
- `apps/server/src/persistence/Layers/ProjectionThreadMessages.test.ts`
  Focused repository tests for persisted thread-message rows. Add a helper-level test here only if integration work reveals a missing invariant around finalized assistant rows vs transient streaming rows.

### New files that may be created

- None required by default.
  Keep this change test-focused unless implementation friction proves a small shared test helper module is needed.

## Scope

This plan covers one subsystem: missing Ollama persistence and recovery test coverage.

It does **not** change production Ollama behavior unless a test exposes a real defect that must be fixed to make coverage pass.

## Task 1: Add SQLite-backed Ollama thread message persistence coverage

**Files:**

- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
- Modify: `apps/server/integration/OrchestrationEngineHarness.integration.ts` only if the test needs an existing-style helper to inspect persisted thread message rows
- Optional Test: `apps/server/src/persistence/Layers/ProjectionThreadMessages.test.ts`

- [ ] **Step 1: Write the failing integration test for finalized Ollama message persistence**

Add a new `it.live.skipIf(!process.env.OLLAMA_LIVE_TESTS)` block in `apps/server/integration/orchestrationEngine.integration.test.ts` near the existing provider live tests:

```ts
it.live.skipIf(!process.env.OLLAMA_LIVE_TESTS)(
  "persists finalized Ollama user and assistant messages without replaying transient streaming rows",
  () =>
    withRealOllamaHarness((harness) =>
      Effect.gen(function* () {
        yield* harness.engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-ollama-project-persistence"),
          projectId: PROJECT_ID,
          title: "Ollama Persistence Project",
          workspaceRoot: harness.workspaceDir,
          defaultModelSelection: {
            provider: "ollamaLocal",
            model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
          },
          createdAt: nowIso(),
        });

        yield* harness.engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-ollama-thread-persistence"),
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Ollama Persistence Thread",
          modelSelection: {
            provider: "ollamaLocal",
            model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt: nowIso(),
        });

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-ollama-turn-persistence-1"),
          threadId: THREAD_ID,
          message: {
            messageId: asMessageId("msg-ollama-persistence-1"),
            role: "user",
            text: "Reply with exactly PERSISTED.",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          createdAt: nowIso(),
        });

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.session?.providerName === "ollamaLocal" &&
            entry.messages.some(
              (message) => message.role === "assistant" && message.streaming === false,
            ),
          180_000,
        );

        const persistedRows = yield* harness.threadMessageRepository.listByThreadId({
          threadId: THREAD_ID,
        });

        assert.deepEqual(
          persistedRows.map((row) => ({
            role: row.role,
            text: row.text,
            streaming: row.streaming,
          })),
          [
            { role: "user", text: "Reply with exactly PERSISTED.", streaming: false },
            {
              role: "assistant",
              text: thread.messages.find((message) => message.role === "assistant")?.text ?? "",
              streaming: false,
            },
          ],
        );
      }),
    ),
  240_000,
);
```

- [ ] **Step 2: Run the targeted integration test to verify the gap**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: FAIL if no existing harness path exposes the persisted rows cleanly, or FAIL if transient/incomplete assistant message rows are still being persisted.

- [ ] **Step 3: Add the minimal harness access needed to inspect persisted message rows**

If `withRealOllamaHarness` or its equivalent does not already expose message persistence, extend `apps/server/integration/OrchestrationEngineHarness.integration.ts` with the same pattern used for checkpoint repositories:

```ts
import { ProjectionThreadMessageRepository } from "../src/persistence/Services/ProjectionThreadMessages.ts";

export interface OrchestrationEngineHarness {
  readonly threadMessageRepository: ProjectionThreadMessageRepository;
}

const threadMessageRepository = yield * ProjectionThreadMessageRepository;

return {
  ...existingHarness,
  threadMessageRepository,
};
```

- [ ] **Step 4: Make the test assert the actual persistence contract**

If the first run exposes incorrect assumptions, keep the assertions strict and aligned to real persisted state:

```ts
assert.equal(
  persistedRows.every((row) => row.streaming === false),
  true,
);
assert.equal(persistedRows.filter((row) => row.role === "assistant").length, 1);
assert.equal(
  persistedRows.some((row) => row.text.trim().length === 0),
  false,
);
```

- [ ] **Step 5: Run the targeted integration test to verify it passes**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: PASS for the new Ollama persistence case.

- [ ] **Step 6: Commit**

```bash
git add apps/server/integration/orchestrationEngine.integration.test.ts apps/server/integration/OrchestrationEngineHarness.integration.ts
git commit -m "test: cover ollama thread message persistence"
```

## Task 2: Add restart recovery coverage that proves persisted SQLite history is replayed after runtime restart

**Files:**

- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
- Modify: `apps/server/integration/OrchestrationEngineHarness.integration.ts` only if a restart helper is needed

- [ ] **Step 1: Write the failing restart/recovery integration test**

Add a live integration test adjacent to the existing Claude restart test:

```ts
it.live.skipIf(!process.env.OLLAMA_LIVE_TESTS)(
  "replays persisted Ollama history after runtime restart before sending the next turn",
  () =>
    withRealOllamaHarness((harness) =>
      Effect.gen(function* () {
        yield* createOllamaThread(harness, {
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
        });

        yield* startUserTurn(harness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-restart-turn-1",
          messageId: "msg-ollama-restart-1",
          text: "Reply with exactly FIRST.",
        });

        yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.messages.some(
              (message) => message.role === "assistant" && message.streaming === false,
            ),
          180_000,
        );

        const restartedHarness = yield* harness.restart();

        yield* startUserTurn(restartedHarness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-restart-turn-2",
          messageId: "msg-ollama-restart-2",
          text: "Reply with exactly SECOND.",
        });

        const thread = yield* restartedHarness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.messages.filter((message) => message.role === "assistant" && !message.streaming)
              .length >= 2,
          180_000,
        );

        assert.equal(thread.messages.filter((message) => message.role === "user").length, 2);
        assert.equal(
          thread.messages.filter((message) => message.role === "assistant" && !message.streaming)
            .length,
          2,
        );
      }),
    ),
  300_000,
);
```

- [ ] **Step 2: Run the targeted integration test to verify it fails for the right reason**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: FAIL if restart helpers are missing or if restarted Ollama sessions do not rebuild history correctly from persisted messages.

- [ ] **Step 3: Add a restart helper to the harness only if needed**

Follow the existing orchestration restart pattern. If the harness does not already expose a restart-style helper, add one that disposes and recreates the integration system against the same SQLite db path and workspace:

```ts
readonly restart: () => Effect.Effect<OrchestrationEngineHarness, never>;

restart: () =>
  Effect.gen(function* () {
    yield* currentRuntime.dispose;
    return yield* createRealOllamaHarness({
      dbPath,
      workspaceDir,
      serverSettings: currentServerSettings,
    });
  }),
```

- [ ] **Step 4: Strengthen the test to prove replay, not just second-turn success**

After the restart and second turn, inspect the persisted rows and final thread snapshot:

```ts
const persistedRows =
  yield *
  restartedHarness.threadMessageRepository.listByThreadId({
    threadId: THREAD_ID,
  });

assert.deepEqual(
  persistedRows.map((row) => row.role),
  ["user", "assistant", "user", "assistant"],
);
assert.equal(persistedRows[1]?.text.trim().length > 0, true);
```

- [ ] **Step 5: Run the targeted test to verify it passes**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: PASS with the restarted system producing a second settled assistant message and intact persisted history.

- [ ] **Step 6: Commit**

```bash
git add apps/server/integration/orchestrationEngine.integration.test.ts apps/server/integration/OrchestrationEngineHarness.integration.ts
git commit -m "test: cover ollama restart history replay"
```

## Task 3: Add rollback coverage that proves reverted Ollama history is trimmed in persistence before the next turn

**Files:**

- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
- Optional Modify: `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`

- [ ] **Step 1: Write the failing Ollama checkpoint-revert integration test**

Add a live integration test near the existing checkpoint revert coverage:

```ts
it.live.skipIf(!process.env.OLLAMA_LIVE_TESTS)(
  "trims persisted Ollama conversation history after checkpoint revert before the next turn",
  () =>
    withRealOllamaHarness((harness) =>
      Effect.gen(function* () {
        yield* createOllamaThread(harness, {
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
        });

        yield* startUserTurn(harness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-revert-turn-1",
          messageId: "msg-ollama-revert-1",
          text: "Reply with exactly ONE.",
        });
        yield* waitForSettledAssistantCount(harness, THREAD_ID, 1);

        yield* startUserTurn(harness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-revert-turn-2",
          messageId: "msg-ollama-revert-2",
          text: "Reply with exactly TWO.",
        });
        yield* waitForSettledAssistantCount(harness, THREAD_ID, 2);

        yield* harness.engine.dispatch({
          type: "thread.checkpoint.revert",
          commandId: CommandId.makeUnsafe("cmd-ollama-revert-history"),
          threadId: THREAD_ID,
          checkpointTurnCount: 1,
          createdAt: nowIso(),
        });

        yield* harness.waitForThread(
          THREAD_ID,
          (entry) => entry.checkpoints.length === 1 && entry.messages.length === 2,
          180_000,
        );

        yield* startUserTurn(harness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-revert-turn-3",
          messageId: "msg-ollama-revert-3",
          text: "Reply with exactly THREE.",
        });

        const thread = yield* harness.waitForThread(
          THREAD_ID,
          (entry) =>
            entry.messages.filter((message) => message.role === "assistant" && !message.streaming)
              .length === 2,
          180_000,
        );

        assert.deepEqual(
          thread.messages.map((message) => ({ role: message.role, text: message.text.trim() })),
          [
            { role: "user", text: "Reply with exactly ONE." },
            { role: "assistant", text: thread.messages[1]?.text.trim() ?? "" },
            { role: "user", text: "Reply with exactly THREE." },
            { role: "assistant", text: thread.messages[3]?.text.trim() ?? "" },
          ],
        );
      }),
    ),
  300_000,
);
```

- [ ] **Step 2: Run the targeted integration test to verify the gap**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: FAIL if reverted messages remain in SQLite projections or if the next Ollama turn replays stale assistant text.

- [ ] **Step 3: Add the minimal assertion or helper needed to inspect trimmed persistence**

If needed, read persisted rows after revert:

```ts
const persistedRowsAfterRevert =
  yield *
  harness.threadMessageRepository.listByThreadId({
    threadId: THREAD_ID,
  });

assert.deepEqual(
  persistedRowsAfterRevert.map((row) => row.text.trim()),
  ["Reply with exactly ONE.", persistedRowsAfterRevert[1]?.text.trim() ?? ""],
);
```

Keep the test strict: the reverted second-turn user and assistant rows must be gone before the third turn runs.

- [ ] **Step 4: Run the targeted integration test to verify it passes**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: PASS with the reverted turn removed from both the read model and persisted message rows.

- [ ] **Step 5: Commit**

```bash
git add apps/server/integration/orchestrationEngine.integration.test.ts
git commit -m "test: cover ollama persistence after checkpoint revert"
```

## Task 4: Add coverage for persisted Ollama model/session state across subsequent turns and restart

**Files:**

- Modify: `apps/server/integration/orchestrationEngine.integration.test.ts`
- Optional Modify: `apps/server/integration/OrchestrationEngineHarness.integration.ts`

- [ ] **Step 1: Write the failing test for persisted Ollama model state**

Add a live test that switches the thread or turn to an explicit Ollama model and proves the persisted session keeps using it:

```ts
it.live.skipIf(!process.env.OLLAMA_LIVE_TESTS)(
  "persists the active Ollama model across settled turns and restart",
  () =>
    withRealOllamaHarness((harness) =>
      Effect.gen(function* () {
        yield* createOllamaThread(harness, {
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
        });

        yield* startUserTurn(harness, {
          threadId: THREAD_ID,
          commandId: "cmd-ollama-model-turn-1",
          messageId: "msg-ollama-model-1",
          text: "Reply with exactly MODEL_ONE.",
          modelSelection: {
            provider: "ollamaLocal",
            model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
          },
        });

        const beforeRestart = yield* harness.waitForThread(
          THREAD_ID,
          (entry) => entry.session?.model === (process.env.OLLAMA_MODEL ?? "qwen3:8b"),
          180_000,
        );
        assert.equal(beforeRestart.session?.model, process.env.OLLAMA_MODEL ?? "qwen3:8b");

        const restartedHarness = yield* harness.restart();
        const afterRestart = yield* restartedHarness.waitForThread(
          THREAD_ID,
          (entry) => entry.session?.model === (process.env.OLLAMA_MODEL ?? "qwen3:8b"),
          180_000,
        );

        assert.equal(afterRestart.session?.model, process.env.OLLAMA_MODEL ?? "qwen3:8b");
      }),
    ),
  300_000,
);
```

- [ ] **Step 2: Run the targeted test to verify it fails if session/model persistence is not wired end to end**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: FAIL if the persisted thread/session projection does not retain the Ollama model after restart.

- [ ] **Step 3: Add the minimal test helper or assertion only if needed**

If the thread snapshot is insufficient, expose or read persisted session rows the same way other repositories are exposed:

```ts
const sessions = yield * restartedHarness.providerService.listSessions();
assert.equal(sessions[0]?.model, process.env.OLLAMA_MODEL ?? "qwen3:8b");
```

Prefer existing thread snapshot assertions first; only widen the harness if necessary.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: PASS with the same Ollama model visible before and after restart.

- [ ] **Step 5: Commit**

```bash
git add apps/server/integration/orchestrationEngine.integration.test.ts apps/server/integration/OrchestrationEngineHarness.integration.ts
git commit -m "test: cover ollama model persistence across restart"
```

## Task 5: Add a small helper-level regression test only if integration exposed a projection invariant gap

**Files:**

- Optional Modify: `apps/server/src/persistence/Layers/ProjectionThreadMessages.test.ts`

- [ ] **Step 1: Write the failing repository-level test only if integration revealed a persistence invariant bug**

Only add this task if Task 1 or Task 3 exposes a projection-layer bug that is awkward to lock down via integration alone:

```ts
it.effect("stores only finalized assistant rows for replay-safe ollama history", () =>
  Effect.gen(function* () {
    const repo = yield* ProjectionThreadMessageRepository;
    const threadId = ThreadId.makeUnsafe("thread-ollama-projection");

    yield* repo.replaceThreadMessages({
      threadId,
      messages: [
        {
          messageId: MessageId.makeUnsafe("msg-user-1"),
          role: "user",
          text: "Hello",
          streaming: false,
          createdAt: "2026-06-07T00:00:00.000Z",
          attachments: [],
        },
        {
          messageId: MessageId.makeUnsafe("msg-assistant-1"),
          role: "assistant",
          text: "Final reply",
          streaming: false,
          createdAt: "2026-06-07T00:00:01.000Z",
          attachments: [],
        },
      ],
    });

    const rows = yield* repo.listByThreadId({ threadId });
    assert.equal(
      rows.every((row) => row.streaming === false),
      true,
    );
  }),
);
```

- [ ] **Step 2: Run the focused repository test to verify it fails before the fix**

Run:

```bash
cd apps/server
bun run test src/persistence/Layers/ProjectionThreadMessages.test.ts
```

Expected: FAIL only if the projection layer itself needs correction.

- [ ] **Step 3: Implement the minimal repository fix only if the invariant is genuinely broken**

Example of a minimal fix shape:

```ts
return rows.filter((row) => row.streaming === false && row.text.trim().length > 0);
```

Do not add this code unless the existing repository behavior is actually wrong.

- [ ] **Step 4: Run the focused repository test to verify it passes**

Run:

```bash
cd apps/server
bun run test src/persistence/Layers/ProjectionThreadMessages.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence/Layers/ProjectionThreadMessages.test.ts apps/server/src/persistence/Layers/ProjectionThreadMessages.ts
git commit -m "test: lock replay-safe ollama message persistence"
```

## Final Validation

- [ ] **Step 1: Run the focused Ollama integration coverage**

Run:

```bash
cd apps/server
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/ollamaLocal.live.integration.test.ts
OLLAMA_LIVE_TESTS=1 OLLAMA_BASE_URL=http://192.168.10.12:11435/api OLLAMA_MODEL=qwen3:8b bun run test integration/orchestrationEngine.integration.test.ts
```

Expected: PASS for all Ollama live and persistence cases

- [ ] **Step 2: Run the focused unit and reactor coverage**

Run:

```bash
cd apps/server
bun run test src/provider/Layers/OllamaAdapter.test.ts
bun run test src/orchestration/Layers/ProviderCommandReactor.test.ts
bun run test src/orchestration/Layers/CheckpointReactor.test.ts
```

Expected: PASS

- [ ] **Step 3: Run repo-wide completion gates**

Run:

```bash
cd /home/gizmo/t3code-vxapp
bun fmt
bun lint
bun typecheck
```

Expected: PASS

- [ ] **Step 4: Commit the final coverage batch**

```bash
git add apps/server/integration/orchestrationEngine.integration.test.ts apps/server/integration/OrchestrationEngineHarness.integration.ts apps/server/src/persistence/Layers/ProjectionThreadMessages.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts apps/server/src/orchestration/Layers/CheckpointReactor.test.ts
git commit -m "test: add ollama persistence and recovery coverage"
```

## Self-Review

### Spec coverage

- SQLite-backed chat persistence: covered in Task 1
- Restart/recovery using persisted history: covered in Task 2
- Revert/rollback trimming before next Ollama turn: covered in Task 3
- Persisted session/model state across restart: covered in Task 4
- Optional helper-level persistence invariant lock: covered in Task 5

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain
- Optional work is explicitly gated on concrete failure conditions rather than left vague

### Type consistency

- The plan consistently uses `ollamaLocal`, `OLLAMA_LIVE_TESTS`, `OLLAMA_BASE_URL`, and `OLLAMA_MODEL`
- Integration tests are placed in `apps/server/integration/orchestrationEngine.integration.test.ts`
- Persistence inspection consistently refers to `threadMessageRepository.listByThreadId({ threadId })`
