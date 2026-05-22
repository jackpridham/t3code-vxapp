import {
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type NativeApi,
  type OrchestrationReadModel,
  type OrchestrationThreadSummary,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  hydrateMissingRouteThread,
  hydrateRouteThreadHistory,
  threadNeedsRouteHistoryHydration,
} from "./routeThreadHistoryHydration";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";

const projectId = ProjectId.makeUnsafe("project-1");
const threadId = ThreadId.makeUnsafe("thread-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId,
    title: "Thread",
    labels: [],
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    persistedFileChanges: [],
    activities: [],
    proposedPlans: [],
    error: null,
    hasActiveError: false,
    activeError: null,
    historicalError: null,
    errorPresentationSource: "none",
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeStartedSummaryThread(): Thread {
  return makeThread({
    latestTurn: {
      turnId: TurnId.makeUnsafe("turn-1"),
      state: "completed",
      requestedAt: "2026-04-14T00:00:00.000Z",
      startedAt: "2026-04-14T00:00:01.000Z",
      completedAt: "2026-04-14T00:00:02.000Z",
      assistantMessageId: null,
    },
  });
}

function makeHydratedCoverage() {
  return {
    messageCount: 1,
    messageLimit: 500,
    messagesTruncated: false,
    proposedPlanCount: 0,
    proposedPlanLimit: 0,
    proposedPlansTruncated: false,
    activityCount: 0,
    activityLimit: 250,
    activitiesTruncated: false,
    checkpointCount: 0,
    checkpointLimit: 0,
    checkpointsTruncated: false,
  };
}

function makeSummaryCoverage() {
  return {
    ...makeHydratedCoverage(),
    messageCount: 0,
    messageLimit: 0,
    activityCount: 0,
    activityLimit: 0,
  };
}

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 10,
    snapshotProfile: "bootstrap-summary",
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: "/workspace",
        kind: "project",
        currentSessionRootThreadId: threadId,
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: threadId,
        projectId,
        title: "Thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        hasActiveError: false,
        activeError: null,
        historicalError: null,
        errorPresentationSource: "none",
      },
    ],
    orchestratorWakeItems: [],
    updatedAt: "2026-04-14T00:00:00.000Z",
  };
}

function makeApi(): NativeApi {
  return {
    orchestration: {
      getCurrentState: vi.fn().mockResolvedValue(makeReadModel()),
      listSessionThreads: vi.fn().mockResolvedValue([]),
      listThreadMessages: vi.fn().mockResolvedValue([
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "loaded after navigation",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-04-14T00:00:02.000Z",
          updatedAt: "2026-04-14T00:00:02.000Z",
        },
      ]),
      listThreadCheckpoints: vi.fn().mockResolvedValue([]),
      listThreadActivities: vi.fn().mockResolvedValue([]),
      listThreadSessions: vi.fn().mockResolvedValue([]),
      listOrchestratorWakes: vi.fn().mockResolvedValue([]),
    },
  } as unknown as NativeApi;
}

