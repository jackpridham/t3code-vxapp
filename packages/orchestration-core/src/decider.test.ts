import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

async function decide(
  command: OrchestrationCommand,
  readModel: OrchestrationReadModel,
): Promise<ReadonlyArray<Omit<OrchestrationEvent, "sequence">>> {
  const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));
  return (Array.isArray(result) ? result : [result]) as ReadonlyArray<
    Omit<OrchestrationEvent, "sequence">
  >;
}

async function projectSequence(
  readModel: OrchestrationReadModel,
  events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  startSequence = readModel.snapshotSequence + 1,
): Promise<OrchestrationReadModel> {
  let next = readModel;
  for (const [index, event] of events.entries()) {
    next = await Effect.runPromise(
      projectEvent(next, { ...event, sequence: startSequence + index } as OrchestrationEvent),
    );
  }
  return next;
}

async function readModelWithProject(input: {
  readonly now: string;
  readonly projectId?: ProjectId;
  readonly title?: string;
  readonly kind?: "project" | "orchestrator" | "executive";
}): Promise<OrchestrationReadModel> {
  const readModel = createEmptyReadModel(input.now);
  const events = await decide(
    {
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-create-${input.projectId ?? "project"}`),
      projectId: input.projectId ?? ProjectId.makeUnsafe("project-fixture"),
      title: input.title ?? "Project",
      workspaceRoot: "/tmp/project",
      kind: input.kind,
      createdAt: input.now,
    },
    readModel,
  );
  return projectSequence(readModel, events);
}

function threadCreateCommand(input: {
  readonly now: string;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly labels?: ReadonlyArray<string>;
  readonly spawnRole?: "orchestrator" | "worker" | "supervisor";
}): OrchestrationCommand {
  return {
    type: "thread.create",
    commandId: CommandId.makeUnsafe(`cmd-create-${input.threadId ?? "thread"}`),
    threadId: input.threadId ?? ThreadId.makeUnsafe("thread-fixture"),
    projectId: input.projectId,
    title: "Thread",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    labels: input.labels,
    spawnRole: input.spawnRole,
    createdAt: input.now,
  };
}

describe("orchestration decider", () => {
  it("decides project creation from an empty read model", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-decider");

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create"),
          projectId,
          title: "Project Decider",
          workspaceRoot: "/tmp/project-decider",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect(event.aggregateKind).toBe("project");
    expect(event.aggregateId).toBe(projectId);
    expect(event.commandId).toBe(CommandId.makeUnsafe("cmd-project-create"));
    expect(event.correlationId).toBe(CommandId.makeUnsafe("cmd-project-create"));
    expect(event.payload).toMatchObject({
      projectId,
      title: "Project Decider",
      workspaceRoot: "/tmp/project-decider",
      kind: "project",
      scripts: [],
      hooks: [],
    });
  });

  it("rejects duplicate project creation through core invariants", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-duplicate");
    const createResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create"),
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }),
    );
    const createEvent = Array.isArray(createResult) ? createResult[0]! : createResult;
    const readModel = await Effect.runPromise(
      projectEvent(createEmptyReadModel(now), { ...createEvent, sequence: 1 }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-create-again"),
            projectId,
            title: "Project again",
            workspaceRoot: "/tmp/project-again",
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("decides thread creation after projecting a project event", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-thread-decider");
    const threadId = ThreadId.makeUnsafe("thread-decider");
    const projectResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create-for-thread"),
          projectId,
          title: "Thread Project",
          workspaceRoot: "/tmp/thread-project",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }),
    );
    const projectEventWithoutSequence = Array.isArray(projectResult)
      ? projectResult[0]!
      : projectResult;
    const readModel = await Effect.runPromise(
      projectEvent(createEmptyReadModel(now), { ...projectEventWithoutSequence, sequence: 1 }),
    );

    const threadResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-create"),
          threadId,
          projectId,
          title: "Thread Decider",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          labels: ["standalone"],
          createdAt: now,
        },
        readModel,
      }),
    );

    const threadEvent = Array.isArray(threadResult) ? threadResult[0] : threadResult;
    expect(threadEvent.type).toBe("thread.created");
    expect(threadEvent.payload).toMatchObject({
      threadId,
      projectId,
      labels: ["standalone"],
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    });
  });

  it("rejects thread creation when the project is missing or thread already exists", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-thread-guards");
    const threadId = ThreadId.makeUnsafe("thread-guards");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: threadCreateCommand({ now, projectId, threadId }),
          readModel: createEmptyReadModel(now),
        }),
      ),
    ).rejects.toThrow("does not exist");

    const withProject = await readModelWithProject({ now, projectId });
    const threadEvents = await decide(
      threadCreateCommand({ now, projectId, threadId }),
      withProject,
    );
    const withThread = await projectSequence(withProject, threadEvents);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: threadCreateCommand({ now, projectId, threadId }),
          readModel: withThread,
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("enforces orchestrator thread slot and reserved Jasper worker label", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-orchestrator-slot");
    const withProject = await readModelWithProject({
      now,
      projectId,
      title: "Jasper CTO",
      kind: "orchestrator",
    });

    const firstThreadEvents = await decide(
      threadCreateCommand({
        now,
        projectId,
        threadId: ThreadId.makeUnsafe("thread-orchestrator-one"),
      }),
      withProject,
    );
    expect(firstThreadEvents[0]?.payload).toMatchObject({
      labels: ["orchestrator", "jasper-cto"],
    });
    const withFirstThread = await projectSequence(withProject, firstThreadEvents);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: threadCreateCommand({
            now,
            projectId,
            threadId: ThreadId.makeUnsafe("thread-orchestrator-two"),
          }),
          readModel: withFirstThread,
        }),
      ),
    ).rejects.toThrow("already has an active thread");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: threadCreateCommand({
            now,
            projectId,
            threadId: ThreadId.makeUnsafe("thread-worker-jasper"),
            labels: ["agent:JASPER"],
            spawnRole: "worker",
          }),
          readModel: withProject,
        }),
      ),
    ).rejects.toThrow("Jasper is reserved");
  });

  it("emits thread label maintenance events when project kind changes", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-kind-change");
    const withProject = await readModelWithProject({ now, projectId, title: "Original" });
    const threadEvents = await decide(
      threadCreateCommand({
        now,
        projectId,
        threadId: ThreadId.makeUnsafe("thread-label-maintenance"),
        labels: ["custom"],
      }),
      withProject,
    );
    const withThread = await projectSequence(withProject, threadEvents);

    const toOrchestratorEvents = await decide(
      {
        type: "project.meta.update",
        commandId: CommandId.makeUnsafe("cmd-project-kind-orchestrator"),
        projectId,
        title: "Jasper CTO",
        kind: "orchestrator",
      },
      withThread,
    );

    expect(toOrchestratorEvents).toHaveLength(2);
    expect(toOrchestratorEvents.map((event) => event.type)).toEqual([
      "project.meta-updated",
      "thread.meta-updated",
    ]);
    expect(toOrchestratorEvents[1]?.payload).toMatchObject({
      labels: ["orchestrator", "jasper-cto", "custom"],
    });

    const asOrchestrator = await projectSequence(withThread, toOrchestratorEvents);
    const toProjectEvents = await decide(
      {
        type: "project.meta.update",
        commandId: CommandId.makeUnsafe("cmd-project-kind-project"),
        projectId,
        kind: "project",
      },
      asOrchestrator,
    );
    expect(toProjectEvents[1]?.payload).toMatchObject({
      labels: ["custom"],
    });
  });

  it("rejects converting a project with multiple active threads into an orchestrator", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-too-many-active");
    const withProject = await readModelWithProject({ now, projectId });
    const first = await decide(
      threadCreateCommand({ now, projectId, threadId: ThreadId.makeUnsafe("thread-active-one") }),
      withProject,
    );
    const withFirst = await projectSequence(withProject, first);
    const second = await decide(
      threadCreateCommand({ now, projectId, threadId: ThreadId.makeUnsafe("thread-active-two") }),
      withFirst,
    );
    const withTwoThreads = await projectSequence(withFirst, second);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.meta.update",
            commandId: CommandId.makeUnsafe("cmd-convert-too-many"),
            projectId,
            kind: "orchestrator",
          },
          readModel: withTwoThreads,
        }),
      ),
    ).rejects.toThrow("cannot be converted to an orchestrator");
  });

  it("emits linked user-message and turn-start events for turn starts", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-turn-start");
    const threadId = ThreadId.makeUnsafe("thread-turn-start");
    const withProject = await readModelWithProject({ now, projectId });
    const withThread = await projectSequence(
      withProject,
      await decide(threadCreateCommand({ now, projectId, threadId }), withProject),
    );

    const events = await decide(
      {
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("message-user"),
          role: "user",
          text: "Please continue.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        titleSeed: "Continue",
        createdAt: now,
      },
      withThread,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "thread.message-sent",
      commandId: CommandId.makeUnsafe("cmd-turn-start"),
      correlationId: CommandId.makeUnsafe("cmd-turn-start"),
      payload: {
        threadId,
        role: "user",
        text: "Please continue.",
        streaming: false,
      },
    });
    expect(events[1]).toMatchObject({
      type: "thread.turn-start-requested",
      causationEventId: events[0]?.eventId,
      payload: {
        threadId,
        messageId: MessageId.makeUnsafe("message-user"),
        titleSeed: "Continue",
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      },
    });
  });

  it("rejects turn starts that reference a missing proposed plan", async () => {
    const now = "2026-04-22T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-source-plan");
    const threadId = ThreadId.makeUnsafe("thread-source-plan");
    const withProject = await readModelWithProject({ now, projectId });
    const withThread = await projectSequence(
      withProject,
      await decide(threadCreateCommand({ now, projectId, threadId }), withProject),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.makeUnsafe("cmd-turn-missing-plan"),
            threadId,
            message: {
              messageId: MessageId.makeUnsafe("message-user-missing-plan"),
              role: "user",
              text: "Implement the plan.",
              attachments: [],
            },
            sourceProposedPlan: {
              threadId,
              planId: "plan-missing",
            },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            createdAt: now,
          },
          readModel: withThread,
        }),
      ),
    ).rejects.toThrow("does not exist on thread");
  });
});
