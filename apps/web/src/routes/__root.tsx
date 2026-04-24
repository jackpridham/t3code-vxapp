import {
  type NativeApi,
  type OrchestrationReadModel,
  OrchestrationEvent,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";

import { ArtifactPanel } from "../components/ArtifactPanel";
import { ArtifactsPreloader } from "../components/artifacts/ArtifactsPreloader";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { Button } from "../components/ui/button";
import { AnchoredToastProvider, ToastProvider, toastManager } from "../components/ui/toast";
import { APP_DISPLAY_NAME } from "../branding";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { serverConfigQueryOptions, serverQueryKeys } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import {
  clearPromotedDraftThread,
  clearPromotedDraftThreads,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { terminalRunningSubprocessFromEvent } from "../terminalActivity";
import { onServerConfigUpdated, onServerProvidersUpdated, onServerWelcome } from "../wsNativeApi";
import { migrateLocalSettingsToServer } from "../hooks/useSettings";
import { useSettings } from "../hooks/useSettings";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { skillQueryKeys } from "../lib/skillReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import {
  deriveOrchestrationBatchEffects,
  processEventNotifications,
} from "../orchestrationEventEffects";
import { createOrchestrationRecoveryCoordinator } from "../orchestrationRecovery";
import { isArtifactWindowPath } from "../lib/artifactWindow";
import { isArtifactsPath } from "../lib/artifactsRoute";
import { isChangesWindowPath } from "../lib/changesWindow";
import { isSidebarWindowPath } from "../lib/sidebarWindow";
import {
  invalidateOrchestrationProjectCatalogs,
  invalidateOrchestrationSessionCatalogs,
} from "../lib/orchestrationReactQuery";
import { buildAppDocumentTitle } from "../lib/documentTitle";
import {
  addThreadDetailToReadModel,
  loadCurrentStateWithThreadDetail,
} from "../lib/orchestrationCurrentStateHydration";
import { resolveThreadSessionRootId } from "../lib/orchestrationMode";
import type { Project, Thread } from "../types";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: buildAppDocumentTitle() }],
  }),
});

export function isStandaloneRootRoutePath(pathname: string): boolean {
  return (
    isArtifactWindowPath(pathname) || isArtifactsPath(pathname) || isChangesWindowPath(pathname)
  );
}

export function shouldUseStandaloneRootLayout(input: {
  pathname: string;
  ideModeEnabled: boolean;
  isChatThreadRoute: boolean;
}): boolean {
  return (
    isStandaloneRootRoutePath(input.pathname) || (input.ideModeEnabled && input.isChatThreadRoute)
  );
}

type OrchestrationInvalidationThread = Pick<
  Thread,
  | "id"
  | "projectId"
  | "parentThreadId"
  | "spawnRole"
  | "spawnedBy"
  | "orchestratorThreadId"
  | "workflowId"
>;

export function collectOrchestrationInvalidationTargets(input: {
  events: ReadonlyArray<OrchestrationEvent>;
  threads: readonly OrchestrationInvalidationThread[];
  projects: readonly Pick<Project, "id" | "currentSessionRootThreadId">[];
}): {
  projectIds: ProjectId[];
  rootThreadIds: ThreadId[];
} {
  const projectIds = new Set<ProjectId>();
  const rootThreadIds = new Set<ThreadId>();
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const currentSessionRootByProjectId = new Map(
    input.projects.map(
      (project) => [project.id, project.currentSessionRootThreadId ?? null] as const,
    ),
  );

  const addThreadTargets = (threadId: ThreadId) => {
    const thread = threadsById.get(threadId);
    if (!thread) {
      return;
    }
    projectIds.add(thread.projectId);
    const rootThreadId = resolveThreadSessionRootId({
      threadId,
      threads: input.threads,
    });
    if (rootThreadId) {
      rootThreadIds.add(rootThreadId);
    }
    const selectedRootThreadId = currentSessionRootByProjectId.get(thread.projectId) ?? null;
    if (selectedRootThreadId) {
      rootThreadIds.add(selectedRootThreadId);
    }
  };

  for (const event of input.events) {
    switch (event.type) {
      case "thread.created": {
        const syntheticThread: OrchestrationInvalidationThread = {
          id: event.payload.threadId,
          projectId: event.payload.projectId,
          parentThreadId: event.payload.parentThreadId,
          spawnRole: event.payload.spawnRole,
          spawnedBy: event.payload.spawnedBy,
          orchestratorThreadId: event.payload.orchestratorThreadId,
          workflowId: event.payload.workflowId,
        };
        projectIds.add(event.payload.projectId);
        const rootThreadId = resolveThreadSessionRootId({
          threadId: syntheticThread.id,
          threads: [...input.threads, syntheticThread],
        });
        if (rootThreadId) {
          rootThreadIds.add(rootThreadId);
        }
        break;
      }
      case "thread.deleted":
      case "thread.archived":
      case "thread.unarchived":
      case "thread.meta-updated":
      case "thread.session-set":
        addThreadTargets(event.payload.threadId);
        break;
      default:
        break;
    }
  }

  return {
    projectIds: [...projectIds],
    rootThreadIds: [...rootThreadIds],
  };
}

