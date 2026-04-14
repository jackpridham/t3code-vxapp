import {
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type NativeApi,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
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
      limit: 500,
    });
    expect(syncServerReadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        threads: [
          expect.objectContaining({
            id: threadId,
            messages: [expect.objectContaining({ text: "loaded after navigation" })],
            snapshotCoverage: expect.objectContaining({
              messageCount: 1,
              messageLimit: 500,
            }),
          }),
        ],
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
});
