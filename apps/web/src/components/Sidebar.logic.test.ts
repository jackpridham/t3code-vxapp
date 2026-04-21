import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCopyThreadIdErrorDescription,
  buildSidebarCtoAttentionGroups,
  buildSidebarProgramNotificationGroups,
  createThreadJumpHintVisibilityController,
  filterThreadsByLabels,
  getVisibleSidebarThreadIds,
  resolveAdjacentThreadId,
  resolveCurrentOrchestrationSessionRootId,
  getFallbackThreadIdAfterDelete,
  getVisibleThreadsForProject,
  getProjectSortTimestamp,
  groupThreadsByLineage,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  orderItemsByPreferredIds,
  partitionProjectsForSidebar,
  resolveProjectStatusIndicator,
  getSidebarThreadLabels,
  getSidebarCtoAttentionKindLabel,
  getSidebarProgramNotificationKindLabel,
  getUniqueLabelsFromThreads,
  resolveSidebarProjectKind,
  resolveSidebarNewThreadEnvMode,
  resolveLatestActiveThreadForProject,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  resolveSelectedOrchestrationSessionRootId,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  threadHasLineage,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from "./Sidebar.logic";
import {
  OrchestrationLatestTurn,
  CtoAttentionId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type CtoAttentionItem,
  type Program,
  type ProgramNotification,
  type Project,
  type Thread,
} from "../types";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("createThreadJumpHintVisibilityController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing jump hints until the configured delay elapses", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1);

    expect(visibilityChanges).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(visibilityChanges).toEqual([true]);
  });

  it("hides immediately when the modifiers are released", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    controller.sync(false);

    expect(visibilityChanges).toEqual([true, false]);
  });

  it("cancels a pending reveal when the modifier is released early", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2));
    controller.sync(false);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);

    expect(visibilityChanges).toEqual([]);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("buildCopyThreadIdErrorDescription", () => {
  it("includes the actual thread id alongside the clipboard error", () => {
    expect(
      buildCopyThreadIdErrorDescription({
        threadId: ThreadId.makeUnsafe("thread-copy-1"),
        errorMessage: "Clipboard API unavailable.",
      }),
    ).toBe("Clipboard API unavailable.\nThread ID: thread-copy-1");
  });

  it("falls back to only the thread id when the error message is empty", () => {
    expect(
      buildCopyThreadIdErrorDescription({
        threadId: ThreadId.makeUnsafe("thread-copy-2"),
        errorMessage: "   ",
      }),
    ).toBe("Thread ID: thread-copy-2");
  });
});