function RootRouteView() {
  const { isChatThreadRoute, pathname } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      isChatThreadRoute: state.matches.some((match) => match.routeId === "/_chat/$threadId"),
    }),
  });
  const settings = useSettings();
  const isSidebarWindowRoute = isSidebarWindowPath(pathname);
  const isStandaloneWindowRoute = shouldUseStandaloneRootLayout({
    pathname,
    ideModeEnabled: settings.ideModeEnabled,
    isChatThreadRoute,
  });

  if (!readNativeApi()) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Connecting to {APP_DISPLAY_NAME} server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <EventRouter />
        <DesktopProjectBootstrap />
        <ArtifactsPreloader />
        {isStandaloneWindowRoute ? (
          <Outlet />
        ) : isSidebarWindowRoute ? (
          <Outlet />
        ) : (
          <AppSidebarLayout>
            <Outlet />
            <ArtifactPanel />
          </AppSidebarLayout>
        )}
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

type BootstrapRecoveryDeps = {
  api: NativeApi;
  recovery: ReturnType<typeof createOrchestrationRecoveryCoordinator>;
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  reconcileSnapshotDerivedState: () => void;
  recoverFromSequenceGap: () => Promise<void>;
  isDisposed: () => boolean;
  getCurrentThreadId?: () => ThreadId | null;
};

function findCurrentSessionRootThreadId(
  readModel: Pick<OrchestrationReadModel, "projects">,
): ThreadId | null {
  for (const project of readModel.projects) {
    if (project.currentSessionRootThreadId) {
      return project.currentSessionRootThreadId;
    }
  }
  return null;
}

