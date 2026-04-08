import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, type ReactNode, useCallback, useEffect, useState } from "react";

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

const CHANGES_PANEL_WIDTH_STORAGE_KEY = "chat_changes_panel_width";
const CHANGES_PANEL_DEFAULT_WIDTH = "clamp(18rem,24vw,24rem)";
const CHANGES_PANEL_MIN_WIDTH = 16 * 16;

const ChangesPanelInlineSidebar = (props: {
  changesPanelOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) => {
  const { changesPanelOpen, onClose, onOpen } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={changesPanelOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": CHANGES_PANEL_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: CHANGES_PANEL_MIN_WIDTH,
          storageKey: CHANGES_PANEL_WIDTH_STORAGE_KEY,
        }}
      >
        <ChangesPanel />
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
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

  // Changes panel state from UI store
  const changesPanelOpen = useUiStateStore((s) => s.changesPanelOpen);
  const openChangesPanel = useUiStateStore((s) => s.openChangesPanel);
  const closeChangesPanel = useUiStateStore((s) => s.closeChangesPanel);
  const settings = useSettings();
  const changesDrawerVisibility = settings.changesDrawerVisibility;
  const showChangesDrawer = changesDrawerVisibility === "always_show";

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
    if (!showChangesDrawer && changesPanelOpen) {
      closeChangesPanel();
    }
  }, [changesPanelOpen, closeChangesPanel, showChangesDrawer]);

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
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView key={threadId} threadId={threadId} />
      </SidebarInset>
      {showChangesDrawer ? (
        <ChangesPanelInlineSidebar
          changesPanelOpen={changesPanelOpen}
          onClose={closeChangesPanel}
          onOpen={() => openChangesPanel()}
        />
      ) : null}
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
