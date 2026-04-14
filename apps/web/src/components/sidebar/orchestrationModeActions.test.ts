import { describe, expect, it, vi } from "vitest";
import { ProjectId, ThreadId, type OrchestrationThreadSummary } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import {
  buildSessionReactivationPlan,
  createNewOrchestrationSession,
  reactivateOrchestrationSession,
} from "./orchestrationModeActions";

function makeSummary(
  overrides: Partial<OrchestrationThreadSummary> &
    Pick<OrchestrationThreadSummary, "id" | "projectId">,
): OrchestrationThreadSummary {
  return {
    id: overrides.id,
    projectId: overrides.projectId,
    title: overrides.title ?? overrides.id,
    labels: overrides.labels ?? [],
    modelSelection: overrides.modelSelection ?? { provider: "codex", model: "gpt-5.4" },
    runtimeMode: overrides.runtimeMode ?? "full-access",
    interactionMode: overrides.interactionMode ?? "default",
    branch: overrides.branch ?? null,
    worktreePath: overrides.worktreePath ?? null,
    latestTurn: overrides.latestTurn ?? null,
    createdAt: overrides.createdAt ?? "2026-04-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-10T00:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    session: overrides.session ?? null,
    orchestratorProjectId: overrides.orchestratorProjectId,
    orchestratorThreadId: overrides.orchestratorThreadId,
    parentThreadId: overrides.parentThreadId,
    spawnRole: overrides.spawnRole,
    spawnedBy: overrides.spawnedBy,
    workflowId: overrides.workflowId,
  };
}

describe("buildSessionReactivationPlan", () => {
  it("does not archive or unarchive when selecting the already active root", () => {
    const rootId = ThreadId.makeUnsafe("root-1");
    const projectId = ProjectId.makeUnsafe("project-1");
    const root = makeSummary({
      id: rootId,
      projectId,
      spawnRole: "orchestrator",
    });

    const plan = buildSessionReactivationPlan({
      activeRootThreadId: rootId,
      targetRootThreadId: rootId,
      activeSessionThreads: [root],
      targetSessionThreads: [root],
      projectRootThreads: [root],
    });

    expect(plan.threadsToInterrupt).toEqual([]);
    expect(plan.threadsToStop).toEqual([]);
    expect(plan.threadsToArchive).toEqual([]);
    expect(plan.threadsToUnarchive).toEqual([]);
  });

  it("builds interrupt stop archive and unarchive order for archived targets", () => {
    const projectA = ProjectId.makeUnsafe("project-a");
    const projectB = ProjectId.makeUnsafe("project-b");
    const activeRoot = makeSummary({
      id: ThreadId.makeUnsafe("root-active"),
      projectId: projectA,
      spawnRole: "orchestrator",
    });
    const activeWorker = makeSummary({
      id: ThreadId.makeUnsafe("worker-active"),
      projectId: projectB,
      parentThreadId: activeRoot.id,
      session: {
        threadId: ThreadId.makeUnsafe("worker-active"),
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: ThreadId.makeUnsafe("turn-active") as never,
        lastError: null,
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    });
    const targetRoot = makeSummary({
      id: ThreadId.makeUnsafe("root-target"),
      projectId: projectA,
      spawnRole: "orchestrator",
      archivedAt: "2026-04-10T00:10:00.000Z",
    });
    const targetWorker = makeSummary({
      id: ThreadId.makeUnsafe("worker-target"),
      projectId: projectB,
      parentThreadId: targetRoot.id,
      archivedAt: "2026-04-10T00:10:00.000Z",
    });

    const plan = buildSessionReactivationPlan({
      activeRootThreadId: activeRoot.id,
      targetRootThreadId: targetRoot.id,
      activeSessionThreads: [activeRoot, activeWorker],
      targetSessionThreads: [targetRoot, targetWorker],
      projectRootThreads: [activeRoot, targetRoot],
    });

    expect(plan.threadsToInterrupt).toEqual([activeWorker.id]);
    expect(plan.threadsToStop).toEqual([activeWorker.id]);
    expect(plan.threadsToArchive).toEqual([activeWorker.id, activeRoot.id]);
    expect(plan.threadsToUnarchive).toEqual([targetRoot.id, targetWorker.id]);
    expect(plan.affectedProjectIds).toEqual([projectA, projectB]);
  });
});

describe("reactivateOrchestrationSession", () => {
  it("hydrates and navigates after archive and unarchive sequencing", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const activeRoot = makeSummary({
      id: ThreadId.makeUnsafe("root-active"),
      projectId,
      spawnRole: "orchestrator",
    });
    const targetRoot = makeSummary({
      id: ThreadId.makeUnsafe("root-target"),
      projectId,
      spawnRole: "orchestrator",
      archivedAt: "2026-04-10T00:10:00.000Z",
    });
    const activeWorker = makeSummary({
      id: ThreadId.makeUnsafe("worker-active"),
      projectId,
      parentThreadId: activeRoot.id,
      session: {
        threadId: ThreadId.makeUnsafe("worker-active"),
        status: "ready",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    });
    const snapshot = {
      snapshotSequence: 1,
      projects: [],
      threads: [],
      orchestratorWakeItems: [],
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 1 });
    const getCurrentState = vi.fn().mockResolvedValue(snapshot);
    const getSnapshot = vi.fn();
    const listThreadMessages = vi.fn().mockResolvedValue([]);
    const listThreadActivities = vi.fn().mockResolvedValue([]);
    const listThreadSessions = vi.fn().mockResolvedValue([]);
    const listSessionThreads = vi.fn().mockResolvedValue([]);
    const listOrchestratorWakes = vi.fn().mockResolvedValue([]);
    const confirm = vi.fn().mockResolvedValue(true);
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const fetchQuery = vi.spyOn(queryClient, "fetchQuery").mockResolvedValue([]);
    const syncServerReadModel = vi.fn();
    const navigateToThread = vi.fn().mockResolvedValue(undefined);
    await reactivateOrchestrationSession({
      api: {
        dialogs: { confirm },
        orchestration: {
          dispatchCommand,
          getCurrentState,
          getSnapshot,
          listThreadMessages,
          listThreadActivities,
          listThreadSessions,
          listSessionThreads,
          listOrchestratorWakes,
        },
      } as never,
      queryClient,
      projectId,
      activeRootThreadId: activeRoot.id,
      targetRootThreadId: targetRoot.id,
      activeSessionThreads: [activeRoot, activeWorker],
      targetSessionThreads: [targetRoot],
      projectRootThreads: [activeRoot, targetRoot],
      syncServerReadModel,
      navigateToThread,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "thread.session.stop",
      "thread.archive",
      "thread.archive",
      "thread.unarchive",
      "project.meta.update",
    ]);
    expect(getCurrentState).toHaveBeenCalledTimes(1);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(listThreadMessages).toHaveBeenCalledWith({
      threadId: targetRoot.id,
      limit: 500,
    });
    expect(syncServerReadModel).toHaveBeenCalledWith(snapshot);
    expect(invalidateQueries).toHaveBeenCalled();
    expect(fetchQuery).toHaveBeenCalled();
    expect(navigateToThread).toHaveBeenCalledWith(targetRoot.id);
  });
});

