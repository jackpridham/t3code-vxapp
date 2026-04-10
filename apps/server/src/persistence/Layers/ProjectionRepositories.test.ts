import { MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionOrchestratorWakeRepositoryLive } from "./ProjectionOrchestratorWakes.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { ProjectionOrchestratorWakeRepository } from "../Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionTurnRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionOrchestratorWakeRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.makeUnsafe("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        kind: "orchestrator",
        sidebarParentProjectId: null,
        currentSessionRootThreadId: null,
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        scripts: [],
        hooks: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly kind: string;
        readonly defaultModelSelection: string | null;
      }>`
        SELECT
          kind,
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_projects row to exist."));
      }

      assert.strictEqual(
        row.defaultModelSelection,
        JSON.stringify({
          provider: "codex",
          model: "gpt-5.4",
        }),
      );
      assert.strictEqual(row.kind, "orchestrator");

      const persisted = yield* projects.getById({
        projectId: ProjectId.makeUnsafe("project-null-options"),
      });
      assert.strictEqual(Option.getOrNull(persisted)?.kind, "orchestrator");
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.makeUnsafe("thread-null-options"),
        projectId: ProjectId.makeUnsafe("project-null-options"),
        title: "Null options thread",
        labels: [],
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        orchestratorProjectId: null,
        orchestratorThreadId: null,
        parentThreadId: null,
        spawnRole: null,
        spawnedBy: null,
        workflowId: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_threads row to exist."));
      }

      assert.strictEqual(
        row.modelSelection,
        JSON.stringify({
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.makeUnsafe("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("keeps an existing model label aligned when a thread model selection changes", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-model-label-sync");

      yield* threads.upsert({
        threadId,
        projectId: ProjectId.makeUnsafe("project-model-label-sync"),
        title: "Worker thread",
        labels: ["worker", "model:claude-sonnet-4-6", "urgent"],
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        orchestratorProjectId: null,
        orchestratorThreadId: null,
        parentThreadId: null,
        spawnRole: "worker",
        spawnedBy: "jasper",
        workflowId: null,
      });

      yield* threads.upsert({
        threadId,
        projectId: ProjectId.makeUnsafe("project-model-label-sync"),
        title: "Worker thread",
        labels: ["worker", "model:claude-sonnet-4-6", "urgent"],
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:05:00.000Z",
        archivedAt: null,
        deletedAt: null,
        orchestratorProjectId: null,
        orchestratorThreadId: null,
        parentThreadId: null,
        spawnRole: "worker",
        spawnedBy: "jasper",
        workflowId: null,
      });

      const rows = yield* sql<{
        readonly labels: string;
        readonly modelSelection: string;
      }>`
        SELECT
          labels_json AS "labels",
          model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `;
      assert.deepEqual(rows, [
        {
          labels: '["worker","model:claude-opus-4-6","urgent"]',
          modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
        },
      ]);

      const persisted = yield* threads.getById({ threadId });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.labels, [
        "worker",
        "model:claude-opus-4-6",
        "urgent",
      ]);
    }),
  );

  it.effect(
    "normalizes requestedAt when a turn upsert arrives with inverted lifecycle timestamps",
    () =>
      Effect.gen(function* () {
        const turns = yield* ProjectionTurnRepository;
        const sql = yield* SqlClient.SqlClient;
        const threadId = ThreadId.makeUnsafe("thread-turn-timestamps");
        const turnId = TurnId.makeUnsafe("turn-timestamps");

        yield* turns.upsertByTurnId({
          threadId,
          turnId,
          pendingMessageId: null,
          sourceProposedPlanThreadId: null,
          sourceProposedPlanId: null,
          assistantMessageId: MessageId.makeUnsafe("assistant-turn-timestamps"),
          state: "completed",
          requestedAt: "2026-03-24T00:00:03.000Z",
          startedAt: "2026-03-24T00:00:02.000Z",
          completedAt: "2026-03-24T00:00:01.000Z",
          checkpointTurnCount: null,
          checkpointRef: null,
          checkpointStatus: null,
          checkpointFiles: [],
        });

        const rows = yield* sql<{
          readonly requestedAt: string;
          readonly startedAt: string | null;
          readonly completedAt: string | null;
        }>`
        SELECT
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
      `;
        assert.deepEqual(rows, [
          {
            requestedAt: "2026-03-24T00:00:01.000Z",
            startedAt: "2026-03-24T00:00:02.000Z",
            completedAt: "2026-03-24T00:00:01.000Z",
          },
        ]);

        const persisted = yield* turns.getByTurnId({ threadId, turnId });
        assert.strictEqual(Option.getOrNull(persisted)?.requestedAt, "2026-03-24T00:00:01.000Z");
      }),
  );

  it.effect("stores and queries orchestrator wake rows by thread and worker", () =>
    Effect.gen(function* () {
      const wakes = yield* ProjectionOrchestratorWakeRepository;

      yield* wakes.upsert({
        wakeId: "wake:worker-1:turn-1:completed",
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-1"),
        orchestratorProjectId: ProjectId.makeUnsafe("project-orch-1"),
        workerThreadId: ThreadId.makeUnsafe("thread-worker-1"),
        workerProjectId: ProjectId.makeUnsafe("project-worker-1"),
        workerTurnId: TurnId.makeUnsafe("turn-1"),
        workflowId: "wf-1",
        workerTitleSnapshot: "Worker One",
        outcome: "completed",
        summary: "Completed the queue projection",
        queuedAt: "2026-04-05T10:00:00.000Z",
        state: "pending",
        deliveryMessageId: null,
        deliveredAt: null,
        consumedAt: null,
        consumeReason: null,
      });

      yield* wakes.upsert({
        wakeId: "wake:worker-1:turn-1:completed",
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-1"),
        orchestratorProjectId: ProjectId.makeUnsafe("project-orch-1"),
        workerThreadId: ThreadId.makeUnsafe("thread-worker-1"),
        workerProjectId: ProjectId.makeUnsafe("project-worker-1"),
        workerTurnId: TurnId.makeUnsafe("turn-1"),
        workflowId: "wf-1",
        workerTitleSnapshot: "Worker One",
        outcome: "completed",
        summary: "Delivered to orchestrator",
        queuedAt: "2026-04-05T10:00:00.000Z",
        state: "delivered",
        deliveryMessageId: "msg-wake-1" as MessageId,
        deliveredAt: "2026-04-05T10:02:00.000Z",
        consumedAt: null,
        consumeReason: null,
      });

      yield* wakes.upsert({
        wakeId: "wake:worker-2:turn-2:failed",
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-1"),
        orchestratorProjectId: ProjectId.makeUnsafe("project-orch-1"),
        workerThreadId: ThreadId.makeUnsafe("thread-worker-2"),
        workerProjectId: ProjectId.makeUnsafe("project-worker-2"),
        workerTurnId: TurnId.makeUnsafe("turn-2"),
        workflowId: null,
        workerTitleSnapshot: "Worker Two",
        outcome: "failed",
        summary: "Waiting for review",
        queuedAt: "2026-04-05T10:01:00.000Z",
        state: "pending",
        deliveryMessageId: null,
        deliveredAt: null,
        consumedAt: null,
        consumeReason: null,
      });

      const byOrchestrator = yield* wakes.listByOrchestratorThreadId({
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-1"),
      });
      assert.equal(byOrchestrator.length, 2);
      assert.equal(byOrchestrator[0]?.wakeId, "wake:worker-1:turn-1:completed");
      assert.equal(byOrchestrator[0]?.state, "delivered");

      const pending = yield* wakes.listPendingByOrchestratorThreadId({
        orchestratorThreadId: ThreadId.makeUnsafe("thread-orch-1"),
      });
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.wakeId, "wake:worker-2:turn-2:failed");

      const undeliveredForWorkerOne = yield* wakes.listUndeliveredByWorkerThreadId({
        workerThreadId: ThreadId.makeUnsafe("thread-worker-1"),
      });
      assert.equal(undeliveredForWorkerOne.length, 0);

      const undeliveredForWorkerTwo = yield* wakes.listUndeliveredByWorkerThreadId({
        workerThreadId: ThreadId.makeUnsafe("thread-worker-2"),
      });
      assert.equal(undeliveredForWorkerTwo.length, 1);
      assert.equal(undeliveredForWorkerTwo[0]?.state, "pending");
    }),
  );
});
