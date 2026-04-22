import {
  CommandId,
  EventId,
  MessageId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import {
  createEmptyReadModel,
  projectEvent as projectCoreEvent,
} from "@t3tools/orchestration-core/projector";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const parityLayer = it.layer(
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-core-parity-" })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const now = "2026-04-22T00:00:00.000Z";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: string;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-parity-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : input.aggregateKind === "program"
          ? ProgramId.makeUnsafe(input.aggregateId)
          : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`cmd-parity-${input.sequence}`),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(`cmd-parity-${input.sequence}`),
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

function comparableReadModel(model: OrchestrationReadModel) {
  return {
    snapshotSequence: model.snapshotSequence,
    projects: model.projects.map((project) => ({
      id: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      kind: project.kind ?? "project",
      sidebarParentProjectId: project.sidebarParentProjectId ?? null,
      currentSessionRootThreadId: project.currentSessionRootThreadId ?? null,
      defaultModelSelection: project.defaultModelSelection,
      scripts: project.scripts,
      hooks: project.hooks,
      deletedAt: project.deletedAt,
    })),
    programs: (model.programs ?? []).map((program) => ({
      id: program.id,
      title: program.title,
      objective: program.objective,
      status: program.status,
      executiveProjectId: program.executiveProjectId,
      executiveThreadId: program.executiveThreadId,
      currentOrchestratorThreadId: program.currentOrchestratorThreadId,
      completedAt: program.completedAt,
      deletedAt: program.deletedAt,
    })),
    programNotifications: (model.programNotifications ?? []).map((notification) => ({
      notificationId: notification.notificationId,
      programId: notification.programId,
      executiveProjectId: notification.executiveProjectId,
      executiveThreadId: notification.executiveThreadId,
      orchestratorThreadId: notification.orchestratorThreadId,
      kind: notification.kind,
      severity: notification.severity,
      summary: notification.summary,
      evidence: notification.evidence,
      state: notification.state,
      consumedAt: notification.consumedAt,
      droppedAt: notification.droppedAt,
    })),
    ctoAttentionItems: (model.ctoAttentionItems ?? []).map((item) => ({
      attentionKey: item.attentionKey,
      notificationId: item.notificationId,
      programId: item.programId,
      executiveProjectId: item.executiveProjectId,
      executiveThreadId: item.executiveThreadId,
      sourceThreadId: item.sourceThreadId,
      sourceRole: item.sourceRole,
      kind: item.kind,
      severity: item.severity,
      summary: item.summary,
      evidence: item.evidence,
      state: item.state,
      acknowledgedAt: item.acknowledgedAt,
      droppedAt: item.droppedAt,
    })),
    threads: model.threads.map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      labels: thread.labels,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
      messages: thread.messages,
      proposedPlans: thread.proposedPlans,
      activities: thread.activities,
      checkpoints: thread.checkpoints,
      session: thread.session,
      orchestratorProjectId: thread.orchestratorProjectId,
      orchestratorThreadId: thread.orchestratorThreadId,
      parentThreadId: thread.parentThreadId,
      spawnRole: thread.spawnRole,
      spawnedBy: thread.spawnedBy,
      workflowId: thread.workflowId,
      programId: thread.programId,
      executiveProjectId: thread.executiveProjectId,
      executiveThreadId: thread.executiveThreadId,
    })),
    orchestratorWakeItems: model.orchestratorWakeItems,
  };
}

