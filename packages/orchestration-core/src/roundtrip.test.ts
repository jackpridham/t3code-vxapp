import {
  CommandId,
  CheckpointRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
  OrchestrationEvent,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-04-22T00:00:00.000Z";

async function decide(
  command: OrchestrationCommand,
  readModel: OrchestrationReadModel,
): Promise<ReadonlyArray<Omit<OrchestrationEvent, "sequence">>> {
  const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));
  return (Array.isArray(result) ? result : [result]) as ReadonlyArray<
    Omit<OrchestrationEvent, "sequence">
  >;
}

async function projectEvents(
  model: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): Promise<OrchestrationReadModel> {
  let next = model;
  for (const event of events) {
    next = await Effect.runPromise(
      projectEvent(next, {
        ...event,
        sequence: next.snapshotSequence + 1,
      } as OrchestrationEvent),
    );
  }
  return next;
}

async function dispatch(
  model: OrchestrationReadModel,
  command: OrchestrationCommand,
): Promise<{
  readonly events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>;
  readonly model: OrchestrationReadModel;
}> {
  const events = await decide(command, model);
  for (const [index, event] of events.entries()) {
    Schema.decodeUnknownSync(OrchestrationEvent)({
      ...event,
      sequence: model.snapshotSequence + index + 1,
    });
  }
  return {
    events,
    model: await projectEvents(model, events),
  };
}

