import {
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type NativeApi,
  type OrchestrationReadModel,
  type OrchestrationThreadSummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { addThreadDetailToReadModel } from "./orchestrationCurrentStateHydration";

const projectId = ProjectId.makeUnsafe("project-1");
const rootThreadId = ThreadId.makeUnsafe("root-thread");
const workerThreadId = ThreadId.makeUnsafe("worker-thread");

function makeThreadSummary(
  id: ThreadId,
  overrides: Partial<OrchestrationThreadSummary> = {},
): OrchestrationThreadSummary {
  return {
    id,
    projectId,
    title: "Thread",
    labels: [],
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    session: null,
    ...overrides,
  };
}

function makeThread(
  id: ThreadId,
  overrides: Partial<OrchestrationReadModel["threads"][number]> = {},
): OrchestrationReadModel["threads"][number] {
  return {
    ...makeThreadSummary(id),
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    ...overrides,
  };
}

function makeReadModel(
  threads: readonly OrchestrationReadModel["threads"][number][],
): OrchestrationReadModel {
  return {
    snapshotSequence: 10,
    snapshotProfile: "bootstrap-summary",
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: "/workspace",
        kind: "project",
        currentSessionRootThreadId: rootThreadId,
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads,
    orchestratorWakeItems: [],
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
}

function makeApi(overrides: Partial<NativeApi["orchestration"]> = {}) {
  return {
    orchestration: {
      listSessionThreads: vi.fn().mockResolvedValue([]),
      listThreadMessages: vi.fn().mockResolvedValue([
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "loaded history",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-04-14T00:00:01.000Z",
          updatedAt: "2026-04-14T00:00:01.000Z",
        },
      ]),
      listThreadActivities: vi.fn().mockResolvedValue([
        {
          id: EventId.makeUnsafe("activity-1"),
          tone: "info",
          kind: "turn.completed",
          summary: "history activity",
          payload: {},
          turnId: TurnId.makeUnsafe("turn-1"),
          createdAt: "2026-04-14T00:00:01.000Z",
        },
      ]),
      listThreadSessions: vi.fn().mockResolvedValue([]),
      listOrchestratorWakes: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  } as unknown as NativeApi;
}

describe("orchestration current-state hydration", () => {
  it("attaches bounded message and activity detail to a thread already in current state", async () => {
    const api = makeApi();
    const readModel = makeReadModel([makeThread(rootThreadId)]);

    const next = await addThreadDetailToReadModel(api, readModel, rootThreadId);

    const thread = next.threads.find((entry) => entry.id === rootThreadId);
    expect(api.orchestration.listSessionThreads).not.toHaveBeenCalled();
    expect(api.orchestration.listThreadMessages).toHaveBeenCalledWith({
      threadId: rootThreadId,
      limit: 500,
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenCalledWith({
      threadId: rootThreadId,
      limit: 250,
    });
    expect(thread?.messages).toEqual([expect.objectContaining({ text: "loaded history" })]);
    expect(thread?.activities).toEqual([expect.objectContaining({ summary: "history activity" })]);
    expect(thread?.snapshotCoverage).toEqual(
      expect.objectContaining({
        messageCount: 1,
        messageLimit: 500,
        activityCount: 1,
        activityLimit: 250,
        proposedPlanLimit: 0,
        checkpointLimit: 0,
      }),
    );
  });

  it("adds a routed historical session thread before attaching detail", async () => {
    const workerSummary = makeThreadSummary(workerThreadId, {
      parentThreadId: rootThreadId,
      orchestratorThreadId: rootThreadId,
      spawnRole: "worker",
      workflowId: "wf-root-thread",
    });
    const api = makeApi({
      listSessionThreads: vi.fn().mockResolvedValue([workerSummary]),
    });
    const readModel = makeReadModel([makeThread(rootThreadId)]);

    const next = await addThreadDetailToReadModel(api, readModel, workerThreadId);

    const worker = next.threads.find((entry) => entry.id === workerThreadId);
    expect(api.orchestration.listSessionThreads).toHaveBeenCalledWith({
      rootThreadId: workerThreadId,
      includeArchived: true,
      includeDeleted: false,
    });
    expect(next.threads.map((thread) => thread.id)).toEqual([rootThreadId, workerThreadId]);
    expect(worker).toEqual(
      expect.objectContaining({
        id: workerThreadId,
        parentThreadId: rootThreadId,
        orchestratorThreadId: rootThreadId,
        workflowId: "wf-root-thread",
        messages: [expect.objectContaining({ text: "loaded history" })],
        activities: [expect.objectContaining({ summary: "history activity" })],
      }),
    );
  });
});