describe("buildSidebarProgramNotificationGroups", () => {
  it("groups passive notifications by program, skips actionable attention, and orders urgent work first", () => {
    const programAlphaId = ProgramId.makeUnsafe("program-alpha");
    const programBetaId = ProgramId.makeUnsafe("program-beta");
    const groups = buildSidebarProgramNotificationGroups({
      programs: [
        makeProgram({ id: programAlphaId, title: "Alpha launch" }),
        makeProgram({ id: programBetaId, title: "Beta cleanup" }),
      ],
      notifications: [
        makeProgramNotification({
          notificationId: ProgramNotificationId.makeUnsafe("notification-info"),
          programId: programAlphaId,
          kind: "status_update",
          severity: "info",
          summary: "Alpha status update",
          queuedAt: "2026-04-20T00:01:00.000Z",
        }),
        makeProgramNotification({
          notificationId: ProgramNotificationId.makeUnsafe("notification-critical"),
          programId: programBetaId,
          kind: "worker_progress",
          severity: "warning",
          summary: "Beta progress update",
          queuedAt: "2026-04-20T00:00:00.000Z",
        }),
        makeProgramNotification({
          notificationId: ProgramNotificationId.makeUnsafe("notification-actionable"),
          programId: programAlphaId,
          kind: "decision_required",
          severity: "warning",
          summary: "Alpha requires a decision",
          queuedAt: "2026-04-20T00:02:00.000Z",
        }),
        makeProgramNotification({
          notificationId: ProgramNotificationId.makeUnsafe("notification-consumed"),
          programId: programBetaId,
          state: "consumed",
          summary: "Already handled",
        }),
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.programTitle).toBe("Beta cleanup");
    expect(groups[0]?.warningCount).toBe(1);
    expect(groups[0]?.notifications.map((notification) => notification.summary)).toEqual([
      "Beta progress update",
    ]);
    expect(groups[1]?.programTitle).toBe("Alpha launch");
    expect(groups[1]?.notifications.map((notification) => notification.summary)).toEqual([
      "Alpha status update",
    ]);
    expect(
      groups.flatMap((group) => group.notifications.map((notification) => notification.kind)),
    ).toEqual(["worker_progress", "status_update"]);
  });

  it("renders human labels for notification kinds", () => {
    expect(getSidebarProgramNotificationKindLabel("decision_required")).toBe("Decision");
    expect(getSidebarProgramNotificationKindLabel("risk_escalated")).toBe("Risk");
    expect(getSidebarProgramNotificationKindLabel("worker_completed")).toBe("Worker completed");
    expect(getSidebarCtoAttentionKindLabel("final_review_ready")).toBe("Final review");
  });
});

describe("buildSidebarCtoAttentionGroups", () => {
  it("groups required CTO attention by program and skips non-required states", () => {
    const programAlphaId = ProgramId.makeUnsafe("program-alpha");
    const programBetaId = ProgramId.makeUnsafe("program-beta");
    const groups = buildSidebarCtoAttentionGroups({
      programs: [
        makeProgram({ id: programAlphaId, title: "Alpha launch" }),
        makeProgram({ id: programBetaId, title: "Beta cleanup" }),
      ],
      ctoAttentionItems: [
        makeCtoAttentionItem({
          attentionId: "attention-alpha-1" as never,
          programId: programAlphaId,
          summary: "Alpha needs a decision",
          queuedAt: "2026-04-20T00:02:00.000Z",
        }),
        makeCtoAttentionItem({
          attentionId: "attention-alpha-2" as never,
          programId: programAlphaId,
          state: "acknowledged",
          summary: "Already acknowledged",
        }),
        makeCtoAttentionItem({
          attentionId: "attention-beta-1" as never,
          programId: programBetaId,
          summary: "Beta is blocked",
          queuedAt: "2026-04-20T00:01:00.000Z",
        }),
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.programTitle).toBe("Alpha launch");
    expect(groups[0]?.attentionItems).toHaveLength(1);
    expect(groups[0]?.attentionItems[0]?.state).toBe("required");
    expect(groups[1]?.programTitle).toBe("Beta cleanup");
    expect(groups[1]?.attentionItems[0]?.summary).toBe("Beta is blocked");
  });
});

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: ProgramId.makeUnsafe("program-1"),
    title: "Program",
    objective: null,
    status: "active",
    executiveProjectId: ProjectId.makeUnsafe("executive-project-1"),
    executiveThreadId: ThreadId.makeUnsafe("executive-thread-1"),
    currentOrchestratorThreadId: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeProgramNotification(
  overrides: Partial<ProgramNotification> = {},
): ProgramNotification {
  return {
    notificationId: ProgramNotificationId.makeUnsafe("notification-1"),
    programId: ProgramId.makeUnsafe("program-1"),
    executiveProjectId: ProjectId.makeUnsafe("executive-project-1"),
    executiveThreadId: ThreadId.makeUnsafe("executive-thread-1"),
    orchestratorThreadId: ThreadId.makeUnsafe("orchestrator-thread-1"),
    kind: "decision_required",
    severity: "warning",
    summary: "Decision required",
    evidence: {},
    state: "pending",
    queuedAt: "2026-04-20T00:00:00.000Z",
    deliveredAt: null,
    consumedAt: null,
    droppedAt: null,
    consumeReason: undefined,
    dropReason: undefined,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function makeCtoAttentionItem(overrides: Partial<CtoAttentionItem> = {}): CtoAttentionItem {
  return {
    attentionId: CtoAttentionId.makeUnsafe("attention-1"),
    attentionKey:
      "program:program-1|kind:blocked|source-thread:thread-worker|source-role:worker|correlation:notif-1",
    notificationId: ProgramNotificationId.makeUnsafe("notification-1"),
    programId: ProgramId.makeUnsafe("program-1"),
    executiveProjectId: ProjectId.makeUnsafe("executive-project-1"),
    executiveThreadId: ThreadId.makeUnsafe("executive-thread-1"),
    sourceThreadId: ThreadId.makeUnsafe("thread-worker"),
    sourceRole: "worker",
    kind: "blocked",
    severity: "critical",
    summary: "Blocked",
    evidence: {},
    state: "required",
    queuedAt: "2026-04-20T00:00:00.000Z",
    acknowledgedAt: null,
    resolvedAt: null,
    droppedAt: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveSidebarProjectKind", () => {
  it("prefers the persisted project kind when present", () => {
    expect(
      resolveSidebarProjectKind({
        project: makeProject({ kind: "orchestrator" }),
      }),
    ).toBe("orchestrator");

    expect(
      resolveSidebarProjectKind({
        project: makeProject({ kind: "executive" }),
      }),
    ).toBe("executive");
  });

  it("falls back to remembered orchestrator cwd state", () => {
    expect(
      resolveSidebarProjectKind({
        project: makeProject({ kind: undefined, cwd: "/home/gizmo/agents-vxapp/Jasper" }),
        orchestratorProjectCwds: ["/home/gizmo/agents-vxapp/Jasper"],
      }),
    ).toBe("orchestrator");
  });

  it("falls back to executive kind for CTO workspaces", () => {
    expect(
      resolveSidebarProjectKind({
        project: makeProject({
          kind: undefined,
          name: "CTO",
          cwd: "/home/gizmo/agents-vxapp/CTO",
        }),
      }),
    ).toBe("executive");
  });
});

describe("resolveCurrentOrchestrationSessionRootId", () => {
  it("prefers the persisted current session root when it is still active", () => {
    expect(
      resolveCurrentOrchestrationSessionRootId({
        storedCurrentSessionRootId: ThreadId.makeUnsafe("root-stored"),
        projectRootThreads: [
          makeThread({
            id: ThreadId.makeUnsafe("root-stored"),
            spawnRole: "orchestrator",
            archivedAt: null,
            updatedAt: "2026-04-10T10:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.makeUnsafe("root-other"),
            spawnRole: "orchestrator",
            archivedAt: null,
            updatedAt: "2026-04-10T09:00:00.000Z",
          }),
        ],
      }),
    ).toBe("root-stored");
  });

  it("falls back to the latest active root when the persisted root is archived", () => {
    expect(
      resolveCurrentOrchestrationSessionRootId({
        storedCurrentSessionRootId: ThreadId.makeUnsafe("root-archived"),
        projectRootThreads: [
          makeThread({
            id: ThreadId.makeUnsafe("root-archived"),
            spawnRole: "orchestrator",
            archivedAt: "2026-04-10T11:00:00.000Z",
            updatedAt: "2026-04-10T11:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.makeUnsafe("root-current"),
            spawnRole: "orchestrator",
            archivedAt: null,
            updatedAt: "2026-04-10T12:00:00.000Z",
          }),
        ],
      }),
    ).toBe("root-current");
  });
});

describe("resolveSelectedOrchestrationSessionRootId", () => {
  it("still lets the current route temporarily select a matching orchestration root", () => {
    const projectRootThreads = [
      makeThread({
        id: ThreadId.makeUnsafe("root-current"),
        spawnRole: "orchestrator",
        archivedAt: null,
        workflowId: "wf-current",
      }),
      makeThread({
        id: ThreadId.makeUnsafe("root-old"),
        spawnRole: "orchestrator",
        archivedAt: "2026-04-10T12:00:00.000Z",
        workflowId: "wf-old",
      }),
    ];

    expect(
      resolveSelectedOrchestrationSessionRootId({
        routeThreadId: ThreadId.makeUnsafe("worker-old"),
        storedSelectedSessionRootId: ThreadId.makeUnsafe("root-current"),
        projectRootThreads,
        threadsForResolution: [
          ...projectRootThreads,
          makeThread({
            id: ThreadId.makeUnsafe("worker-old"),
            spawnRole: "worker",
            orchestratorThreadId: ThreadId.makeUnsafe("root-old"),
            parentThreadId: ThreadId.makeUnsafe("root-old"),
            workflowId: "wf-old",
          }),
        ],
      }),
    ).toBe("root-old");
  });
});

describe("partitionProjectsForSidebar", () => {
  it("splits executive, orchestrator, and regular projects while preserving relative order", () => {
    const cto = makeProject({
      id: ProjectId.makeUnsafe("project-cto"),
      name: "CTO",
      cwd: "/home/gizmo/agents-vxapp/CTO",
      kind: "executive",
    });
    const jasper = makeProject({
      id: ProjectId.makeUnsafe("project-jasper"),
      name: "Jasper",
      cwd: "/home/gizmo/agents-vxapp/Jasper",
      kind: "orchestrator",
    });
    const app = makeProject({
      id: ProjectId.makeUnsafe("project-app"),
      name: "t3code-vxapp",
      cwd: "/home/gizmo/t3code-vxapp",
    });
    const docs = makeProject({
      id: ProjectId.makeUnsafe("project-docs"),
      name: "Docs",
      cwd: "/home/gizmo/docs",
    });

    const result = partitionProjectsForSidebar({
      projects: [app, cto, jasper, docs],
    });

    expect(result.executiveProjects.map((project) => project.id)).toEqual([cto.id]);
    expect(result.orchestratorProjects.map((project) => project.id)).toEqual([jasper.id]);
    expect(result.regularProjects.map((project) => project.id)).toEqual([app.id, docs.id]);
  });
});

describe("orderItemsByPreferredIds", () => {
  it("keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.makeUnsafe("project-1"), name: "One" },
        { id: ProjectId.makeUnsafe("project-2"), name: "Two" },
        { id: ProjectId.makeUnsafe("project-3"), name: "Three" },
      ],
      preferredIds: [
        ProjectId.makeUnsafe("project-3"),
        ProjectId.makeUnsafe("project-missing"),
        ProjectId.makeUnsafe("project-1"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-3"),
      ProjectId.makeUnsafe("project-1"),
      ProjectId.makeUnsafe("project-2"),
    ]);
  });

  it("does not duplicate items when preferred ids repeat", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.makeUnsafe("project-1"), name: "One" },
        { id: ProjectId.makeUnsafe("project-2"), name: "Two" },
      ],
      preferredIds: [
        ProjectId.makeUnsafe("project-2"),
        ProjectId.makeUnsafe("project-1"),
        ProjectId.makeUnsafe("project-2"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });
});

describe("resolveAdjacentThreadId", () => {
  it("resolves adjacent thread ids in ordered sidebar traversal", () => {
    const threads = [
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
    ];

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "previous",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "next",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "previous",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("resolveLatestActiveThreadForProject", () => {
  it("prefers the thread with a live session over newer idle threads", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const liveThread = makeThread({
      id: ThreadId.makeUnsafe("thread-live"),
      projectId,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:01:00.000Z",
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:01:00.000Z",
      },
    });
    const newerIdleThread = makeThread({
      id: ThreadId.makeUnsafe("thread-idle"),
      projectId,
      createdAt: "2026-03-09T11:00:00.000Z",
      updatedAt: "2026-03-09T11:01:00.000Z",
    });

    expect(
      resolveLatestActiveThreadForProject({
        projectId,
        threads: [newerIdleThread, liveThread],
        sortOrder: "updated_at",
      })?.id,
    ).toBe(liveThread.id);
  });

  it("falls back to the pending-turn thread when no session is live", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const pendingThread = makeThread({
      id: ThreadId.makeUnsafe("thread-pending"),
      projectId,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:05:00.000Z",
      latestTurn: makeLatestTurn({ completedAt: null }),
    });
    const olderIdleThread = makeThread({
      id: ThreadId.makeUnsafe("thread-idle"),
      projectId,
      createdAt: "2026-03-09T09:00:00.000Z",
      updatedAt: "2026-03-09T09:05:00.000Z",
    });

    expect(
      resolveLatestActiveThreadForProject({
        projectId,
        threads: [olderIdleThread, pendingThread],
        sortOrder: "updated_at",
      })?.id,
    ).toBe(pendingThread.id);
  });

  it("ignores archived and deleted threads when resolving the active thread", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const archivedThread = {
      ...makeThread({
        id: ThreadId.makeUnsafe("thread-archived"),
        projectId,
        updatedAt: "2026-03-09T12:00:00.000Z",
      }),
      archivedAt: "2026-03-09T12:30:00.000Z",
    };
    const deletedThread = {
      ...makeThread({
        id: ThreadId.makeUnsafe("thread-deleted"),
        projectId,
        updatedAt: "2026-03-09T12:20:00.000Z",
      }),
      deletedAt: "2026-03-09T12:40:00.000Z",
    };
    const activeThread = makeThread({
      id: ThreadId.makeUnsafe("thread-active"),
      projectId,
      updatedAt: "2026-03-09T11:00:00.000Z",
    });

    expect(
      resolveLatestActiveThreadForProject({
        projectId,
        threads: [archivedThread, deletedThread, activeThread],
        sortOrder: "updated_at",
      })?.id,
    ).toBe(activeThread.id);
  });
});

describe("getVisibleSidebarThreadIds", () => {
  it("returns only the rendered visible thread order across projects", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          renderedThreads: [
            { id: ThreadId.makeUnsafe("thread-12") },
            { id: ThreadId.makeUnsafe("thread-11") },
            { id: ThreadId.makeUnsafe("thread-10") },
          ],
        },
        {
          renderedThreads: [
            { id: ThreadId.makeUnsafe("thread-8") },
            { id: ThreadId.makeUnsafe("thread-6") },
          ],
        },
      ]),
    ).toEqual([
      ThreadId.makeUnsafe("thread-12"),
      ThreadId.makeUnsafe("thread-11"),
      ThreadId.makeUnsafe("thread-10"),
      ThreadId.makeUnsafe("thread-8"),
      ThreadId.makeUnsafe("thread-6"),
    ]);
  });

  it("skips threads from collapsed projects whose thread panels are not shown", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          shouldShowThreadPanel: false,
          renderedThreads: [
            { id: ThreadId.makeUnsafe("thread-hidden-2") },
            { id: ThreadId.makeUnsafe("thread-hidden-1") },
          ],
        },
        {
          shouldShowThreadPanel: true,
          renderedThreads: [
            { id: ThreadId.makeUnsafe("thread-12") },
            { id: ThreadId.makeUnsafe("thread-11") },
          ],
        },
      ]),
    ).toEqual([ThreadId.makeUnsafe("thread-12"), ThreadId.makeUnsafe("thread-11")]);
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: "2026-03-09T10:06:00.000Z",
              implementationThreadId: "thread-implement" as never,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});

