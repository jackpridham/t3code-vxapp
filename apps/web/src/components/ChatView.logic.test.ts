import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/utils", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000000",
}));

vi.mock("../notificationDispatch", () => ({
  dispatchNotification: vi.fn(),
}));

import { useStore } from "../store";

import {
  buildExpiredTerminalContextToastCopy,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  resolveChatHeaderBadgeLabel,
  resolveInitialWorkerComposerHidden,
  resolveInitialWorkerOrchestrationNoticesHidden,
  shouldMarkThreadVisitedForCompletedTurn,
  threadHasHydratedHistory,
  threadHasStarted,
  threadIsHydratingHistory,
  waitForStartedServerThread,
} from "./ChatView.logic";

describe("resolveInitialWorkerComposerHidden", () => {
  it("hides worker composer by default when orchestration mode is enabled", () => {
    expect(
      resolveInitialWorkerComposerHidden({
        orchestrationModeEnabled: true,
        spawnRole: "worker",
        workerChatViewVisibility: "always_hide",
      }),
    ).toBe(true);
  });

  it("keeps worker composer visible when configured to always show", () => {
    expect(
      resolveInitialWorkerComposerHidden({
        orchestrationModeEnabled: true,
        spawnRole: "worker",
        workerChatViewVisibility: "always_show",
      }),
    ).toBe(false);
  });

  it("does not hide non-worker composer views", () => {
    expect(
      resolveInitialWorkerComposerHidden({
        orchestrationModeEnabled: true,
        spawnRole: "orchestrator",
        workerChatViewVisibility: "always_hide",
      }),
    ).toBe(false);
  });
});