describe("createNewOrchestrationSession", () => {
  it("archives the active session family and creates a fresh orchestrator root", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const activeRoot = makeSummary({
      id: ThreadId.makeUnsafe("root-active"),
      projectId,
      spawnRole: "orchestrator",
    });
    const activeWorker = makeSummary({
      id: ThreadId.makeUnsafe("worker-active"),
      projectId,
      parentThreadId: activeRoot.id,
      session: {
        threadId: ThreadId.makeUnsafe("worker-active"),
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: ThreadId.makeUnsafe("turn-active") as never,
        lastError: null,
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    });
    const snapshot = {
      snapshotSequence: 1,
      projects: [],
      threads: [],
      orchestratorWakeItems: [],
      updatedAt: "2026-04-10T00:00:00.000Z",
    };
    const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 1 });
    const getCurrentState = vi.fn().mockResolvedValue(snapshot);
    const getSnapshot = vi.fn();
    const listThreadMessages = vi.fn().mockResolvedValue([]);
    const listThreadActivities = vi.fn().mockResolvedValue([]);
    const listThreadSessions = vi.fn().mockResolvedValue([]);
    const listSessionThreads = vi.fn().mockResolvedValue([]);
    const listOrchestratorWakes = vi.fn().mockResolvedValue([]);
    const confirm = vi.fn().mockResolvedValue(true);
    const queryClient = new QueryClient();
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const fetchQuery = vi.spyOn(queryClient, "fetchQuery").mockResolvedValue([]);
    const syncServerReadModel = vi.fn();
    const navigateToThread = vi.fn().mockResolvedValue(undefined);

    const newThreadId = await createNewOrchestrationSession({
      api: {
        dialogs: { confirm },
        orchestration: {
          dispatchCommand,
          getCurrentState,
          getSnapshot,
          listThreadMessages,
          listThreadActivities,
          listThreadSessions,
          listSessionThreads,
          listOrchestratorWakes,
        },
      } as never,
      queryClient,
      projectId,
      projectName: "Jasper",
      projectModelSelection: { provider: "codex", model: "gpt-5.4" },
      activeRootThreadId: activeRoot.id,
      activeSessionThreads: [activeRoot, activeWorker],
      syncServerReadModel,
      navigateToThread,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dispatchCommand.mock.calls.map(([command]) => command.type)).toEqual([
      "thread.turn.interrupt",
      "thread.session.stop",
      "thread.archive",
      "thread.archive",
      "thread.create",
      "project.meta.update",
    ]);
    expect(dispatchCommand.mock.calls[4]?.[0]).toMatchObject({
      type: "thread.create",
      projectId,
      title: "New Jasper Session",
      spawnRole: "orchestrator",
    });
    expect(dispatchCommand.mock.calls[5]?.[0]).toMatchObject({
      type: "project.meta.update",
      projectId,
      currentSessionRootThreadId: newThreadId,
    });
    expect(getCurrentState).toHaveBeenCalledTimes(1);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(listThreadMessages).toHaveBeenCalledWith({
      threadId: newThreadId,
      limit: 500,
    });
    expect(syncServerReadModel).toHaveBeenCalledWith(snapshot);
    expect(invalidateQueries).toHaveBeenCalled();
    expect(fetchQuery).toHaveBeenCalled();
    expect(navigateToThread).toHaveBeenCalledWith(newThreadId);
  });
});