describe("getVisibleThreadsForProject", () => {
  it("includes the active thread even when it falls below the folded preview", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index + 1}`),
        title: `Thread ${index + 1}`,
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.makeUnsafe("thread-8"),
      allowActiveThreadsInFold: false,
      isThreadListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
      ThreadId.makeUnsafe("thread-5"),
      ThreadId.makeUnsafe("thread-6"),
      ThreadId.makeUnsafe("thread-8"),
    ]);
    expect(result.hiddenThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-7"),
    ]);
  });

  it("returns all threads when the list is expanded", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index + 1}`),
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.makeUnsafe("thread-8"),
      allowActiveThreadsInFold: false,
      isThreadListExpanded: true,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual(
      threads.map((thread) => thread.id),
    );
    expect(result.hiddenThreads).toEqual([]);
  });

  it("keeps running and connecting threads visible when enabled", () => {
    const threads = [
      makeThread({ id: ThreadId.makeUnsafe("thread-1") }),
      makeThread({ id: ThreadId.makeUnsafe("thread-2") }),
      makeThread({ id: ThreadId.makeUnsafe("thread-3") }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-4"),
        session: {
          provider: "codex",
          status: "running",
          activeTurnId: "turn-4" as never,
          createdAt: "2026-03-09T10:03:00.000Z",
          updatedAt: "2026-03-09T10:03:00.000Z",
          orchestrationStatus: "running",
        },
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-5"),
        session: {
          provider: "codex",
          status: "connecting",
          createdAt: "2026-03-09T10:04:00.000Z",
          updatedAt: "2026-03-09T10:04:00.000Z",
          orchestrationStatus: "starting",
        },
      }),
      makeThread({ id: ThreadId.makeUnsafe("thread-6") }),
    ];

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: undefined,
      allowActiveThreadsInFold: true,
      isThreadListExpanded: false,
      previewLimit: 3,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-4"),
      ThreadId.makeUnsafe("thread-5"),
    ]);
    expect(result.hiddenThreads.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-6"),
    ]);
  });

  it("shows all threads when every folded thread is active", () => {
    const threads = [
      makeThread({ id: ThreadId.makeUnsafe("thread-1") }),
      makeThread({ id: ThreadId.makeUnsafe("thread-2") }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        session: {
          provider: "codex",
          status: "running",
          activeTurnId: "turn-3" as never,
          createdAt: "2026-03-09T10:03:00.000Z",
          updatedAt: "2026-03-09T10:03:00.000Z",
          orchestrationStatus: "running",
        },
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-4"),
        session: {
          provider: "codex",
          status: "connecting",
          createdAt: "2026-03-09T10:04:00.000Z",
          updatedAt: "2026-03-09T10:04:00.000Z",
          orchestrationStatus: "starting",
        },
      }),
    ];

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: undefined,
      allowActiveThreadsInFold: true,
      isThreadListExpanded: false,
      previewLimit: 2,
    });

    expect(result.hasHiddenThreads).toBe(false);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual(
      threads.map((thread) => thread.id),
    );
    expect(result.hiddenThreads).toEqual([]);
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides;
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    hooks: [],
    ...rest,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    labels: [],
    modelSelection: {
      provider: "codex",
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    persistedFileChanges: [],
    activities: [],
    ...overrides,
  };
}