describe("resolveInitialWorkerOrchestrationNoticesHidden", () => {
  it("hides worker orchestration notices by default when orchestration mode is enabled", () => {
    expect(
      resolveInitialWorkerOrchestrationNoticesHidden({
        orchestrationModeEnabled: true,
        spawnRole: "worker",
        workerOrchestrationNoticesVisibility: "always_hide",
      }),
    ).toBe(true);
  });

  it("keeps worker orchestration notices visible when configured to always show", () => {
    expect(
      resolveInitialWorkerOrchestrationNoticesHidden({
        orchestrationModeEnabled: true,
        spawnRole: "worker",
        workerOrchestrationNoticesVisibility: "always_show",
      }),
    ).toBe(false);
  });

  it("does not hide non-worker orchestration notices", () => {
    expect(
      resolveInitialWorkerOrchestrationNoticesHidden({
        orchestrationModeEnabled: true,
        spawnRole: "orchestrator",
        workerOrchestrationNoticesVisibility: "always_hide",
      }),
    ).toBe(false);
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("resolveChatHeaderBadgeLabel", () => {
  it("uses the orchestrator thread title when viewing an orchestrator thread", () => {
    expect(
      resolveChatHeaderBadgeLabel({
        activeThread: {
          title: "Planner Orchestrator",
          spawnRole: "orchestrator",
        },
        activeProjectName: "repo-name",
      }),
    ).toBe("Planner Orchestrator");
  });

  it("uses the project name for non-orchestrator threads", () => {
    expect(
      resolveChatHeaderBadgeLabel({
        activeThread: {
          title: "Worker Thread",
          spawnRole: "worker",
        },
        activeProjectName: "repo-name",
      }),
    ).toBe("repo-name");
  });

  it("falls back to the project name when there is no active thread", () => {
    expect(
      resolveChatHeaderBadgeLabel({
        activeThread: null,
        activeProjectName: "repo-name",
      }),
    ).toBe("repo-name");
  });
});

const makeThread = (input?: {
  id?: ThreadId;
  latestTurn?: {
    turnId: TurnId;
    state: "running" | "completed";
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}) => ({
  id: input?.id ?? ThreadId.makeUnsafe("thread-1"),
  codexThreadId: null,
  projectId: ProjectId.makeUnsafe("project-1"),
  title: "Thread",
  modelSelection: { provider: "codex" as const, model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: null,
  messages: [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-03-29T00:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-03-29T00:00:00.000Z",
  latestTurn: input?.latestTurn
    ? {
        ...input.latestTurn,
        assistantMessageId: null,
      }
    : null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [],
  persistedFileChanges: [],
  activities: [],
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useStore.setState((state) => ({
    ...state,
    projects: [],
    threads: [],
    bootstrapComplete: true,
  }));
});

describe("waitForStartedServerThread", () => {
  it("resolves immediately when the thread is already started", async () => {
    const threadId = ThreadId.makeUnsafe("thread-started");
    useStore.setState((state) => ({
      ...state,
      threads: [
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ],
    }));

    await expect(waitForStartedServerThread(threadId)).resolves.toBe(true);
  });

  it("waits for the thread to start via subscription updates", async () => {
    const threadId = ThreadId.makeUnsafe("thread-wait");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));

    const promise = waitForStartedServerThread(threadId, 500);

    useStore.setState((state) => ({
      ...state,
      threads: [
        makeThread({
          id: threadId,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-started"),
            state: "running",
            requestedAt: "2026-03-29T00:00:01.000Z",
            startedAt: "2026-03-29T00:00:01.000Z",
            completedAt: null,
          },
        }),
      ],
    }));

    await expect(promise).resolves.toBe(true);
  });

  it("handles the thread starting between the initial read and subscription setup", async () => {
    const threadId = ThreadId.makeUnsafe("thread-race");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));

    const originalSubscribe = useStore.subscribe.bind(useStore);
    let raced = false;
    vi.spyOn(useStore, "subscribe").mockImplementation((listener) => {
      if (!raced) {
        raced = true;
        useStore.setState((state) => ({
          ...state,
          threads: [
            makeThread({
              id: threadId,
              latestTurn: {
                turnId: TurnId.makeUnsafe("turn-race"),
                state: "running",
                requestedAt: "2026-03-29T00:00:01.000Z",
                startedAt: "2026-03-29T00:00:01.000Z",
                completedAt: null,
              },
            }),
          ],
        }));
      }
      return originalSubscribe(listener);
    });

    await expect(waitForStartedServerThread(threadId, 500)).resolves.toBe(true);
  });

  it("returns false after the timeout when the thread never starts", async () => {
    vi.useFakeTimers();

    const threadId = ThreadId.makeUnsafe("thread-timeout");
    useStore.setState((state) => ({
      ...state,
      threads: [makeThread({ id: threadId })],
    }));
    const promise = waitForStartedServerThread(threadId, 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(false);
  });
});

describe("thread history helpers", () => {
  it("treats latest-turn-only summaries as started but not fully hydrated", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-summary"),
        state: "completed",
        requestedAt: "2026-03-29T00:00:01.000Z",
        startedAt: "2026-03-29T00:00:01.000Z",
        completedAt: "2026-03-29T00:00:05.000Z",
      },
    });

    expect(threadHasStarted(thread)).toBe(true);
    expect(threadHasHydratedHistory(thread)).toBe(false);
    expect(threadIsHydratingHistory(thread)).toBe(true);
  });

  it("treats bounded snapshot coverage as hydrated history even when message arrays are empty", () => {
    const thread = {
      ...makeThread(),
      snapshotCoverage: {
        messageCount: 0,
        messageLimit: 200,
        messagesTruncated: false,
        proposedPlanCount: 0,
        proposedPlanLimit: 50,
        proposedPlansTruncated: false,
        activityCount: 0,
        activityLimit: 100,
        activitiesTruncated: false,
        checkpointCount: 0,
        checkpointLimit: 50,
        checkpointsTruncated: false,
      },
    };

    expect(threadHasHydratedHistory(thread)).toBe(true);
    expect(threadIsHydratingHistory(thread)).toBe(false);
  });

  it("does not treat zero-limit summary coverage as hydrated history", () => {
    const thread = {
      ...makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-summary"),
          state: "completed",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: "2026-03-29T00:00:05.000Z",
        },
      }),
      snapshotCoverage: {
        messageCount: 0,
        messageLimit: 0,
        messagesTruncated: false,
        proposedPlanCount: 0,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: 0,
        activityLimit: 0,
        activitiesTruncated: false,
        checkpointCount: 0,
        checkpointLimit: 0,
        checkpointsTruncated: false,
      },
    };

    expect(threadHasHydratedHistory(thread)).toBe(false);
    expect(threadIsHydratingHistory(thread)).toBe(true);
  });

  it("treats null message and activity limits as fully hydrated history", () => {
    const thread = {
      ...makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-hydrated"),
          state: "completed",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: "2026-03-29T00:00:05.000Z",
        },
      }),
      snapshotCoverage: {
        messageCount: 0,
        messageLimit: null,
        messagesTruncated: false,
        proposedPlanCount: 0,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: 0,
        activityLimit: null,
        activitiesTruncated: false,
        checkpointCount: 0,
        checkpointLimit: 0,
        checkpointsTruncated: false,
      },
    };

    expect(threadHasHydratedHistory(thread)).toBe(true);
    expect(threadIsHydratingHistory(thread)).toBe(false);
  });

  it("keeps hydrating until both message and activity detail coverage are present", () => {
    const thread = {
      ...makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-partial-coverage"),
          state: "completed",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: "2026-03-29T00:00:05.000Z",
        },
      }),
      snapshotCoverage: {
        messageCount: 3,
        messageLimit: null,
        messagesTruncated: false,
        proposedPlanCount: 0,
        proposedPlanLimit: 0,
        proposedPlansTruncated: false,
        activityCount: 0,
        activityLimit: 0,
        activitiesTruncated: false,
        checkpointCount: 0,
        checkpointLimit: 0,
        checkpointsTruncated: false,
      },
    };

    expect(threadHasHydratedHistory(thread)).toBe(false);
    expect(threadIsHydratingHistory(thread)).toBe(true);
  });

  it("marks completed turns as visited when there is no prior visit timestamp", () => {
    expect(
      shouldMarkThreadVisitedForCompletedTurn({
        latestTurnCompletedAt: "2026-03-29T00:00:05.000Z",
        lastVisitedAt: undefined,
      }),
    ).toBe(true);
  });

  it("marks completed turns as visited when the prior visit predates completion", () => {
    expect(
      shouldMarkThreadVisitedForCompletedTurn({
        latestTurnCompletedAt: "2026-03-29T00:00:05.000Z",
        lastVisitedAt: "2026-03-29T00:00:04.000Z",
      }),
    ).toBe(true);
  });

  it("does not re-mark completed turns once the visit timestamp reaches completion", () => {
    expect(
      shouldMarkThreadVisitedForCompletedTurn({
        latestTurnCompletedAt: "2026-03-29T00:00:05.000Z",
        lastVisitedAt: "2026-03-29T00:00:05.000Z",
      }),
    ).toBe(false);
  });

  it("treats future-skewed completion timestamps as needing a single completion-based visit mark", () => {
    expect(
      shouldMarkThreadVisitedForCompletedTurn({
        latestTurnCompletedAt: "2026-03-29T00:00:10.000Z",
        lastVisitedAt: "2026-03-29T00:00:06.000Z",
      }),
    ).toBe(true);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const projectId = ProjectId.makeUnsafe("project-1");
  const previousLatestTurn = {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-29T00:00:00.000Z",
    startedAt: "2026-03-29T00:00:01.000Z",
    completedAt: "2026-03-29T00:00:10.000Z",
    assistantMessageId: null,
  };

  const previousSession = {
    provider: "codex" as const,
    status: "ready" as const,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:10.000Z",
    orchestrationStatus: "idle" as const,
  };

  it("does not clear local dispatch before server state changes", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      persistedFileChanges: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: previousSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch when a new turn is already settled", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      persistedFileChanges: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.makeUnsafe("turn-2"),
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: "2026-03-29T00:01:30.000Z",
        },
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:01:30.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears local dispatch when the session changes without an observed running phase", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.makeUnsafe("thread-1"),
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      persistedFileChanges: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:00:11.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });
});
