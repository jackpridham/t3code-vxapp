import {
  CommandId,
  EventId,
  ProgramId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionStateRepository } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";

function programCreatedEvent(): OrchestrationEvent {
  const now = "2026-05-16T00:00:00.000Z";
  return {
    type: "program.created",
    sequence: 1,
    eventId: "evt-program-created",
    aggregateKind: "program",
    aggregateId: ProgramId.makeUnsafe("program-1"),
    commandId: CommandId.makeUnsafe("cmd-program-created"),
    correlationId: CommandId.makeUnsafe("cmd-program-created"),
    causationEventId: null,
    actor: { kind: "system", id: "test" },
    metadata: {},
    occurredAt: now,
    payload: {
      programId: ProgramId.makeUnsafe("program-1"),
      title: "Owner Program",
      objective: "Owned outside local projection",
      status: "active",
      executiveProjectId: ProjectId.makeUnsafe("project-1"),
      executiveThreadId: ThreadId.makeUnsafe("thread-1"),
      currentOrchestratorThreadId: ThreadId.makeUnsafe("thread-1"),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
  } as unknown as OrchestrationEvent;
}

function threadCreatedEvent(): OrchestrationEvent {
  const now = "2026-05-16T00:00:00.000Z";
  return {
    type: "thread.created",
    sequence: 1,
    eventId: EventId.makeUnsafe("evt-thread-created"),
    aggregateKind: "thread",
    aggregateId: ThreadId.makeUnsafe("thread-activity-cap"),
    commandId: CommandId.makeUnsafe("cmd-thread-created"),
    correlationId: CommandId.makeUnsafe("cmd-thread-created"),
    causationEventId: null,
    actor: { kind: "system", id: "test" },
    metadata: {},
    occurredAt: now,
    payload: {
      threadId: ThreadId.makeUnsafe("thread-activity-cap"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Activity cap",
      labels: [],
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  } as unknown as OrchestrationEvent;
}

function threadActivityAppendedEvent(index: number): OrchestrationEvent {
  const now = `2026-05-16T00:${String(index % 60).padStart(2, "0")}:00.000Z`;
  return {
    type: "thread.activity-appended",
    sequence: index + 2,
    eventId: EventId.makeUnsafe(`evt-activity-appended-${index}`),
    aggregateKind: "thread",
    aggregateId: ThreadId.makeUnsafe("thread-activity-cap"),
    commandId: CommandId.makeUnsafe(`cmd-activity-appended-${index}`),
    correlationId: CommandId.makeUnsafe(`cmd-activity-appended-${index}`),
    causationEventId: null,
    actor: { kind: "system", id: "test" },
    metadata: {},
    occurredAt: now,
    payload: {
      threadId: ThreadId.makeUnsafe("thread-activity-cap"),
      activity: {
        id: EventId.makeUnsafe(`activity-${String(index).padStart(4, "0")}`),
        tone: "info",
        kind: "test.activity",
        summary: `Activity ${index}`,
        payload: {},
        turnId: null,
        sequence: index,
        createdAt: now,
      },
    },
  } as unknown as OrchestrationEvent;
}

const TestLayer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(NodeServices.layer),
);

describe("OrchestrationProjectionPipeline authority boundary", () => {
  it("builds without decommissioned projection repositories and skips owner-owned program events", async () => {
    const stateRows = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* OrchestrationProjectionPipeline;
        const projectionState = yield* ProjectionStateRepository;

        yield* pipeline.projectEvent(programCreatedEvent());

        return yield* projectionState.listAll();
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(stateRows.map((row) => row.projector)).toEqual(
      expect.arrayContaining([
        "projection.projects",
        "projection.threads",
        "projection.thread-messages",
        "projection.thread-turns",
        "projection.checkpoints",
      ]),
    );
    expect(stateRows.map((row) => row.projector)).not.toEqual(
      expect.arrayContaining([
        "projection.programs",
        "projection.program-notifications",
        "projection.cto-attention",
        "projection.pending-approvals",
        "projection.orchestrator-wakes",
      ]),
    );
  });

  it("caps persisted thread activities to match the read-model retention window", async () => {
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* OrchestrationProjectionPipeline;
        const activities = yield* ProjectionThreadActivityRepository;

        yield* pipeline.projectEvents([
          threadCreatedEvent(),
          ...Array.from({ length: 505 }, (_, index) => threadActivityAppendedEvent(index)),
        ]);

        return yield* activities.listByThreadId({
          threadId: ThreadId.makeUnsafe("thread-activity-cap"),
        });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(rows).toHaveLength(500);
    expect(rows[0]?.activityId).toBe(EventId.makeUnsafe("activity-0005"));
    expect(rows.at(-1)?.activityId).toBe(EventId.makeUnsafe("activity-0504"));
  });
});