describe("route thread history hydration", () => {
  it("does not hydrate empty never-started draft-like threads", () => {
    expect(threadNeedsRouteHistoryHydration(makeThread())).toBe(false);
  });

  it("hydrates empty orchestrator threads when worker sessions exist", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          spawnRole: "orchestrator",
          sessionWorkerThreadCount: 2,
        }),
      ),
    ).toBe(true);
  });

  it("hydrates empty orchestrator route summaries because worker sessions may exist", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          spawnRole: "orchestrator",
          snapshotCoverage: makeSummaryCoverage(),
        }),
      ),
    ).toBe(true);
  });

  it("hydrates started summary-only threads reached by route navigation", async () => {
    const api = makeApi();
    const syncServerReadModel = vi.fn();

    await expect(
      hydrateRouteThreadHistory({
        api,
        threadId,
        thread: makeStartedSummaryThread(),
        syncServerReadModel,
      }),
    ).resolves.toBe(true);

    expect(api.orchestration.getCurrentState).toHaveBeenCalledTimes(1);
    expect(api.orchestration.listThreadMessages).toHaveBeenCalledWith({
      threadId,
      limit: 200,
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenCalledWith({
      threadId,
      limit: 200,
      payloadMode: "compact",
    });
    expect(syncServerReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        threads: [
          expect.objectContaining({
            id: threadId,
            messages: [expect.objectContaining({ text: "loaded after navigation" })],
            snapshotCoverage: expect.objectContaining({
              messageCount: 1,
              messageLimit: 200,
            }),
          }),
        ],
      }),
    );
  });

  it("hydrates a missing route thread into the store when detail lookup can resolve it", async () => {
    const api = makeApi();
    const missingThreadId = ThreadId.makeUnsafe("thread-missing");
    const resolvedThread = {
      ...makeReadModel().threads[0],
      id: missingThreadId,
      title: "Resolved thread",
    };
    vi.mocked(api.orchestration.listSessionThreads).mockResolvedValue([
      resolvedThread,
    ] as OrchestrationThreadSummary[]);
    const syncServerReadModel = vi.fn();

    await expect(
      hydrateMissingRouteThread({
        api,
        threadId: missingThreadId,
        syncServerReadModel,
      }),
    ).resolves.toBe(true);

    expect(api.orchestration.getCurrentState).toHaveBeenCalledTimes(1);
    expect(api.orchestration.listSessionThreads).toHaveBeenCalledWith({
      rootThreadId: missingThreadId,
      includeArchived: true,
      includeDeleted: false,
    });
    expect(syncServerReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        threads: expect.arrayContaining([expect.objectContaining({ id: missingThreadId })]),
      }),
    );
  });

  it("does not sync state when a missing route thread still cannot be resolved", async () => {
    const api = makeApi();
    const missingThreadId = ThreadId.makeUnsafe("thread-missing");
    vi.mocked(api.orchestration.listSessionThreads).mockResolvedValue([]);
    const syncServerReadModel = vi.fn();

    await expect(
      hydrateMissingRouteThread({
        api,
        threadId: missingThreadId,
        syncServerReadModel,
      }),
    ).resolves.toBe(false);

    expect(api.orchestration.getCurrentState).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).not.toHaveBeenCalled();
  });

  it("hydrates orchestrator route history and worker checkpoints without loading every worker history", async () => {
    const workerThreadId = ThreadId.makeUnsafe("worker-1");
    const api = makeApi();
    vi.mocked(api.orchestration.listSessionThreads).mockResolvedValue([
      {
        id: threadId,
        projectId,
        title: "Orchestrator",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        session: null,
        hasActiveError: false,
        activeError: null,
        historicalError: null,
        errorPresentationSource: "none",
        spawnRole: "orchestrator",
      },
      {
        id: workerThreadId,
        projectId: ProjectId.makeUnsafe("project-worker"),
        title: "Worker",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: "/home/gizmo/worktrees/api-vxapp-1",
        latestTurn: null,
        createdAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        session: null,
        hasActiveError: false,
        activeError: null,
        historicalError: null,
        errorPresentationSource: "none",
        parentThreadId: threadId,
        orchestratorThreadId: threadId,
        spawnRole: "worker",
      },
    ] satisfies OrchestrationThreadSummary[]);
    const syncServerReadModel = vi.fn();

    await expect(
      hydrateRouteThreadHistory({
        api,
        threadId,
        thread: makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          spawnRole: "orchestrator",
        }),
        syncServerReadModel,
      }),
    ).resolves.toBe(true);

    expect(api.orchestration.listSessionThreads).toHaveBeenCalledWith({
      rootThreadId: threadId,
      includeArchived: true,
      includeDeleted: false,
    });
    expect(api.orchestration.listThreadMessages).toHaveBeenCalledWith({
      threadId,
      limit: 200,
    });
    expect(api.orchestration.listThreadMessages).toHaveBeenCalledTimes(1);
    expect(api.orchestration.listThreadCheckpoints).toHaveBeenCalledWith({
      threadId: workerThreadId,
      limit: 1000,
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenCalledWith({
      threadId,
      limit: 200,
      payloadMode: "compact",
    });
    expect(api.orchestration.listThreadActivities).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        threads: expect.arrayContaining([
          expect.objectContaining({
            id: workerThreadId,
            messages: [],
          }),
        ]),
      }),
    );
  });

  it("skips already hydrated threads during subsequent navigation", async () => {
    const api = makeApi();
    const syncServerReadModel = vi.fn();

    await expect(
      hydrateRouteThreadHistory({
        api,
        threadId,
        thread: makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          snapshotCoverage: makeHydratedCoverage(),
          messages: [
            {
              id: MessageId.makeUnsafe("message-existing"),
              role: "assistant",
              text: "already loaded",
              turnId: null,
              streaming: false,
              createdAt: "2026-04-14T00:00:02.000Z",
            },
          ],
        }),
        syncServerReadModel,
      }),
    ).resolves.toBe(false);

    expect(api.orchestration.getCurrentState).not.toHaveBeenCalled();
    expect(syncServerReadModel).not.toHaveBeenCalled();
  });

  it("hydrates started threads with summary-only zero-limit coverage", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          snapshotCoverage: makeSummaryCoverage(),
        }),
      ),
    ).toBe(true);
  });

  it("hydrates partial live threads that have messages but no bounded detail coverage", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          messages: [
            {
              id: MessageId.makeUnsafe("message-live"),
              role: "assistant",
              text: "live only",
              turnId: TurnId.makeUnsafe("turn-1"),
              streaming: false,
              createdAt: "2026-04-14T00:00:02.000Z",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("hydrates started threads when either messages or activities only have summary coverage", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          snapshotCoverage: {
            ...makeSummaryCoverage(),
            messageLimit: null,
            activityLimit: 0,
          },
        }),
      ),
    ).toBe(true);

    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          snapshotCoverage: {
            ...makeSummaryCoverage(),
            messageLimit: 0,
            activityLimit: null,
          },
        }),
      ),
    ).toBe(true);
  });

  it("skips started threads after both message and activity coverage are fully hydrated", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          latestTurn: makeStartedSummaryThread().latestTurn,
          snapshotCoverage: {
            ...makeSummaryCoverage(),
            messageLimit: null,
            activityLimit: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("hydrates session-only started threads without waiting for messages first", () => {
    expect(
      threadNeedsRouteHistoryHydration(
        makeThread({
          session: {
            provider: "codex",
            status: "ready",
            createdAt: "2026-04-14T00:00:00.000Z",
            updatedAt: "2026-04-14T00:00:01.000Z",
            orchestrationStatus: "idle",
          },
        }),
      ),
    ).toBe(true);
  });
});
