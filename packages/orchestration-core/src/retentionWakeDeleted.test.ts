import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-04-22T00:00:00.000Z";

function event(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: string;
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
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`cmd-${input.sequence}`),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(`cmd-${input.sequence}`),
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

async function apply(
  model: OrchestrationReadModel,
  input: Parameters<typeof event>[0],
): Promise<OrchestrationReadModel> {
  return Effect.runPromise(projectEvent(model, event(input)));
}

async function fixtureModel(): Promise<OrchestrationReadModel> {
  const projectId = ProjectId.makeUnsafe("project-retention");
  const threadId = ThreadId.makeUnsafe("thread-retention");
  const withProject = await apply(createEmptyReadModel(now), {
    sequence: 1,
    type: "project.created",
    aggregateKind: "project",
    aggregateId: projectId,
    payload: {
      projectId,
      title: "Retention Project",
      workspaceRoot: "/tmp/retention",
      kind: "project",
      sidebarParentProjectId: null,
      currentSessionRootThreadId: null,
      defaultModelSelection: null,
      scripts: [],
      hooks: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  return apply(withProject, {
    sequence: 2,
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: threadId,
    payload: {
      threadId,
      projectId,
      title: "Retention Thread",
      labels: [],
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
}

describe("orchestration core retention, wake, and deleted edge cases", () => {
  it("caps long-lived thread message, checkpoint, proposed plan, and activity projections", async () => {
    const threadId = ThreadId.makeUnsafe("thread-retention");
    let model = await fixtureModel();
    let sequence = 3;

    for (let index = 0; index < 2_005; index += 1) {
      model = await apply(model, {
        sequence: sequence++,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe(`message-${index.toString().padStart(4, "0")}`),
          role: "assistant",
          text: `message ${index}`,
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    for (let index = 0; index < 505; index += 1) {
      model = await apply(model, {
        sequence: sequence++,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe(`turn-${index.toString().padStart(4, "0")}`),
          checkpointTurnCount: index + 1,
          checkpointRef: `checkpoint-${index}`,
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: now,
        },
      });
    }

    for (let index = 0; index < 205; index += 1) {
      model = await apply(model, {
        sequence: sequence++,
        type: "thread.proposed-plan-upserted",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          proposedPlan: {
            id: `plan-${index.toString().padStart(4, "0")}`,
            turnId: null,
            planMarkdown: `Plan ${index}`,
            implementedAt: null,
            implementationThreadId: null,
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    }

    for (let index = 0; index < 505; index += 1) {
      model = await apply(model, {
        sequence: sequence++,
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          activity: {
            id: EventId.makeUnsafe(`activity-${index.toString().padStart(4, "0")}`),
            tone: "info",
            kind: "test.activity",
            summary: `Activity ${index}`,
            payload: {},
            turnId: null,
            sequence: index,
            createdAt: now,
          },
        },
      });
    }

    const thread = model.threads[0]!;
    expect(thread.messages).toHaveLength(2_000);
    expect(thread.messages[0]?.id).toBe(MessageId.makeUnsafe("message-0005"));
    expect(thread.checkpoints).toHaveLength(500);
    expect(thread.checkpoints[0]?.turnId).toBe(TurnId.makeUnsafe("turn-0005"));
    expect(thread.proposedPlans).toHaveLength(200);
    expect(thread.proposedPlans[0]?.id).toBe("plan-0005");
    expect(thread.activities).toHaveLength(500);
    expect(thread.activities[0]?.id).toBe(EventId.makeUnsafe("activity-0005"));
  });

  it("upserts wake items by id, orders them by queue time, and touches the orchestrator thread", async () => {
    const projectId = ProjectId.makeUnsafe("project-retention");
    const orchestratorThreadId = ThreadId.makeUnsafe("thread-retention");
    let model = await fixtureModel();

    model = await apply(model, {
      sequence: 3,
      type: "thread.orchestrator-wake-upserted",
      aggregateKind: "thread",
      aggregateId: orchestratorThreadId,
      payload: {
        threadId: orchestratorThreadId,
        wakeItem: {
          wakeId: "wake-later",
          orchestratorThreadId,
          orchestratorProjectId: projectId,
          workerThreadId: ThreadId.makeUnsafe("thread-worker-later"),
          workerProjectId: ProjectId.makeUnsafe("project-worker"),
          workerTurnId: TurnId.makeUnsafe("turn-later"),
          workerTitleSnapshot: "Later worker",
          outcome: "completed",
          summary: "Later completion",
          queuedAt: "2026-04-22T00:00:02.000Z",
          state: "pending",
          deliveredAt: null,
          consumedAt: null,
        },
      },
    });
    model = await apply(model, {
      sequence: 4,
      type: "thread.orchestrator-wake-upserted",
      aggregateKind: "thread",
      aggregateId: orchestratorThreadId,
      payload: {
        threadId: orchestratorThreadId,
        wakeItem: {
          wakeId: "wake-earlier",
          orchestratorThreadId,
          orchestratorProjectId: projectId,
          workerThreadId: ThreadId.makeUnsafe("thread-worker-earlier"),
          workerProjectId: ProjectId.makeUnsafe("project-worker"),
          workerTurnId: TurnId.makeUnsafe("turn-earlier"),
          workerTitleSnapshot: "Earlier worker",
          outcome: "failed",
          summary: "Earlier failure",
          queuedAt: "2026-04-22T00:00:01.000Z",
          state: "pending",
          deliveredAt: null,
          consumedAt: null,
        },
      },
    });
    model = await apply(model, {
      sequence: 5,
      type: "thread.orchestrator-wake-upserted",
      aggregateKind: "thread",
      aggregateId: orchestratorThreadId,
      payload: {
        threadId: orchestratorThreadId,
        wakeItem: {
          wakeId: "wake-later",
          orchestratorThreadId,
          orchestratorProjectId: projectId,
          workerThreadId: ThreadId.makeUnsafe("thread-worker-later"),
          workerProjectId: ProjectId.makeUnsafe("project-worker"),
          workerTurnId: TurnId.makeUnsafe("turn-later"),
          workerTitleSnapshot: "Later worker",
          outcome: "completed",
          summary: "Later consumed",
          queuedAt: "2026-04-22T00:00:02.000Z",
          state: "consumed",
          deliveredAt: "2026-04-22T00:00:03.000Z",
          consumedAt: "2026-04-22T00:00:04.000Z",
          consumeReason: "worker_rechecked",
        },
      },
    });

    expect(model.orchestratorWakeItems.map((item) => item.wakeId)).toEqual([
      "wake-earlier",
      "wake-later",
    ]);
    expect(model.orchestratorWakeItems[1]).toMatchObject({
      wakeId: "wake-later",
      state: "consumed",
      summary: "Later consumed",
      consumeReason: "worker_rechecked",
    });
    expect(model.threads[0]?.updatedAt).toBe(now);
  });

  it("rejects commands against deleted projects and threads while preserving soft-delete id reservations", async () => {
    const projectId = ProjectId.makeUnsafe("project-deleted");
    const threadId = ThreadId.makeUnsafe("thread-deleted");
    let model = createEmptyReadModel(now);

    model = await apply(model, {
      sequence: 1,
      type: "project.created",
      aggregateKind: "project",
      aggregateId: projectId,
      payload: {
        projectId,
        title: "Deleted Project",
        workspaceRoot: "/tmp/deleted",
        kind: "project",
        sidebarParentProjectId: null,
        currentSessionRootThreadId: null,
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    model = await apply(model, {
      sequence: 2,
      type: "thread.created",
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        projectId,
        title: "Deleted Thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    model = await apply(model, {
      sequence: 3,
      type: "thread.deleted",
      aggregateKind: "thread",
      aggregateId: threadId,
      payload: {
        threadId,
        deletedAt: now,
      },
    });
    model = await apply(model, {
      sequence: 4,
      type: "project.deleted",
      aggregateKind: "project",
      aggregateId: projectId,
      payload: {
        projectId,
        deletedAt: now,
      },
    });

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-on-deleted-project"),
            threadId: ThreadId.makeUnsafe("thread-new"),
            projectId,
            title: "New Thread",
            labels: [],
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          readModel: model,
        }),
      ),
    ).rejects.toThrow("does not exist");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe("cmd-deleted-thread-update"),
            threadId,
            title: "Should fail",
          },
          readModel: model,
        }),
      ),
    ).rejects.toThrow("does not exist");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-recreate-project"),
            projectId,
            title: "Recreated",
            workspaceRoot: "/tmp/recreated",
            createdAt: now,
          },
          readModel: model,
        }),
      ),
    ).rejects.toThrow("already exists");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-recreate-thread"),
            threadId,
            projectId: ProjectId.makeUnsafe("project-other"),
            title: "Recreated Thread",
            labels: [],
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          readModel: model,
        }),
      ),
    ).rejects.toThrow("does not exist");
  });
});
