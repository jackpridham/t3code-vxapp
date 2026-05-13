import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dispatchNotification, getState } = vi.hoisted(() => ({
  dispatchNotification: vi.fn(),
  getState: vi.fn(),
}));

vi.mock("./notificationDispatch", () => ({
  dispatchNotification,
}));

vi.mock("./store", () => ({
  useStore: { getState },
}));

import {
  deriveOrchestrationBatchEffects,
  processEventNotifications,
} from "./orchestrationEventEffects";

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {},
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1;
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.makeUnsafe("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("deriveOrchestrationBatchEffects", () => {
  beforeEach(() => {
    dispatchNotification.mockReset();
    getState.mockReset();
    getState.mockReturnValue({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
        },
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          labels: ["urgent"],
        },
      ],
    });
  });

  it("targets draft promotion and terminal cleanup from thread lifecycle events", () => {
    const createdThreadId = ThreadId.makeUnsafe("thread-created");
    const deletedThreadId = ThreadId.makeUnsafe("thread-deleted");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.created", {
        threadId: createdThreadId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Created thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
      }),
      makeEvent("thread.deleted", {
        threadId: deletedThreadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
    ]);

    expect(effects.clearPromotedDraftThreadIds).toEqual([createdThreadId]);
    expect(effects.clearDeletedThreadIds).toEqual([deletedThreadId]);
    expect(effects.removeTerminalStateThreadIds).toEqual([deletedThreadId]);
    expect(effects.needsProviderInvalidation).toBe(false);
  });

  it("keeps only the final lifecycle outcome for a thread within one batch", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    const effects = deriveOrchestrationBatchEffects([
      makeEvent("thread.deleted", {
        threadId,
        deletedAt: "2026-02-27T00:00:01.000Z",
      }),
      makeEvent("thread.created", {
        threadId,
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Recreated thread",
        labels: [],
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-02-27T00:00:02.000Z",
        updatedAt: "2026-02-27T00:00:02.000Z",
      }),
      makeEvent("thread.turn-diff-completed", {
        threadId,
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        completedAt: "2026-02-27T00:00:03.000Z",
      }),
    ]);

    expect(effects.clearPromotedDraftThreadIds).toEqual([threadId]);
    expect(effects.clearDeletedThreadIds).toEqual([]);
    expect(effects.removeTerminalStateThreadIds).toEqual([]);
    expect(effects.needsProviderInvalidation).toBe(true);
  });
});

describe("processEventNotifications", () => {
  beforeEach(() => {
    dispatchNotification.mockReset();
    getState.mockReset();
    getState.mockReturnValue({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
        },
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          labels: ["urgent"],
        },
      ],
    });
  });

  it("fires a completion toast from terminal session lifecycle", () => {
    getState.mockReturnValue({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
        },
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          labels: ["urgent"],
          hasActiveError: false,
          activeError: null,
          historicalError: null,
          errorPresentationSource: "none",
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-1"),
            state: "completed",
            requestedAt: "2026-02-27T00:00:00.000Z",
            startedAt: "2026-02-27T00:00:01.000Z",
            completedAt: "2026-02-27T00:00:03.000Z",
            assistantMessageId: MessageId.makeUnsafe("assistant-1"),
          },
        },
      ],
    });

    processEventNotifications([
      makeEvent("thread.session-set", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:03.000Z",
        },
        hasActiveError: false,
        activeError: null,
        historicalError: null,
        errorPresentationSource: "none",
      }),
    ]);

    expect(dispatchNotification).toHaveBeenCalledWith(
      "turn-completed",
      "info",
      "Turn Completed",
      undefined,
      {
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectName: "Project 1",
        labels: ["urgent"],
        occurredAt: "2026-02-27T00:00:03.000Z",
      },
    );
  });

  it("does not fire completion notifications for checkpoint-only events", () => {
    processEventNotifications([
      makeEvent("thread.turn-checkpoint-recorded", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint-1"),
        status: "ready",
        files: [],
        assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        completedAt: "2026-02-27T00:00:03.000Z",
      }),
    ]);

    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it("fires a hook failure toast for error hook activities", () => {
    processEventNotifications([
      makeEvent("thread.activity-appended", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        activity: {
          id: EventId.makeUnsafe("activity-1"),
          kind: "hook.post-turn",
          summary: "Post-turn hook failed",
          tone: "error",
          payload: {},
          turnId: null,
          createdAt: "2026-02-27T00:00:03.000Z",
        },
      }),
    ]);

    expect(dispatchNotification).toHaveBeenCalledWith(
      "hook-failure",
      "error",
      "Hook failed",
      undefined,
      {
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectName: "Project 1",
        labels: ["urgent"],
        occurredAt: "2026-02-27T00:00:03.000Z",
        detail: "Post-turn hook failed",
      },
    );
  });

  it("does not fire a rate-limit toast for archived thread residue", () => {
    getState.mockReturnValue({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
        },
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          labels: ["urgent"],
          archivedAt: "2026-05-13T10:10:00.000Z",
          hasActiveError: false,
          activeError: null,
          historicalError: "Selected model is at capacity. Please try a different model.",
          errorPresentationSource: "historical_session_last_error",
        },
      ],
    });

    processEventNotifications([
      makeEvent("thread.session-set", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "error",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Selected model is at capacity. Please try a different model.",
          updatedAt: "2026-05-13T10:10:00.000Z",
        },
        hasActiveError: false,
        activeError: null,
        historicalError: "Selected model is at capacity. Please try a different model.",
        errorPresentationSource: "historical_session_last_error",
      }),
    ]);

    expect(dispatchNotification).not.toHaveBeenCalledWith(
      "thread-rate-limited",
      "warning",
      "Rate Limited",
      undefined,
      expect.objectContaining({
        threadId: ThreadId.makeUnsafe("thread-1"),
        detail: "Selected model is at capacity. Please try a different model.",
      }),
    );
  });

  it("fires a rate-limit toast for an active failed thread when the backend marks it active", () => {
    getState.mockReturnValue({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
        },
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          labels: ["urgent"],
          archivedAt: null,
          hasActiveError: true,
          activeError: "Selected model is at capacity. Please try a different model.",
          historicalError: null,
          errorPresentationSource: "active_session_last_error",
        },
      ],
    });

    processEventNotifications([
      makeEvent("thread.session-set", {
        threadId: ThreadId.makeUnsafe("thread-1"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "error",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Selected model is at capacity. Please try a different model.",
          updatedAt: "2026-05-13T10:10:00.000Z",
        },
        hasActiveError: true,
        activeError: "Selected model is at capacity. Please try a different model.",
        historicalError: null,
        errorPresentationSource: "active_session_last_error",
      }),
    ]);

    expect(dispatchNotification).toHaveBeenCalledWith(
      "thread-rate-limited",
      "warning",
      "Rate Limited",
      undefined,
      expect.objectContaining({
        threadId: ThreadId.makeUnsafe("thread-1"),
        detail: "Selected model is at capacity. Please try a different model.",
      }),
    );
  });
});
