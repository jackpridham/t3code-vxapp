import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
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
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly occurredAt: string;
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: string;
  readonly commandId: string | null;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : input.aggregateKind === "program"
          ? ProgramId.makeUnsafe(input.aggregateId)
          : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

async function applyEvent(
  model: OrchestrationReadModel,
  input: Parameters<typeof makeEvent>[0],
): Promise<OrchestrationReadModel> {
  return Effect.runPromise(projectEvent(model, makeEvent(input)));
}

async function modelWithProjectAndThread(input: {
  readonly now: string;
  readonly projectId?: ProjectId;
  readonly threadId?: ThreadId;
}): Promise<OrchestrationReadModel> {
  const projectId = input.projectId ?? ProjectId.makeUnsafe("project-fixture");
  const threadId = input.threadId ?? ThreadId.makeUnsafe("thread-fixture");
  const withProject = await applyEvent(createEmptyReadModel(input.now), {
    sequence: 1,
    type: "project.created",
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: input.now,
    commandId: "cmd-project-create",
    payload: {
      projectId,
      title: "Standalone Core",
      workspaceRoot: "/tmp/core",
      kind: "project",
      sidebarParentProjectId: null,
      currentSessionRootThreadId: null,
      defaultModelSelection: null,
      scripts: [],
      hooks: [],
      createdAt: input.now,
      updatedAt: input.now,
    },
  });

  return applyEvent(withProject, {
    sequence: 2,
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: input.now,
    commandId: "cmd-thread-create",
    payload: {
      threadId,
      projectId,
      title: "Core thread",
      labels: ["core"],
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
}

describe("orchestration projector", () => {
  it("starts from a standalone empty read model", () => {
    const now = "2026-04-22T00:00:00.000Z";

    expect(createEmptyReadModel(now)).toEqual({
      snapshotSequence: 0,
      projects: [],
      programs: [],
      programNotifications: [],
      ctoAttentionItems: [],
      threads: [],
      orchestratorWakeItems: [],
      updatedAt: now,
    });
  });

  it("projects project and thread lifecycle events without server services", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");

    const withProject = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(now),
        makeEvent({
          sequence: 1,
          type: "project.created",
          aggregateKind: "project",
          aggregateId: projectId,
          occurredAt: now,
          commandId: "cmd-project-create",
          payload: {
            projectId,
            title: "Standalone Core",
            workspaceRoot: "/tmp/core",
            kind: "project",
            sidebarParentProjectId: null,
            currentSessionRootThreadId: null,
            defaultModelSelection: null,
            scripts: [],
            hooks: [],
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    expect(withProject.projects).toHaveLength(1);
    expect(withProject.projects[0]).toMatchObject({
      id: projectId,
      title: "Standalone Core",
      workspaceRoot: "/tmp/core",
      deletedAt: null,
      currentSessionRootThreadId: null,
    });

    const withThread = await Effect.runPromise(
      projectEvent(
        withProject,
        makeEvent({
          sequence: 2,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId,
            projectId,
            title: "Core thread",
            labels: ["core"],
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    expect(withThread.snapshotSequence).toBe(2);
    expect(withThread.threads).toHaveLength(1);
    expect(withThread.threads[0]).toMatchObject({
      id: threadId,
      projectId,
      title: "Core thread",
      labels: ["core"],
      deletedAt: null,
      archivedAt: null,
    });
  });

  it("applies project metadata patches without clobbering omitted fields", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const later = "2026-04-22T00:05:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-meta");
    const currentThreadId = ThreadId.makeUnsafe("thread-current");
    const initial = await applyEvent(createEmptyReadModel(now), {
      sequence: 1,
      type: "project.created",
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: now,
      commandId: "cmd-project-create",
      payload: {
        projectId,
        title: "Original",
        workspaceRoot: "/tmp/original",
        kind: "project",
        sidebarParentProjectId: null,
        currentSessionRootThreadId: null,
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        scripts: [
          {
            id: "script-1",
            name: "Build",
            command: "bun run build",
            icon: "build",
            runOnWorktreeCreate: false,
          },
        ],
        hooks: [],
        createdAt: now,
        updatedAt: now,
      },
    });

    const updated = await applyEvent(initial, {
      sequence: 2,
      type: "project.meta-updated",
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: later,
      commandId: "cmd-project-update",
      payload: {
        projectId,
        title: "Renamed",
        kind: "orchestrator",
        currentSessionRootThreadId: currentThreadId,
        updatedAt: later,
      },
    });

    expect(updated.projects[0]).toMatchObject({
      id: projectId,
      title: "Renamed",
      workspaceRoot: "/tmp/original",
      kind: "orchestrator",
      currentSessionRootThreadId: currentThreadId,
      defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
      scripts: [
        {
          id: "script-1",
          name: "Build",
          command: "bun run build",
          icon: "build",
          runOnWorktreeCreate: false,
        },
      ],
      updatedAt: later,
    });
  });

  it("decodes invalid event payloads as projection failures", async () => {
    const now = "2026-04-22T00:00:00.000Z";

    await expect(
      Effect.runPromise(
        projectEvent(
          createEmptyReadModel(now),
          makeEvent({
            sequence: 1,
            type: "project.created",
            aggregateKind: "project",
            aggregateId: "project-invalid",
            occurredAt: now,
            commandId: "cmd-invalid",
            payload: {
              projectId: ProjectId.makeUnsafe("project-invalid"),
              title: "",
              workspaceRoot: "/tmp/project-invalid",
              defaultModelSelection: null,
              scripts: [],
              hooks: [],
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
      ),
    ).rejects.toThrow("project.created:payload");
  });

  it("merges assistant message deltas, preserves completed text, and ignores missing threads", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const threadId = ThreadId.makeUnsafe("thread-messages");
    const messageId = MessageId.makeUnsafe("message-assistant");
    const model = await modelWithProjectAndThread({ now, threadId });

    const withFirstDelta = await applyEvent(model, {
      sequence: 3,
      type: "thread.message-sent",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: "cmd-delta-1",
      payload: {
        threadId,
        messageId,
        role: "assistant",
        text: "hello",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    const withSecondDelta = await applyEvent(withFirstDelta, {
      sequence: 4,
      type: "thread.message-sent",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: "cmd-delta-2",
      payload: {
        threadId,
        messageId,
        role: "assistant",
        text: " world",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    const completed = await applyEvent(withSecondDelta, {
      sequence: 5,
      type: "thread.message-sent",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: "cmd-complete",
      payload: {
        threadId,
        messageId,
        role: "assistant",
        text: "",
        turnId: TurnId.makeUnsafe("turn-1"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(completed.threads[0]?.messages).toMatchObject([
      {
        id: messageId,
        text: "hello world",
        streaming: false,
        turnId: TurnId.makeUnsafe("turn-1"),
      },
    ]);

    const missingThreadResult = await applyEvent(completed, {
      sequence: 6,
      type: "thread.message-sent",
      aggregateKind: "thread",
      aggregateId: "thread-missing",
      occurredAt: now,
      commandId: "cmd-missing-thread-message",
      payload: {
        threadId: ThreadId.makeUnsafe("thread-missing"),
        messageId: MessageId.makeUnsafe("message-missing"),
        role: "assistant",
        text: "ignored",
        turnId: null,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(missingThreadResult.snapshotSequence).toBe(6);
    expect(missingThreadResult.threads).toEqual(completed.threads);
  });

  it("does not let missing checkpoint placeholders overwrite ready checkpoints", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const threadId = ThreadId.makeUnsafe("thread-checkpoints");
    const turnId = TurnId.makeUnsafe("turn-checkpoint");
    const model = await modelWithProjectAndThread({ now, threadId });

    const ready = await applyEvent(model, {
      sequence: 3,
      type: "thread.turn-diff-completed",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: "cmd-ready-checkpoint",
      payload: {
        threadId,
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: "checkpoint-ready",
        status: "ready",
        files: [{ path: "src/a.ts", kind: "modified", additions: 1, deletions: 0 }],
        assistantMessageId: MessageId.makeUnsafe("message-assistant"),
        completedAt: now,
      },
    });
    const placeholder = await applyEvent(ready, {
      sequence: 4,
      type: "thread.turn-diff-completed",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: "cmd-missing-checkpoint",
      payload: {
        threadId,
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: "checkpoint-missing",
        status: "missing",
        files: [],
        assistantMessageId: null,
        completedAt: now,
      },
    });

    expect(placeholder.threads[0]?.checkpoints).toEqual(ready.threads[0]?.checkpoints);
    expect(placeholder.threads[0]?.latestTurn).toEqual(ready.threads[0]?.latestTurn);
  });

  it("projects program notifications into CTO attention and mirrors consume/drop updates", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-program");
    const executiveThreadId = ThreadId.makeUnsafe("thread-executive");
    const programId = ProgramId.makeUnsafe("program-core");
    const notificationId = ProgramNotificationId.makeUnsafe("notification-core");
    const model = await modelWithProjectAndThread({ now, projectId, threadId: executiveThreadId });
    const withProgram = await applyEvent(model, {
      sequence: 3,
      type: "program.created",
      aggregateKind: "program",
      aggregateId: programId,
      occurredAt: now,
      commandId: "cmd-program-create",
      payload: {
        programId,
        title: "Core Program",
        objective: null,
        status: "active",
        executiveProjectId: projectId,
        executiveThreadId,
        currentOrchestratorThreadId: executiveThreadId,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    });
    const withNotification = await applyEvent(withProgram, {
      sequence: 4,
      type: "program.notification-upserted",
      aggregateKind: "program",
      aggregateId: programId,
      occurredAt: now,
      commandId: "cmd-notification-upsert",
      payload: {
        notificationId,
        programId,
        executiveProjectId: projectId,
        executiveThreadId,
        orchestratorThreadId: executiveThreadId,
        kind: "blocked",
        severity: "critical",
        summary: "Worker blocked",
        evidence: { workerThreadId: ThreadId.makeUnsafe("thread-worker") },
        state: "pending",
        queuedAt: now,
        deliveredAt: null,
        consumedAt: null,
        droppedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(withNotification.programNotifications).toHaveLength(1);
    expect(withNotification.ctoAttentionItems).toHaveLength(1);
    expect(withNotification.ctoAttentionItems![0]).toMatchObject({
      notificationId,
      state: "required",
      kind: "blocked",
    });

    const consumedAt = "2026-04-22T00:01:00.000Z";
    const consumed = await applyEvent(withNotification, {
      sequence: 5,
      type: "program.notification-consumed",
      aggregateKind: "program",
      aggregateId: programId,
      occurredAt: consumedAt,
      commandId: "cmd-notification-consume",
      payload: {
        programId,
        notificationId,
        consumedAt,
        consumeReason: "handled",
        updatedAt: consumedAt,
      },
    });

    expect(consumed.programNotifications![0]).toMatchObject({
      state: "consumed",
      consumedAt,
      consumeReason: "handled",
    });
    expect(consumed.ctoAttentionItems![0]).toMatchObject({
      state: "acknowledged",
      acknowledgedAt: consumedAt,
    });

    const droppedAt = "2026-04-22T00:02:00.000Z";
    const dropped = await applyEvent(consumed, {
      sequence: 6,
      type: "program.notification-dropped",
      aggregateKind: "program",
      aggregateId: programId,
      occurredAt: droppedAt,
      commandId: "cmd-notification-drop",
      payload: {
        programId,
        notificationId,
        droppedAt,
        dropReason: "superseded",
        updatedAt: droppedAt,
      },
    });

    expect(dropped.programNotifications![0]).toMatchObject({
      state: "dropped",
      droppedAt,
      dropReason: "superseded",
    });
    expect(dropped.ctoAttentionItems![0]).toMatchObject({
      state: "dropped",
      droppedAt,
    });
  });
});