export function resolveRouteThreadId(pathname: string): ThreadId | null {
  const match = /^\/([^/?#]+)/.exec(pathname);
  if (!match) {
    return null;
  }
  const routeThreadId = match[1];
  if (
    !routeThreadId ||
    routeThreadId === "artifact" ||
    routeThreadId === "artifacts" ||
    routeThreadId === "changes" ||
    routeThreadId === "settings" ||
    routeThreadId === "sidebar"
  ) {
    return null;
  }
  try {
    return ThreadId.makeUnsafe(decodeURIComponent(routeThreadId));
  } catch {
    return null;
  }
}

export async function bootstrapOrchestrationState({
  api,
  recovery,
  syncServerReadModel,
  reconcileSnapshotDerivedState,
  recoverFromSequenceGap,
  isDisposed,
  getCurrentThreadId,
}: BootstrapRecoveryDeps): Promise<void> {
  const applyReadModel = async (
    loadReadModel: () => Promise<OrchestrationReadModel>,
  ): Promise<OrchestrationReadModel | null> => {
    const readModel = await loadReadModel();
    if (isDisposed()) {
      return null;
    }
    syncServerReadModel(readModel);
    reconcileSnapshotDerivedState();
    if (recovery.completeSnapshotRecovery(readModel.snapshotSequence)) {
      void recoverFromSequenceGap();
    }
    return readModel;
  };

  const runSnapshotRecovery = async (
    loadReadModel: () => Promise<OrchestrationReadModel>,
  ): Promise<OrchestrationReadModel | null> => {
    if (!recovery.beginSnapshotRecovery("bootstrap")) {
      return null;
    }

    try {
      return await applyReadModel(loadReadModel);
    } catch {
      recovery.failSnapshotRecovery();
      return null;
    }
  };

  const summaryApplied = await runSnapshotRecovery(() => api.orchestration.getBootstrapSummary());
  if (summaryApplied) {
    const activeThreadId = getCurrentThreadId?.() ?? findCurrentSessionRootThreadId(summaryApplied);
    if (activeThreadId) {
      await runSnapshotRecovery(() => loadCurrentStateWithThreadDetail(api, activeThreadId));
    }
    return;
  }

  const currentState = await runSnapshotRecovery(() => api.orchestration.getCurrentState());
  const activeThreadId = currentState
    ? (getCurrentThreadId?.() ?? findCurrentSessionRootThreadId(currentState))
    : null;
  if (currentState && activeThreadId) {
    await runSnapshotRecovery(() => addThreadDetailToReadModel(api, currentState, activeThreadId));
  }
}

function EventRouter() {
  const applyOrchestrationEvents = useStore((store) => store.applyOrchestrationEvents);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const syncProjects = useUiStateStore((store) => store.syncProjects);
  const syncThreads = useUiStateStore((store) => store.syncThreads);
  const clearThreadUi = useUiStateStore((store) => store.clearThreadUi);
  const removeTerminalState = useTerminalStateStore((store) => store.removeTerminalState);
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pathnameRef = useRef(pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    const recovery = createOrchestrationRecoveryCoordinator();
    let needsProviderInvalidation = false;
    // Suppress notifications during initial hydration (summary/snapshot + replay recovery).
    // Only fire notifications for real-time domain events after bootstrap completes.
    let notificationsReady = false;

    const reconcileSnapshotDerivedState = () => {
      const threads = useStore.getState().threads;
      const projects = useStore.getState().projects;
      syncProjects(projects.map((project) => ({ id: project.id, cwd: project.cwd })));
      syncThreads(
        threads.map((thread) => ({
          id: thread.id,
          seedVisitedAt: thread.updatedAt ?? thread.createdAt,
        })),
      );
      clearPromotedDraftThreads(threads.map((thread) => thread.id));
      const draftThreadIds = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadId,
      ) as ThreadId[];
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: threads.map((thread) => ({ id: thread.id, deletedAt: null })),
        draftThreadIds,
      });
      removeOrphanedTerminalStates(activeThreadIds);
    };

    const queryInvalidationThrottler = new Throttler(
      () => {
        if (!needsProviderInvalidation) {
          return;
        }
        needsProviderInvalidation = false;
        void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
        // Invalidate workspace and skill reference queries so the composer
        // pickers reflect files created, deleted, or restored during this turn.
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
        void queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
      },
      {
        wait: 100,
        leading: false,
        trailing: true,
      },
    );

    const applyEventBatch = (events: ReadonlyArray<OrchestrationEvent>) => {
      const nextEvents = recovery.markEventBatchApplied(events);
      if (nextEvents.length === 0) {
        return;
      }

      const threadsBeforeApply = useStore.getState().threads;

      const batchEffects = deriveOrchestrationBatchEffects(nextEvents);
      const needsProjectUiSync = nextEvents.some(
        (event) =>
          event.type === "project.created" ||
          event.type === "project.meta-updated" ||
          event.type === "project.deleted",
      );

      if (batchEffects.needsProviderInvalidation) {
        needsProviderInvalidation = true;
        void queryInvalidationThrottler.maybeExecute();
      }

      applyOrchestrationEvents(nextEvents);
      const threadsAfterApply = useStore.getState().threads;
      const invalidationTargets = collectOrchestrationInvalidationTargets({
        events: nextEvents,
        threads: [...threadsBeforeApply, ...threadsAfterApply],
        projects: useStore.getState().projects,
      });
      if (invalidationTargets.projectIds.length > 0) {
        void invalidateOrchestrationProjectCatalogs(queryClient, invalidationTargets.projectIds);
      }
      if (invalidationTargets.rootThreadIds.length > 0) {
        void invalidateOrchestrationSessionCatalogs(queryClient, invalidationTargets.rootThreadIds);
      }

      // Fire user notifications for real-time events only (skip during hydration)
      if (notificationsReady) {
        processEventNotifications(nextEvents);
      }

      if (needsProjectUiSync) {
        const projects = useStore.getState().projects;
        syncProjects(projects.map((project) => ({ id: project.id, cwd: project.cwd })));
      }
      const needsThreadUiSync = nextEvents.some(
        (event) => event.type === "thread.created" || event.type === "thread.deleted",
      );
      if (needsThreadUiSync) {
        const threads = useStore.getState().threads;
        syncThreads(
          threads.map((thread) => ({
            id: thread.id,
            seedVisitedAt: thread.updatedAt ?? thread.createdAt,
          })),
        );
      }
      const draftStore = useComposerDraftStore.getState();
      for (const threadId of batchEffects.clearPromotedDraftThreadIds) {
        clearPromotedDraftThread(threadId);
      }
      for (const threadId of batchEffects.clearDeletedThreadIds) {
        draftStore.clearDraftThread(threadId);
        clearThreadUi(threadId);
      }
      for (const threadId of batchEffects.removeTerminalStateThreadIds) {
        removeTerminalState(threadId);
      }
    };

    const recoverFromSequenceGap = async (): Promise<void> => {
      if (!recovery.beginReplayRecovery("sequence-gap")) {
        return;
      }

      try {
        const events = await api.orchestration.replayEvents(recovery.getState().latestSequence);
        if (!disposed) {
          applyEventBatch(events);
        }
      } catch {
        recovery.failReplayRecovery();
        void recoverFromBoundedState();
        return;
      }

      if (!disposed && recovery.completeReplayRecovery()) {
        void recoverFromSequenceGap();
      }
    };

    const resolveCurrentThreadId = (): ThreadId | null => {
      const routeThreadId = resolveRouteThreadId(pathnameRef.current);
      if (routeThreadId) {
        return routeThreadId;
      }
      const projects = useStore.getState().projects;
      for (const project of projects) {
        if (project.currentSessionRootThreadId) {
          return project.currentSessionRootThreadId;
        }
      }
      return null;
    };

    const runSnapshotRecovery = async (reason: "bootstrap" | "replay-failed"): Promise<void> => {
      if (!recovery.beginSnapshotRecovery(reason)) {
        return;
      }

      try {
        const currentThreadId = resolveCurrentThreadId();
        const readModel = currentThreadId
          ? await loadCurrentStateWithThreadDetail(api, currentThreadId)
          : await api.orchestration.getCurrentState();
        if (!disposed) {
          syncServerReadModel(readModel);
          reconcileSnapshotDerivedState();
          if (recovery.completeSnapshotRecovery(readModel.snapshotSequence)) {
            void recoverFromSequenceGap();
          }
        }
      } catch {
        // Keep prior state and wait for welcome or a later replay attempt.
        recovery.failSnapshotRecovery();
      }
    };

    const recoverFromBoundedState = async (): Promise<void> => {
      await runSnapshotRecovery("replay-failed");
    };

    const unsubDomainEvent = api.orchestration.onDomainEvent((event) => {
      const action = recovery.classifyDomainEvent(event.sequence);
      if (action === "apply") {
        applyEventBatch([event]);
        return;
      }
      if (action === "recover") {
        void recoverFromSequenceGap();
      }
    });
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
      if (hasRunningSubprocess === null) {
        return;
      }
      useTerminalStateStore
        .getState()
        .setTerminalActivity(
          ThreadId.makeUnsafe(event.threadId),
          event.terminalId,
          hasRunningSubprocess,
        );
    });
    const unsubWelcome = onServerWelcome((payload) => {
      // Migrate old localStorage settings to server on first connect
      migrateLocalSettingsToServer();
      void (async () => {
        await bootstrapOrchestrationState({
          api,
          recovery,
          syncServerReadModel,
          reconcileSnapshotDerivedState,
          recoverFromSequenceGap,
          isDisposed: () => disposed,
          getCurrentThreadId: resolveCurrentThreadId,
        });
        if (disposed) {
          return;
        }
        // Enable notifications now that hydration is complete.
        // Only real-time domain events from here forward will trigger toasts.
        notificationsReady = true;

        if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          return;
        }
        setProjectExpanded(payload.bootstrapProjectId, true);

        if (pathnameRef.current !== "/") {
          return;
        }
        if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: payload.bootstrapThreadId },
          replace: true,
        });
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
      })().catch(() => undefined);
    });
    // onServerConfigUpdated replays the latest cached value synchronously
    // during subscribe. Skip the toast for that replay so effect re-runs
    // don't produce duplicate toasts.
    let subscribed = false;
    const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
      // Invalidate the config query so active observers refetch fresh data.
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });

      if (!subscribed) return;

      // Only show keybindings toasts for keybindings changes (no settings in payload)
      if (payload.settings) return;

      const issue = payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
      if (!issue) {
        toastManager.add({
          type: "success",
          title: "Keybindings updated",
          description: "Keybindings configuration reloaded successfully.",
        });
        return;
      }

      toastManager.add({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: issue.message,
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            void queryClient
              .ensureQueryData(serverConfigQueryOptions())
              .then((config) => {
                const editor = resolveAndPersistPreferredEditor(config.availableEditors);
                if (!editor) {
                  throw new Error("No available editors found.");
                }
                return api.shell.openInEditor(config.keybindingsConfigPath, editor);
              })
              .catch((error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                });
              });
          },
        },
      });
    });
    const unsubProvidersUpdated = onServerProvidersUpdated(() => {
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
    });
    subscribed = true;
    return () => {
      disposed = true;
      needsProviderInvalidation = false;
      queryInvalidationThrottler.cancel();
      unsubDomainEvent();
      unsubTerminalEvent();
      unsubWelcome();
      unsubServerConfigUpdated();
      unsubProvidersUpdated();
    };
  }, [
    applyOrchestrationEvents,
    navigate,
    queryClient,
    removeTerminalState,
    removeOrphanedTerminalStates,
    clearThreadUi,
    setProjectExpanded,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  ]);

  return null;
}

function DesktopProjectBootstrap() {
  // Desktop hydration runs through EventRouter project + orchestration sync.
  return null;
}
