import { describe, expect, it, vi } from "vitest";
import {
  EventId,
  ProjectId,
  ThreadId,
  type NativeApi,
  type OrchestrationReadModel,
} from "@t3tools/contracts";

vi.mock("../components/ui/toast", () => ({
  AnchoredToastProvider: ({ children }: { children?: unknown }) => children ?? null,
  ToastProvider: ({ children }: { children?: unknown }) => children ?? null,
  toastManager: { add: vi.fn() },
}));

vi.mock("../components/ui/button", () => ({
  Button: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("../components/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
}));

vi.mock("../components/AppSidebarLayout", () => ({
  AppSidebarLayout: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("../editorPreferences", () => ({
  resolveAndPersistPreferredEditor: vi.fn(),
}));

vi.mock("../lib/serverReactQuery", () => ({
  serverConfigQueryOptions: vi.fn(),
  serverQueryKeys: { config: () => ["config"] },
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: vi.fn(),
}));

vi.mock("../composerDraftStore", () => ({
  clearPromotedDraftThread: vi.fn(),
  clearPromotedDraftThreads: vi.fn(),
  useComposerDraftStore: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: vi.fn(),
}));

vi.mock("../uiStateStore", () => ({
  useUiStateStore: vi.fn(),
}));

vi.mock("../terminalStateStore", () => ({
  useTerminalStateStore: vi.fn(),
}));

vi.mock("../terminalActivity", () => ({
  terminalRunningSubprocessFromEvent: vi.fn(),
}));

vi.mock("../wsNativeApi", () => ({
  onServerConfigUpdated: vi.fn(),
  onServerProvidersUpdated: vi.fn(),
  onServerWelcome: vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  migrateLocalSettingsToServer: vi.fn(),
}));

vi.mock("../lib/providerReactQuery", () => ({
  providerQueryKeys: { all: ["provider"] },
}));

vi.mock("../lib/projectReactQuery", () => ({
  projectQueryKeys: { all: ["project"] },
}));

vi.mock("../lib/skillReactQuery", () => ({
  skillQueryKeys: { all: ["skill"] },
}));

vi.mock("../lib/terminalStateCleanup", () => ({
  collectActiveTerminalThreadIds: vi.fn(() => []),
}));

vi.mock("../orchestrationEventEffects", () => ({
  deriveOrchestrationBatchEffects: vi.fn(() => ({
    needsProviderInvalidation: false,
    clearPromotedDraftThreadIds: [],
    clearDeletedThreadIds: [],
    removeTerminalStateThreadIds: [],
  })),
  processEventNotifications: vi.fn(),
}));

vi.mock("../lib/sidebarWindow", () => ({
  isSidebarWindowPath: vi.fn(() => false),
}));

vi.mock("../lib/artifactWindow", () => ({
  isArtifactWindowPath: vi.fn(() => false),
}));

vi.mock("../lib/changesWindow", () => ({
  isChangesWindowPath: vi.fn(() => false),
}));

import {
  bootstrapOrchestrationState,
  collectOrchestrationInvalidationTargets,
  isStandaloneRootRoutePath,
} from "./__root";
import { createOrchestrationRecoveryCoordinator } from "../orchestrationRecovery";
import { isArtifactWindowPath } from "../lib/artifactWindow";
import { isChangesWindowPath } from "../lib/changesWindow";

function makeReadModel(snapshotSequence: number): OrchestrationReadModel {
  return {
    snapshotSequence,
    projects: [],
    threads: [],
    orchestratorWakeItems: [],
    updatedAt: "2026-04-06T00:00:00.000Z",
  };
}

describe("bootstrapOrchestrationState", () => {
  it("prefers bootstrap summary and replays when recovery requires it", async () => {
    const recovery = createOrchestrationRecoveryCoordinator();
    recovery.classifyDomainEvent(1);

    const bootstrapSummary = makeReadModel(4);
    const snapshot = makeReadModel(6);
    const getBootstrapSummary = vi.fn().mockResolvedValue(bootstrapSummary);
    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const api = {
      orchestration: {
        getBootstrapSummary,
        getSnapshot,
      },
    } as unknown as NativeApi;
    const syncServerReadModel = vi.fn();
    const reconcileSnapshotDerivedState = vi.fn();
    const recoverFromSequenceGap = vi.fn().mockResolvedValue(undefined);

    await bootstrapOrchestrationState({
      api,
      recovery,
      syncServerReadModel,
      reconcileSnapshotDerivedState,
      recoverFromSequenceGap,
      isDisposed: () => false,
    });

    expect(getBootstrapSummary).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).toHaveBeenNthCalledWith(1, bootstrapSummary);
    expect(syncServerReadModel).toHaveBeenNthCalledWith(2, snapshot);
    expect(reconcileSnapshotDerivedState).toHaveBeenCalledTimes(2);
    expect(recoverFromSequenceGap).toHaveBeenCalledTimes(1);
  });

  it("falls back to the full snapshot when the bootstrap summary fails", async () => {
    const recovery = createOrchestrationRecoveryCoordinator();

    const getBootstrapSummary = vi.fn().mockRejectedValue(new Error("summary unavailable"));
    const snapshot = makeReadModel(9);
    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    const api = {
      orchestration: {
        getBootstrapSummary,
        getSnapshot,
      },
    } as unknown as NativeApi;
    const syncServerReadModel = vi.fn();
    const reconcileSnapshotDerivedState = vi.fn();
    const recoverFromSequenceGap = vi.fn().mockResolvedValue(undefined);

    await bootstrapOrchestrationState({
      api,
      recovery,
      syncServerReadModel,
      reconcileSnapshotDerivedState,
      recoverFromSequenceGap,
      isDisposed: () => false,
    });

    expect(getBootstrapSummary).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).toHaveBeenCalledWith(snapshot);
    expect(reconcileSnapshotDerivedState).toHaveBeenCalledTimes(1);
    expect(recoverFromSequenceGap).not.toHaveBeenCalled();
  });

  it("keeps the summary state when the follow-up snapshot refresh fails", async () => {
    const recovery = createOrchestrationRecoveryCoordinator();

    const bootstrapSummary = makeReadModel(4);
    const getBootstrapSummary = vi.fn().mockResolvedValue(bootstrapSummary);
    const getSnapshot = vi.fn().mockRejectedValue(new Error("snapshot unavailable"));
    const api = {
      orchestration: {
        getBootstrapSummary,
        getSnapshot,
      },
    } as unknown as NativeApi;
    const syncServerReadModel = vi.fn();
    const reconcileSnapshotDerivedState = vi.fn();
    const recoverFromSequenceGap = vi.fn().mockResolvedValue(undefined);

    await bootstrapOrchestrationState({
      api,
      recovery,
      syncServerReadModel,
      reconcileSnapshotDerivedState,
      recoverFromSequenceGap,
      isDisposed: () => false,
    });

    expect(getBootstrapSummary).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).toHaveBeenCalledTimes(1);
    expect(syncServerReadModel).toHaveBeenCalledWith(bootstrapSummary);
    expect(reconcileSnapshotDerivedState).toHaveBeenCalledTimes(1);
  });
});

describe("isStandaloneRootRoutePath", () => {
  it("returns true for artifact and changes standalone routes", () => {
    vi.mocked(isArtifactWindowPath).mockReturnValueOnce(true);
    expect(isStandaloneRootRoutePath("/artifact")).toBe(true);

    vi.mocked(isChangesWindowPath).mockReturnValueOnce(true);
    expect(isStandaloneRootRoutePath("/changes/thread-1")).toBe(true);
  });

  it("returns false for normal app routes", () => {
    expect(isStandaloneRootRoutePath("/")).toBe(false);
  });
});

describe("collectOrchestrationInvalidationTargets", () => {
  it("collects project and root invalidations for created workers", () => {
    const targets = collectOrchestrationInvalidationTargets({
      events: [
        {
          sequence: 1,
          eventId: EventId.makeUnsafe("event-1"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("worker-1"),
          occurredAt: "2026-04-10T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.created",
          payload: {
            threadId: ThreadId.makeUnsafe("worker-1"),
            projectId: ProjectId.makeUnsafe("project-worker"),
            title: "Worker",
            labels: [],
            modelSelection: { provider: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            orchestratorProjectId: ProjectId.makeUnsafe("project-orchestrator"),
            orchestratorThreadId: ThreadId.makeUnsafe("root-1"),
            parentThreadId: undefined,
            spawnRole: "worker",
            spawnedBy: ThreadId.makeUnsafe("root-1"),
            workflowId: "wf-1",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:00.000Z",
          },
        } as const,
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("root-1"),
          projectId: ProjectId.makeUnsafe("project-orchestrator"),
          parentThreadId: undefined,
          spawnRole: "orchestrator",
          spawnedBy: undefined,
          orchestratorThreadId: undefined,
          workflowId: "wf-1",
        },
      ],
      projects: [],
    });

    expect(targets.projectIds).toEqual([ProjectId.makeUnsafe("project-worker")]);
    expect(targets.rootThreadIds).toEqual([ThreadId.makeUnsafe("root-1")]);
  });

  it("includes the currently selected root for archived or unarchived thread events", () => {
    const targets = collectOrchestrationInvalidationTargets({
      events: [
        {
          sequence: 1,
          eventId: EventId.makeUnsafe("event-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("worker-1"),
          occurredAt: "2026-04-10T00:00:00.000Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "thread.archived",
          payload: {
            threadId: ThreadId.makeUnsafe("worker-1"),
            archivedAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:00.000Z",
          },
        } as const,
      ],
      threads: [
        {
          id: ThreadId.makeUnsafe("root-1"),
          projectId: ProjectId.makeUnsafe("project-orchestrator"),
          parentThreadId: undefined,
          spawnRole: "orchestrator",
          spawnedBy: undefined,
          orchestratorThreadId: undefined,
          workflowId: "wf-1",
        },
        {
          id: ThreadId.makeUnsafe("worker-1"),
          projectId: ProjectId.makeUnsafe("project-orchestrator"),
          parentThreadId: ThreadId.makeUnsafe("root-1"),
          spawnRole: "worker",
          spawnedBy: ThreadId.makeUnsafe("root-1"),
          orchestratorThreadId: ThreadId.makeUnsafe("root-1"),
          workflowId: "wf-1",
        },
      ],
      projects: [
        {
          id: ProjectId.makeUnsafe("project-orchestrator"),
          currentSessionRootThreadId: ThreadId.makeUnsafe("root-selected"),
        },
      ],
    });

    expect(targets.projectIds).toEqual([ProjectId.makeUnsafe("project-orchestrator")]);
    expect(targets.rootThreadIds).toEqual([
      ThreadId.makeUnsafe("root-1"),
      ThreadId.makeUnsafe("root-selected"),
    ]);
  });
});