describe("getSidebarThreadLabels", () => {
  it("normalizes labels and limits the sidebar preview", () => {
    expect(getSidebarThreadLabels(["  alpha ", "", "beta", "alpha", "gamma", "delta"], 2)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("uses the default preview limit when one is not provided", () => {
    expect(getSidebarThreadLabels(["alpha", "beta", "gamma"])).toEqual(["alpha", "beta"]);
  });

  it("preserves first-seen order after trimming and deduping labels", () => {
    expect(getSidebarThreadLabels(["  beta", "alpha  ", "beta", "alpha", "gamma"], 3)).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("returns all unique trimmed labels when under the preview limit", () => {
    expect(getSidebarThreadLabels([" worker ", "model:gpt-5.4", "worker"], 5)).toEqual([
      "worker",
      "gpt-5.4",
    ]);
  });

  it("hides provider labels from the sidebar preview", () => {
    expect(getSidebarThreadLabels(["provider:codex", "worker", "provider:claudeAgent"], 5)).toEqual(
      ["worker"],
    );
  });

  it("returns an empty array for missing labels", () => {
    expect(getSidebarThreadLabels(undefined)).toEqual([]);
    expect(getSidebarThreadLabels(null)).toEqual([]);
  });
});

describe("filterThreadsByLabels", () => {
  it("returns a shallow copy of all threads when no labels are selected", () => {
    const threads = [
      makeThread({ id: ThreadId.makeUnsafe("thread-1"), labels: ["worker"] }),
      makeThread({ id: ThreadId.makeUnsafe("thread-2"), labels: ["review"] }),
    ];

    const filtered = filterThreadsByLabels(threads, []);

    expect(filtered).toEqual(threads);
    expect(filtered).not.toBe(threads);
  });

  it("filters threads by a single selected label", () => {
    const filtered = filterThreadsByLabels(
      [
        makeThread({ id: ThreadId.makeUnsafe("thread-1"), labels: ["worker", "model:gpt-5.4"] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2"), labels: ["model:gpt-5.4"] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-3"), labels: ["worker"] }),
      ],
      ["worker"],
    );

    expect(filtered.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-3"),
    ]);
  });

  it("requires threads to include every selected label", () => {
    const filtered = filterThreadsByLabels(
      [
        makeThread({ id: ThreadId.makeUnsafe("thread-1"), labels: ["worker", "model:gpt-5.4"] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2"), labels: ["worker"] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-3"), labels: ["model:gpt-5.4"] }),
      ],
      ["worker", "model:gpt-5.4"],
    );

    expect(filtered.map((thread) => thread.id)).toEqual([ThreadId.makeUnsafe("thread-1")]);
  });

  it("excludes threads without labels when filters are active", () => {
    const filtered = filterThreadsByLabels(
      [
        makeThread({ id: ThreadId.makeUnsafe("thread-1"), labels: undefined }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2"), labels: [] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-3"), labels: ["worker"] }),
      ],
      ["worker"],
    );

    expect(filtered.map((thread) => thread.id)).toEqual([ThreadId.makeUnsafe("thread-3")]);
  });

  it("matches selected labels exactly rather than trimming source labels during filtering", () => {
    const filtered = filterThreadsByLabels(
      [
        makeThread({ id: ThreadId.makeUnsafe("thread-1"), labels: [" worker "] }),
        makeThread({ id: ThreadId.makeUnsafe("thread-2"), labels: ["worker"] }),
      ],
      ["worker"],
    );

    expect(filtered.map((thread) => thread.id)).toEqual([ThreadId.makeUnsafe("thread-2")]);
  });
});

