import {
  CommandId,
  EventId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProgramId = (value: string): ProgramId => ProgramId.makeUnsafe(value);
const asProgramNotificationId = (value: string): ProgramNotificationId =>
  ProgramNotificationId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

async function makeExecutiveReadModel(now: string) {
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: asEventId("evt-project-cto"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-cto"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-project-cto"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        projectId: asProjectId("project-cto"),
        title: "CTO",
        workspaceRoot: "/home/gizmo/agents-vxapp/CTO",
        kind: "executive",
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-cto"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-cto"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-thread-cto"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: asThreadId("thread-cto"),
        projectId: asProjectId("project-cto"),
        title: "Founder to CTO",
        labels: ["cto", "executive"],
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("decider programs", () => {
  it("creates an executive-owned program envelope", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.create",
          commandId: CommandId.makeUnsafe("cmd-program-create"),
          programId: asProgramId("program-cto"),
          title: "CTO web orchestration",
          objective: "Run CTO from web above Jasper.",
          executiveProjectId: asProjectId("project-cto"),
          executiveThreadId: asThreadId("thread-cto"),
          createdAt: now,
        },
        readModel,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.created");
    expect(event.aggregateKind).toBe("program");
    expect(event.aggregateId).toBe("program-cto");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      title: "CTO web orchestration",
      objective: "Run CTO from web above Jasper.",
      status: "active",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      currentOrchestratorThreadId: null,
      completedAt: null,
    });
  });

  it("rejects duplicate active programs", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);
    const created = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 3,
        eventId: asEventId("evt-program-cto"),
        aggregateKind: "program",
        aggregateId: asProgramId("program-cto"),
        type: "program.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-program-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          programId: asProgramId("program-cto"),
          title: "CTO web orchestration",
          objective: "Run CTO from web above Jasper.",
          status: "active",
          executiveProjectId: asProjectId("project-cto"),
          executiveThreadId: asThreadId("thread-cto"),
          currentOrchestratorThreadId: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "program.create",
            commandId: CommandId.makeUnsafe("cmd-program-duplicate"),
            programId: asProgramId("program-cto"),
            title: "Duplicate program",
            executiveProjectId: asProjectId("project-cto"),
            executiveThreadId: asThreadId("thread-cto"),
            createdAt: now,
          },
          readModel: created,
        }),
      ),
    ).rejects.toBeInstanceOf(OrchestrationCommandInvariantError);
  });

  it("marks a program completed when status moves to completed", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);
    const created = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 3,
        eventId: asEventId("evt-program-cto"),
        aggregateKind: "program",
        aggregateId: asProgramId("program-cto"),
        type: "program.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-program-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          programId: asProgramId("program-cto"),
          title: "CTO web orchestration",
          objective: null,
          status: "active",
          executiveProjectId: asProjectId("project-cto"),
          executiveThreadId: asThreadId("thread-cto"),
          currentOrchestratorThreadId: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.meta.update",
          commandId: CommandId.makeUnsafe("cmd-program-complete"),
          programId: asProgramId("program-cto"),
          status: "completed",
        },
        readModel: created,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.meta-updated");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      status: "completed",
    });
    expect(event.payload).toHaveProperty("completedAt");
  });

  it("upserts and consumes program notifications on the program aggregate", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);
    const created = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 3,
        eventId: asEventId("evt-program-cto"),
        aggregateKind: "program",
        aggregateId: asProgramId("program-cto"),
        type: "program.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-program-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          programId: asProgramId("program-cto"),
          title: "CTO web orchestration",
          objective: null,
          status: "active",
          executiveProjectId: asProjectId("project-cto"),
          executiveThreadId: asThreadId("thread-cto"),
          currentOrchestratorThreadId: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      }),
    );

    const upsertResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.notification.upsert",
          commandId: CommandId.makeUnsafe("cmd-notify"),
          notificationId: asProgramNotificationId("notif-cto"),
          programId: asProgramId("program-cto"),
          kind: "decision_required",
          severity: "warning",
          summary: "Choose the deployment lane.",
          evidence: { workerThreadId: "thread-worker" },
          createdAt: now,
        },
        readModel: created,
      }),
    );
    const upsertEvent = Array.isArray(upsertResult) ? upsertResult[0] : upsertResult;
    expect(upsertEvent.type).toBe("program.notification-upserted");
    expect(upsertEvent.aggregateKind).toBe("program");
    expect(upsertEvent.aggregateId).toBe("program-cto");
    expect(upsertEvent.payload).toMatchObject({
      notificationId: "notif-cto",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      kind: "decision_required",
      severity: "warning",
      state: "pending",
      evidence: { workerThreadId: "thread-worker" },
    });

    const withNotification = await Effect.runPromise(
      projectEvent(created, { ...upsertEvent, sequence: 4 }),
    );
    const consumeResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.notification.consume",
          commandId: CommandId.makeUnsafe("cmd-notify-consume"),
          programId: asProgramId("program-cto"),
          notificationId: asProgramNotificationId("notif-cto"),
          consumeReason: "reviewed",
          consumedAt: now,
        },
        readModel: withNotification,
      }),
    );
    const consumeEvent = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
    expect(consumeEvent.type).toBe("program.notification-consumed");
    expect(consumeEvent.payload).toMatchObject({
      programId: "program-cto",
      notificationId: "notif-cto",
      consumedAt: now,
      consumeReason: "reviewed",
    });
  });

  it("rejects Jasper as a worker even when a caller bypasses the CLI guard", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-jasper-worker"),
            threadId: asThreadId("thread-jasper-worker"),
            projectId: asProjectId("project-cto"),
            title: "Jasper worker bypass",
            labels: ["worker", "agent:jasper"],
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("Jasper is reserved for primary orchestrator threads");
  });
});
