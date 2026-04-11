import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import { ChangesPanel } from "../components/ChangesPanel";
import ChatView from "../components/ChatView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { useComposerDraftStore } from "../composerDraftStore";
import { type DiffRouteSearch, parseDiffRouteSearch } from "../diffRouteSearch";
import { useSettings } from "../hooks/useSettings";
import {
  CHANGES_PANEL_DEFAULT_WIDTH,
  CHANGES_PANEL_MIN_MAIN_CONTENT_WIDTH,
  CHANGES_PANEL_MIN_WIDTH,
  CHANGES_PANEL_WIDTH_STORAGE_KEY,
  resolveEffectiveChangesPanelOpen,
} from "../lib/chatChangesPanelLayout";
import { buildChangesWindowTarget, useChangesWindowTarget } from "../lib/changesWindowSync";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const ChangesWindowNavigationPublisher = (props: { threadId: ThreadId }) => {
  const [, setChangesWindowTarget] = useChangesWindowTarget();

  useEffect(() => {
    setChangesWindowTarget((current) => {
      if (
        current?.threadId === props.threadId &&
        current.path === null &&
        current.mode === "preview"
      ) {
        return current;
      }

      return buildChangesWindowTarget({
        threadId: props.threadId,
        path: null,
        mode: "preview",
      });
    });
  }, [props.threadId, setChangesWindowTarget]);

  return null;
};

function ChatThreadRouteView() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;

  const settings = useSettings();
  const showChangesPanelByDefault = settings.changesDrawerVisibility === "always_show";
  const rememberDrawerWidth = settings.rememberChangesDrawerWidth;
  const changesPanelOpen = useUiStateStore((s) => s.changesPanelOpen);
  const changesPanelInitializedFromSettings = useUiStateStore(
    (s) => s.changesPanelInitializedFromSettings,
  );
  const openChangesPanel = useUiStateStore((s) => s.openChangesPanel);
  const closeChangesPanel = useUiStateStore((s) => s.closeChangesPanel);
  const initializeChangesPanelFromSettings = useUiStateStore(
    (s) => s.initializeChangesPanelFromSettings,
  );
  const effectiveChangesPanelOpen = resolveEffectiveChangesPanelOpen({
    changesPanelOpen,
    initializedFromSettings: changesPanelInitializedFromSettings,
    showByDefault: showChangesPanelByDefault,
  });

  // Diff search params (retained for deep-linking to specific file diffs)
  const diffOpen = search.diff === "1";
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: { diff: undefined },
    });
  }, [navigate, threadId]);

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
    }
  }, [diffOpen]);

  useEffect(() => {
    initializeChangesPanelFromSettings(showChangesPanelByDefault);
  }, [initializeChangesPanelFromSettings, showChangesPanelByDefault]);

  useEffect(() => {
    if (!bootstrapComplete) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [bootstrapComplete, navigate, routeThreadExists, threadId]);

  if (!bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;

  return (
    <>
      <ChangesWindowNavigationPublisher threadId={threadId} />
      <SidebarProvider
        defaultOpen={showChangesPanelByDefault}
        open={effectiveChangesPanelOpen}
        onOpenChange={(open) => {
          if (open) {
            openChangesPanel();
            return;
          }
          closeChangesPanel();
        }}
        className="h-dvh min-h-0 min-w-0 flex-1 bg-transparent"
        style={
          {
            width: "auto",
            "--sidebar-width": CHANGES_PANEL_DEFAULT_WIDTH,
          } as CSSProperties
        }
      >
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
          <ChatView key={threadId} threadId={threadId} />
        </SidebarInset>
        <Sidebar
          side="right"
          collapsible="offcanvas"
          className="border-l border-border bg-card text-foreground"
          resizable={{
            minWidth: CHANGES_PANEL_MIN_WIDTH,
            shouldAcceptWidth: ({ nextWidth, wrapper }) =>
              wrapper.clientWidth - nextWidth >= CHANGES_PANEL_MIN_MAIN_CONTENT_WIDTH,
            ...(rememberDrawerWidth ? { storageKey: CHANGES_PANEL_WIDTH_STORAGE_KEY } : {}),
          }}
        >
          <ChangesPanel />
          <SidebarRail className="top-0 bottom-auto h-12" />
        </Sidebar>
      </SidebarProvider>
      {/* Diff panel overlay for when a specific file diff is requested */}
      {diffOpen && (
        <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
          {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
        </DiffPanelSheet>
      )}
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