describe("orchestration core command/projection roundtrips", () => {
  it("emits contract-compatible events and projects a realistic command sequence", async () => {
    let readModel = createEmptyReadModel(now);
    const projectId = ProjectId.makeUnsafe("project-roundtrip");
    const threadId = ThreadId.makeUnsafe("thread-roundtrip");
    const programId = ProgramId.makeUnsafe("program-roundtrip");

    ({ model: readModel } = await dispatch(readModel, {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-project-create"),
      projectId,
      title: "Roundtrip Project",
      workspaceRoot: "/tmp/roundtrip",
      defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
      createdAt: now,
    }));

    ({ model: readModel } = await dispatch(readModel, {
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-thread-create"),
      threadId,
      projectId,
      title: "Roundtrip Thread",
      labels: ["roundtrip"],
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
    }));

    const turn = await dispatch(readModel, {
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-turn-start"),
      threadId,
      message: {
        messageId: MessageId.makeUnsafe("message-user"),
        role: "user",
        text: "Build the feature.",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      titleSeed: "Build feature",
      createdAt: now,
    });
    expect(turn.events.map((event) => event.type)).toEqual([
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    readModel = turn.model;

    ({ model: readModel } = await dispatch(readModel, {
      type: "thread.message.assistant.delta",
      commandId: CommandId.makeUnsafe("cmd-assistant-delta"),
      threadId,
      messageId: MessageId.makeUnsafe("message-assistant"),
      delta: "Done",
      turnId: TurnId.makeUnsafe("turn-1"),
      createdAt: now,
    }));

    ({ model: readModel } = await dispatch(readModel, {
      type: "thread.message.assistant.complete",
      commandId: CommandId.makeUnsafe("cmd-assistant-complete"),
      threadId,
      messageId: MessageId.makeUnsafe("message-assistant"),
      turnId: TurnId.makeUnsafe("turn-1"),
      createdAt: now,
    }));

    ({ model: readModel } = await dispatch(readModel, {
      type: "program.create",
      commandId: CommandId.makeUnsafe("cmd-program-create"),
      programId,
      title: "Roundtrip Program",
      objective: "Coordinate the work.",
      declaredRepos: ["t3code-vxapp"],
      affectedAppTargets: ["web"],
      requiredLocalSuites: [],
      requiredExternalE2ESuites: [],
      requireDevelopmentDeploy: false,
      requireExternalE2E: false,
      requireCleanPostFlight: true,
      requirePrPerRepo: true,
      executiveProjectId: projectId,
      executiveThreadId: threadId,
      currentOrchestratorThreadId: threadId,
      createdAt: now,
    }));

    ({ model: readModel } = await dispatch(readModel, {
      type: "program.notification.upsert",
      commandId: CommandId.makeUnsafe("cmd-program-notify"),
      notificationId: ProgramNotificationId.makeUnsafe("notification-roundtrip"),
      programId,
      kind: "blocked",
      severity: "critical",
      summary: "Worker is blocked.",
      evidence: { workerThreadId: "thread-worker" },
      createdAt: now,
    }));

    expect(readModel).toMatchObject({
      snapshotSequence: 8,
      projects: [
        {
          id: projectId,
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/roundtrip",
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          deletedAt: null,
        },
      ],
      programs: [
        {
          id: programId,
          title: "Roundtrip Program",
          status: "active",
          declaredRepos: ["t3code-vxapp"],
          requireCleanPostFlight: true,
          requirePrPerRepo: true,
          executiveProjectId: projectId,
          executiveThreadId: threadId,
          currentOrchestratorThreadId: threadId,
          deletedAt: null,
        },
      ],
      programNotifications: [
        {
          notificationId: ProgramNotificationId.makeUnsafe("notification-roundtrip"),
          programId,
          kind: "blocked",
          severity: "critical",
          state: "pending",
        },
      ],
      ctoAttentionItems: [
        {
          notificationId: ProgramNotificationId.makeUnsafe("notification-roundtrip"),
          programId,
          kind: "blocked",
          state: "required",
          sourceThreadId: "thread-worker",
          sourceRole: "worker",
        },
      ],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Roundtrip Thread",
          messages: [
            { id: "message-user", role: "user", text: "Build the feature.", streaming: false },
            { id: "message-assistant", role: "assistant", text: "Done", streaming: false },
          ],
        },
      ],
    });
  });

  it("replays a golden event stream into a deterministic read model", async () => {
    const projectId = ProjectId.makeUnsafe("project-golden");
    const threadId = ThreadId.makeUnsafe("thread-golden");
    const events: OrchestrationEvent[] = [
      {
        sequence: 1,
        eventId: EventId.makeUnsafe("event-golden-project"),
        type: "project.created",
        aggregateKind: "project",
        aggregateId: projectId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-golden-project"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-golden-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Golden Project",
          workspaceRoot: "/tmp/golden",
          kind: "project",
          sidebarParentProjectId: null,
          currentSessionRootThreadId: null,
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        sequence: 2,
        eventId: EventId.makeUnsafe("event-golden-thread"),
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-golden-thread"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-golden-thread"),
        metadata: {},
        payload: {
          threadId,
          projectId,
          title: "Golden Thread",
          labels: ["golden"],
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          interactionMode: "plan",
          branch: "feature/golden",
          worktreePath: "/tmp/golden/.worktrees/feature",
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        sequence: 3,
        eventId: EventId.makeUnsafe("event-golden-message"),
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-golden-message"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-golden-message"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-golden"),
          role: "assistant",
          text: "Golden response",
          turnId: TurnId.makeUnsafe("turn-golden"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        sequence: 4,
        eventId: EventId.makeUnsafe("event-golden-checkpoint"),
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-golden-checkpoint"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-golden-checkpoint"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-golden"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("checkpoint-golden"),
          status: "ready",
          files: [{ path: "src/golden.ts", kind: "modified", additions: 2, deletions: 1 }],
          assistantMessageId: MessageId.makeUnsafe("message-golden"),
          completedAt: now,
        },
      },
    ];

    let readModel = createEmptyReadModel(now);
    for (const event of events) {
      Schema.decodeUnknownSync(OrchestrationEvent)(event);
      readModel = await Effect.runPromise(projectEvent(readModel, event));
    }

    expect(readModel).toEqual({
      snapshotSequence: 4,
      projects: [
        {
          id: projectId,
          title: "Golden Project",
          workspaceRoot: "/tmp/golden",
          kind: "project",
          sidebarParentProjectId: null,
          currentSessionRootThreadId: null,
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
      programs: [],
      programNotifications: [],
      ctoAttentionItems: [],
      threads: [
        {
          id: threadId,
          projectId,
          title: "Golden Thread",
          labels: ["golden"],
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "approval-required",
          interactionMode: "plan",
          branch: "feature/golden",
          worktreePath: "/tmp/golden/.worktrees/feature",
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-golden"),
            state: "completed",
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            assistantMessageId: MessageId.makeUnsafe("message-golden"),
          },
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: MessageId.makeUnsafe("message-golden"),
              role: "assistant",
              text: "Golden response",
              turnId: TurnId.makeUnsafe("turn-golden"),
              streaming: false,
              createdAt: now,
              updatedAt: now,
            },
          ],
          activities: [],
          checkpoints: [
            {
              turnId: TurnId.makeUnsafe("turn-golden"),
              checkpointTurnCount: 1,
              checkpointRef: CheckpointRef.makeUnsafe("checkpoint-golden"),
              status: "ready",
              files: [{ path: "src/golden.ts", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: MessageId.makeUnsafe("message-golden"),
              completedAt: now,
            },
          ],
          session: null,
          proposedPlans: [],
        },
      ],
      orchestratorWakeItems: [],
      updatedAt: now,
    });
  });
});
