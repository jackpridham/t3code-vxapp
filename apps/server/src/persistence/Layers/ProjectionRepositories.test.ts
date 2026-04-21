import {
  CtoAttentionId,
  MessageId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionCtoAttentionRepositoryLive } from "./ProjectionCtoAttention.ts";
import { ProjectionOrchestratorWakeRepositoryLive } from "./ProjectionOrchestratorWakes.ts";
import { ProjectionCtoAttentionRepository } from "../Services/ProjectionCtoAttention.ts";
import { ProjectionProgramNotificationRepositoryLive } from "./ProjectionProgramNotifications.ts";
import { ProjectionProgramRepositoryLive } from "./ProjectionPrograms.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { ProjectionOrchestratorWakeRepository } from "../Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProgramNotificationRepository } from "../Services/ProjectionProgramNotifications.ts";
import { ProjectionProgramRepository } from "../Services/ProjectionPrograms.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionProgramRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionProgramNotificationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionCtoAttentionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
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
        programId: null,
        executiveProjectId: null,
        executiveThreadId: null,
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

  it.effect("persists executive programs for snapshot replay", () =>
    Effect.gen(function* () {
      const programs = yield* ProjectionProgramRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* programs.upsert({
        programId: ProgramId.makeUnsafe("program-cto"),
        title: "Founder task",
        objective: "Convert founder request into Jasper orchestration.",
        status: "active",
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        currentOrchestratorThreadId: ThreadId.makeUnsafe("thread-jasper"),
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:01.000Z",
        completedAt: null,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly programId: string;
        readonly objective: string | null;
        readonly currentOrchestratorThreadId: string | null;
      }>`
        SELECT
          program_id AS "programId",
          objective,
          current_orchestrator_thread_id AS "currentOrchestratorThreadId"
        FROM projection_programs
        WHERE program_id = 'program-cto'
      `;
      assert.deepEqual(rows, [
        {
          programId: "program-cto",
          objective: "Convert founder request into Jasper orchestration.",
          currentOrchestratorThreadId: "thread-jasper",
        },
      ]);

      const persisted = yield* programs.getById({
        programId: ProgramId.makeUnsafe("program-cto"),
      });
      assert.strictEqual(Option.getOrNull(persisted)?.status, "active");
      assert.strictEqual(Option.getOrNull(persisted)?.executiveThreadId, "thread-cto");
    }),
  );

  it.effect("persists program notifications with structured evidence", () =>
    Effect.gen(function* () {
      const notifications = yield* ProjectionProgramNotificationRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* notifications.upsert({
        notificationId: ProgramNotificationId.makeUnsafe("notif-cto"),
        programId: ProgramId.makeUnsafe("program-cto"),
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        orchestratorThreadId: ThreadId.makeUnsafe("thread-jasper"),
        kind: "decision_required",
        severity: "warning",
        summary: "Choose the deployment lane.",
        evidence: { workerThreadId: "thread-worker" },
        state: "pending",
        queuedAt: "2026-04-20T00:01:00.000Z",
        deliveredAt: null,
        consumedAt: null,
        droppedAt: null,
        consumeReason: undefined,
        dropReason: undefined,
        createdAt: "2026-04-20T00:01:00.000Z",
        updatedAt: "2026-04-20T00:01:00.000Z",
      });

      const rows = yield* sql<{
        readonly notificationId: string;
        readonly evidenceJson: string;
        readonly state: string;
      }>`
        SELECT
          notification_id AS "notificationId",
          evidence_json AS "evidenceJson",
          state
        FROM projection_program_notifications
        WHERE notification_id = 'notif-cto'
      `;
      assert.deepEqual(rows, [
        {
          notificationId: "notif-cto",
          evidenceJson: JSON.stringify({ workerThreadId: "thread-worker" }),
          state: "pending",
        },
      ]);

      const persisted = yield* notifications.getById({
        notificationId: ProgramNotificationId.makeUnsafe("notif-cto"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.evidence, {
        workerThreadId: "thread-worker",
      });
      assert.strictEqual(Option.getOrNull(persisted)?.kind, "decision_required");
    }),
  );

  it.effect("upserts CTO attention rows by stable attention key", () =>
    Effect.gen(function* () {
      const ctoAttention = yield* ProjectionCtoAttentionRepository;
      const sql = yield* SqlClient.SqlClient;

      const firstRow = {
        attentionId: CtoAttentionId.makeUnsafe(
          "program:program-cto|kind:final_review_ready|source-thread:thread-worker|source-role:worker|correlation:notif-cto",
        ),
        attentionKey:
          "program:program-cto|kind:final_review_ready|source-thread:thread-worker|source-role:worker|correlation:notif-cto",
        notificationId: ProgramNotificationId.makeUnsafe("notif-cto"),
        programId: ProgramId.makeUnsafe("program-cto"),
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        sourceThreadId: ThreadId.makeUnsafe("thread-worker"),
        sourceRole: "worker",
        kind: "final_review_ready",
        severity: "info",
        summary: "The review is ready.",
        evidence: { workerThreadId: "thread-worker" },
        state: "required",
        queuedAt: "2026-04-20T00:01:00.000Z",
        acknowledgedAt: null,
        resolvedAt: null,
        droppedAt: null,
        createdAt: "2026-04-20T00:01:00.000Z",
        updatedAt: "2026-04-20T00:01:00.000Z",
      } as const;

      yield* ctoAttention.upsert(firstRow);
      yield* ctoAttention.upsert({
        ...firstRow,
        state: "acknowledged",
        acknowledgedAt: "2026-04-20T00:02:00.000Z",
        updatedAt: "2026-04-20T00:02:00.000Z",
      });

      const rows = yield* sql<{
        readonly attentionId: string;
        readonly attentionKey: string;
        readonly state: string;
        readonly acknowledgedAt: string | null;
      }>`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          state,
          acknowledged_at AS "acknowledgedAt"
        FROM projection_cto_attention
      `;
      assert.deepEqual(rows, [
        {
          attentionId: firstRow.attentionId,
          attentionKey: firstRow.attentionKey,
          state: "acknowledged",
          acknowledgedAt: "2026-04-20T00:02:00.000Z",
        },
      ]);

      const persisted = yield* ctoAttention.getByNotificationId({
        notificationId: ProgramNotificationId.makeUnsafe("notif-cto"),
      });
      assert.strictEqual(Option.getOrNull(persisted)?.state, "acknowledged");
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
        programId: null,
        executiveProjectId: null,
        executiveThreadId: null,
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
        programId: null,
        executiveProjectId: null,
        executiveThreadId: null,
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