describe("getUniqueLabelsFromThreads", () => {
  it("trims, dedupes, and sorts labels across threads", () => {
    expect(
      getUniqueLabelsFromThreads([
        makeThread({ labels: [" worker ", "model:gpt-5.4"] }),
        makeThread({ labels: ["review", "worker", ""] }),
        makeThread({ labels: ["  model:gpt-5.4  ", "alpha"] }),
      ]),
    ).toEqual(["alpha", "model:gpt-5.4", "review", "worker"]);
  });

  it("ignores missing and empty label arrays", () => {
    expect(
      getUniqueLabelsFromThreads([
        makeThread({ labels: undefined }),
        makeThread({ labels: [] }),
        makeThread({ labels: ["   "] }),
      ]),
    ).toEqual([]);
  });
});

describe("sortThreadsForSidebar", () => {
  it("sorts threads by the latest user message in recency mode", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
          messages: [
            {
              id: "message-1" as never,
              role: "user",
              text: "older",
              createdAt: "2026-03-09T10:01:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:01:00.000Z",
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          messages: [
            {
              id: "message-2" as never,
              role: "user",
              text: "newer",
              createdAt: "2026-03-09T10:06:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:06:00.000Z",
            },
          ],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("falls back to thread timestamps when there is no user message", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:01:00.000Z",
          messages: [
            {
              id: "message-1" as never,
              role: "assistant",
              text: "assistant only",
              createdAt: "2026-03-09T10:02:00.000Z",
              streaming: false,
              completedAt: "2026-03-09T10:02:00.000Z",
            },
          ],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("falls back to id ordering when threads have no sortable timestamps", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "" as never,
          updatedAt: undefined,
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "" as never,
          updatedAt: undefined,
          messages: [],
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("can sort threads by createdAt when configured", () => {
    const sorted = sortThreadsForSidebar(
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:10:00.000Z",
        }),
      ],
      "created_at",
    );

    expect(sorted.map((thread) => thread.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
    ]);
  });
});

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-oldest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-active"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-other-project"),
          projectId: ProjectId.makeUnsafe("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-active"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newest"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-next"),
          projectId: ProjectId.makeUnsafe("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.makeUnsafe("thread-active"),
      deletedThreadIds: new Set([
        ThreadId.makeUnsafe("thread-active"),
        ThreadId.makeUnsafe("thread-newest"),
      ]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.makeUnsafe("thread-next"));
  });
});

describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their threads", () => {
    const projects = [
      makeProject({ id: ProjectId.makeUnsafe("project-1"), name: "Older project" }),
      makeProject({ id: ProjectId.makeUnsafe("project-2"), name: "Newer project" }),
    ];
    const threads = [
      makeThread({
        projectId: ProjectId.makeUnsafe("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            createdAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:01:00.000Z",
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        projectId: ProjectId.makeUnsafe("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            createdAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
            completedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no threads", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Beta",
          createdAt: undefined,
          updatedAt: undefined,
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Alpha",
          createdAt: undefined,
          updatedAt: undefined,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-1"),
      ProjectId.makeUnsafe("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.makeUnsafe("project-2"), name: "Second" }),
      makeProject({ id: ProjectId.makeUnsafe("project-1"), name: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-2"),
      ProjectId.makeUnsafe("project-1"),
    ]);
  });

  it("ignores archived threads when sorting projects", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.makeUnsafe("project-1"),
          name: "Visible project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.makeUnsafe("project-2"),
          name: "Archived-only project",
          updatedAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      [
        makeThread({
          id: ThreadId.makeUnsafe("thread-visible"),
          projectId: ProjectId.makeUnsafe("project-1"),
          updatedAt: "2026-03-09T10:02:00.000Z",
          archivedAt: null,
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-archived"),
          projectId: ProjectId.makeUnsafe("project-2"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-09T10:11:00.000Z",
        }),
      ].filter((thread) => thread.archivedAt === null),
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.makeUnsafe("project-1"),
      ProjectId.makeUnsafe("project-2"),
    ]);
  });

  it("returns the project timestamp when no threads are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});

describe("groupThreadsByLineage", () => {
  it("groups worker threads under their parent", () => {
    const parent = makeThread({
      id: ThreadId.makeUnsafe("parent-1"),
      spawnRole: "orchestrator",
    });
    const worker1 = makeThread({
      id: ThreadId.makeUnsafe("worker-1"),
      spawnRole: "worker",
      parentThreadId: "parent-1",
      createdAt: "2026-03-09T10:02:00.000Z",
    });
    const worker2 = makeThread({
      id: ThreadId.makeUnsafe("worker-2"),
      spawnRole: "worker",
      parentThreadId: "parent-1",
      createdAt: "2026-03-09T10:01:00.000Z",
    });

    const { groups, ungrouped } = groupThreadsByLineage([parent, worker1, worker2]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.parentThreadId).toBe("parent-1");
    expect(groups[0]?.parentThread?.id).toBe(ThreadId.makeUnsafe("parent-1"));
    expect(groups[0]?.workers.map((w) => w.id)).toEqual([
      ThreadId.makeUnsafe("worker-1"),
      ThreadId.makeUnsafe("worker-2"),
    ]);
    expect(ungrouped).toHaveLength(0);
  });

  it("handles external parent (not in thread list)", () => {
    const worker = makeThread({
      id: ThreadId.makeUnsafe("worker-1"),
      spawnRole: "worker",
      parentThreadId: "external-parent",
    });

    const { groups, ungrouped } = groupThreadsByLineage([worker]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.parentThreadId).toBe("external-parent");
    expect(groups[0]?.parentThread).toBeNull();
    expect(groups[0]?.workers.map((w) => w.id)).toEqual([ThreadId.makeUnsafe("worker-1")]);
    expect(ungrouped).toHaveLength(0);
  });

  it("returns all threads as ungrouped when no lineage", () => {
    const thread1 = makeThread({ id: ThreadId.makeUnsafe("thread-1") });
    const thread2 = makeThread({ id: ThreadId.makeUnsafe("thread-2") });

    const { groups, ungrouped } = groupThreadsByLineage([thread1, thread2]);

    expect(groups).toHaveLength(0);
    expect(ungrouped.map((t) => t.id)).toEqual([
      ThreadId.makeUnsafe("thread-1"),
      ThreadId.makeUnsafe("thread-2"),
    ]);
  });

  it("sorts workers by creation time descending within group", () => {
    const parent = makeThread({ id: ThreadId.makeUnsafe("parent-1") });
    const workerOld = makeThread({
      id: ThreadId.makeUnsafe("worker-old"),
      spawnRole: "worker",
      parentThreadId: "parent-1",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const workerNew = makeThread({
      id: ThreadId.makeUnsafe("worker-new"),
      spawnRole: "worker",
      parentThreadId: "parent-1",
      createdAt: "2026-03-09T10:05:00.000Z",
    });

    const { groups } = groupThreadsByLineage([parent, workerOld, workerNew]);

    expect(groups[0]?.workers.map((w) => w.id)).toEqual([
      ThreadId.makeUnsafe("worker-new"),
      ThreadId.makeUnsafe("worker-old"),
    ]);
  });
});

describe("threadHasLineage", () => {
  it("returns true for threads with orchestratorThreadId", () => {
    const thread = makeThread({ orchestratorThreadId: "orch-1" });
    expect(threadHasLineage(thread)).toBe(true);
  });

  it("returns true for threads with spawnRole", () => {
    const thread = makeThread({ spawnRole: "worker" });
    expect(threadHasLineage(thread)).toBe(true);
  });

  it("returns false for threads with no lineage fields", () => {
    const thread = makeThread();
    expect(threadHasLineage(thread)).toBe(false);
  });
});
