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
      limit: 1000,
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenCalledWith({
      threadId: rootThreadId,
      limit: 1000,
    });
    expect(thread?.messages).toEqual([expect.objectContaining({ text: "loaded history" })]);
    expect(thread?.activities).toEqual([expect.objectContaining({ summary: "history activity" })]);
    expect(thread?.snapshotCoverage).toEqual(
      expect.objectContaining({
        messageCount: 1,
        messageLimit: null,
        activityCount: 1,
        activityLimit: null,
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

  it("paginates older messages and activities until history is exhausted", async () => {
    const messagePage = Array.from({ length: 1000 }, (_, index) => ({
      id: MessageId.makeUnsafe(`message-${index + 2}`),
      role: "assistant" as const,
      text: `newer ${index}`,
      turnId: TurnId.makeUnsafe("turn-1"),
      streaming: false,
      createdAt: `2026-04-14T00:${String(index % 60).padStart(2, "0")}:01.000Z`,
      updatedAt: `2026-04-14T00:${String(index % 60).padStart(2, "0")}:01.000Z`,
    }));
    const olderMessage = {
      id: MessageId.makeUnsafe("message-1"),
      role: "user" as const,
      text: "oldest",
      turnId: TurnId.makeUnsafe("turn-1"),
      streaming: false,
      createdAt: "2026-04-13T23:59:00.000Z",
      updatedAt: "2026-04-13T23:59:00.000Z",
    };
    const activityPage = Array.from({ length: 1000 }, (_, index) => ({
      id: EventId.makeUnsafe(`activity-${index + 2}`),
      tone: "tool" as const,
      kind: "tool.completed",
      summary: `newer ${index}`,
      payload: {},
      turnId: TurnId.makeUnsafe("turn-1"),
      sequence: index + 2,
      createdAt: `2026-04-14T00:${String(index % 60).padStart(2, "0")}:01.000Z`,
    }));
    const olderActivity = {
      id: EventId.makeUnsafe("activity-1"),
      tone: "tool" as const,
      kind: "tool.completed",
      summary: "oldest",
      payload: {},
      turnId: TurnId.makeUnsafe("turn-1"),
      sequence: 1,
      createdAt: "2026-04-13T23:59:00.000Z",
    };
    const api = makeApi({
      listThreadMessages: vi
        .fn()
        .mockResolvedValueOnce(messagePage)
        .mockResolvedValueOnce([olderMessage]),
      listThreadActivities: vi
        .fn()
        .mockResolvedValueOnce(activityPage)
        .mockResolvedValueOnce([olderActivity]),
    });
    const readModel = makeReadModel([makeThread(rootThreadId)]);

    const next = await addThreadDetailToReadModel(api, readModel, rootThreadId);
    const thread = next.threads.find((entry) => entry.id === rootThreadId);

    expect(api.orchestration.listThreadMessages).toHaveBeenNthCalledWith(2, {
      threadId: rootThreadId,
      limit: 1000,
      beforeCreatedAt: messagePage[0]?.createdAt,
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenNthCalledWith(2, {
      threadId: rootThreadId,
      limit: 1000,
      beforeSequence: 2,
    });
    expect(thread?.messages[0]?.id).toBe("message-1");
    expect(thread?.messages).toHaveLength(1001);
    expect(thread?.activities[0]?.id).toBe("activity-1");
    expect(thread?.activities).toHaveLength(1001);
    expect(thread?.snapshotCoverage?.messagesTruncated).toBe(false);
    expect(thread?.snapshotCoverage?.activitiesTruncated).toBe(false);
  });

  it("dedupes overlapping activity pages and returns stable chronological order", async () => {
    const duplicateUpdated = {
      id: EventId.makeUnsafe("activity-duplicate"),
      tone: "tool" as const,
      kind: "tool.completed",
      summary: "duplicate from older page",
      payload: {},
      turnId: TurnId.makeUnsafe("turn-1"),
      sequence: 2,
      createdAt: "2026-04-14T00:00:02.000Z",
    };
    const newestPage = [
      {
        id: EventId.makeUnsafe("activity-duplicate"),
        tone: "tool" as const,
        kind: "tool.completed",
        summary: "duplicate from newest page",
        payload: {},
        turnId: TurnId.makeUnsafe("turn-1"),
        sequence: 2,
        createdAt: "2026-04-14T00:00:02.000Z",
      },
      ...Array.from({ length: 999 }, (_, index) => ({
        id: EventId.makeUnsafe(`activity-new-${index}`),
        tone: "tool" as const,
        kind: "tool.completed",
        summary: `new ${index}`,
        payload: {},
        turnId: TurnId.makeUnsafe("turn-1"),
        sequence: index + 3,
        createdAt: `2026-04-14T00:${String(index % 60).padStart(2, "0")}:03.000Z`,
      })),
    ];
    const api = makeApi({
      listThreadMessages: vi.fn().mockResolvedValue([]),
      listThreadActivities: vi
        .fn()
        .mockResolvedValueOnce(newestPage)
        .mockResolvedValueOnce([
          {
            id: EventId.makeUnsafe("activity-oldest"),
            tone: "tool" as const,
            kind: "tool.completed",
            summary: "oldest",
            payload: {},
            turnId: TurnId.makeUnsafe("turn-1"),
            sequence: 1,
            createdAt: "2026-04-14T00:00:01.000Z",
          },
          duplicateUpdated,
        ]),
    });
    const readModel = makeReadModel([makeThread(rootThreadId)]);

    const next = await addThreadDetailToReadModel(api, readModel, rootThreadId);
    const thread = next.threads.find((entry) => entry.id === rootThreadId);

    expect(thread?.activities.map((activity) => activity.id).slice(0, 3)).toEqual([
      "activity-oldest",
      "activity-duplicate",
      "activity-new-0",
    ]);
    expect(
      thread?.activities.find(
        (activity) => activity.id === EventId.makeUnsafe("activity-duplicate"),
      )?.summary,
    ).toBe("duplicate from newest page");
    expect(thread?.activities).toHaveLength(1001);
  });
});