parityLayer("SQL projection/core projection parity", (it) => {
  it.effect("matches core read-model projection for representative orchestration events", () =>
    Effect.gen(function* () {
      const pipeline = yield* OrchestrationProjectionPipeline;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const projectId = ProjectId.makeUnsafe("project-parity");
      const threadId = ThreadId.makeUnsafe("thread-parity");
      const programId = ProgramId.makeUnsafe("program-parity");
      const notificationId = ProgramNotificationId.makeUnsafe("notification-parity");
      const turnId = TurnId.makeUnsafe("turn-parity");
      const messageId = MessageId.makeUnsafe("message-parity");

      const events: OrchestrationEvent[] = [
        makeEvent({
          sequence: 1,
          type: "project.created",
          aggregateKind: "project",
          aggregateId: projectId,
          payload: {
            projectId,
            title: "Parity Project",
            workspaceRoot: "/tmp/parity",
            kind: "orchestrator",
            sidebarParentProjectId: null,
            currentSessionRootThreadId: threadId,
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            scripts: [],
            hooks: [],
            createdAt: now,
            updatedAt: now,
          },
        }),
        makeEvent({
          sequence: 2,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            projectId,
            title: "Parity Thread",
            labels: ["orchestrator", "parity"],
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            spawnRole: "orchestrator",
            createdAt: now,
            updatedAt: now,
          },
        }),
        makeEvent({
          sequence: 3,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            messageId,
            role: "assistant",
            text: "Parity response",
            turnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
        makeEvent({
          sequence: 4,
          type: "thread.proposed-plan-upserted",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            proposedPlan: {
              id: "plan-parity",
              turnId,
              planMarkdown: "1. Ship parity.",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        }),
        makeEvent({
          sequence: 5,
          type: "thread.activity-appended",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            activity: {
              id: EventId.makeUnsafe("activity-parity"),
              tone: "info",
              kind: "parity.activity",
              summary: "Projected activity",
              payload: { ok: true },
              turnId,
              sequence: 5,
              createdAt: now,
            },
          },
        }),
        makeEvent({
          sequence: 6,
          type: "thread.turn-diff-completed",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            turnId,
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-parity",
            status: "ready",
            files: [{ path: "src/parity.ts", kind: "modified", additions: 1, deletions: 0 }],
            assistantMessageId: messageId,
            completedAt: now,
          },
        }),
        makeEvent({
          sequence: 7,
          type: "program.created",
          aggregateKind: "program",
          aggregateId: programId,
          payload: {
            programId,
            title: "Parity Program",
            objective: null,
            status: "active",
            executiveProjectId: projectId,
            executiveThreadId: threadId,
            currentOrchestratorThreadId: threadId,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
        }),
        makeEvent({
          sequence: 8,
          type: "program.notification-upserted",
          aggregateKind: "program",
          aggregateId: programId,
          payload: {
            notificationId,
            programId,
            executiveProjectId: projectId,
            executiveThreadId: threadId,
            orchestratorThreadId: threadId,
            kind: "blocked",
            severity: "critical",
            summary: "Parity blocked.",
            evidence: { workerThreadId: "thread-worker-parity" },
            state: "pending",
            queuedAt: now,
            deliveredAt: null,
            consumedAt: null,
            droppedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
        makeEvent({
          sequence: 9,
          type: "thread.orchestrator-wake-upserted",
          aggregateKind: "thread",
          aggregateId: threadId,
          payload: {
            threadId,
            wakeItem: {
              wakeId: "wake-parity",
              orchestratorThreadId: threadId,
              orchestratorProjectId: projectId,
              workerThreadId: ThreadId.makeUnsafe("thread-worker-parity"),
              workerProjectId: ProjectId.makeUnsafe("project-worker-parity"),
              workerTurnId: TurnId.makeUnsafe("turn-worker-parity"),
              workerTitleSnapshot: "Worker parity",
              outcome: "completed",
              summary: "Worker finished.",
              queuedAt: now,
              state: "pending",
              deliveredAt: null,
              consumedAt: null,
            },
          },
        }),
      ];

      let coreModel = createEmptyReadModel(now);
      for (const event of events) {
        coreModel = yield* projectCoreEvent(coreModel, event);
        yield* pipeline.projectEvent(event);
      }

      const sqlSnapshot = yield* snapshotQuery.getSnapshot({ profile: "debug-export" });
      assert.deepEqual(comparableReadModel(sqlSnapshot), comparableReadModel(coreModel));
    }),
  );
});
