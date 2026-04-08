import { describe, expect, it, vi } from "vitest";
import type { NativeApi, OrchestrationReadModel } from "@t3tools/contracts";

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

import { bootstrapOrchestrationState, isStandaloneRootRoutePath } from "./__root";
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
