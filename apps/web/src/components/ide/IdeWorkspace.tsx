import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { type ResolvedKeybindingsConfig, type ThreadId as ThreadIdType } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { IdeChatDrawer } from "./IdeChatDrawer";
import { IdeEditorPane } from "./IdeEditorPane";
import { OrchestrationManager } from "./OrchestrationManager";
import { resolveIdeShortcutCommand } from "./ideShortcuts";
import { resolveIdeDrawerPrimaryThreadId } from "../../lib/ide";
import { serverConfigQueryOptions } from "../../lib/serverReactQuery";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { collapseThreadToCanonicalProject } from "../../lib/orchestrationMode";
import { selectThreadTerminalState, useTerminalStateStore } from "../../terminalStateStore";
import { useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import { cn } from "../../lib/utils";
import { resolveSidebarProjectKind } from "../Sidebar.logic";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const IDE_EXPLORER_WIDTH_STORAGE_KEY = "ide_explorer_sidebar_width";
const IDE_CHAT_DRAWER_WIDTH_STORAGE_KEY = "ide_chat_drawer_width";
const IDE_EXPLORER_DEFAULT_WIDTH = 352;
const IDE_CHAT_DRAWER_DEFAULT_WIDTH = 448;
const IDE_EXPLORER_MIN_WIDTH = 260;
const IDE_CHAT_DRAWER_MIN_WIDTH = 320;
const IDE_MIN_EDITOR_WIDTH = 420;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function readStoredWidth(storageKey: string, fallbackWidth: number): number {
  if (typeof window === "undefined") {
    return fallbackWidth;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) {
    return fallbackWidth;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallbackWidth;
}

function useStoredWidth(storageKey: string, fallbackWidth: number) {
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, fallbackWidth));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  return [width, setWidth] as const;
}

function PanelResizeHandle(props: {
  ariaLabel: string;
  side: "left" | "right";
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      className={cn(
        "group relative z-10 hidden w-2 shrink-0 cursor-col-resize bg-transparent transition-colors md:block",
        props.side === "left" ? "-ml-1 mr-0.5" : "ml-0.5 -mr-1",
      )}
      onPointerDown={props.onPointerDown}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-primary/60" />
    </button>
  );
}

interface IdeWorkspaceProps {
  threadId: ThreadIdType;
}

export function IdeWorkspace({ threadId }: IdeWorkspaceProps) {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const keybindings = useQuery(serverConfigQueryOptions()).data?.keybindings ?? EMPTY_KEYBINDINGS;
  const terminalOpen = useTerminalStateStore(
    (state) => selectThreadTerminalState(state.terminalStateByThreadId, threadId).terminalOpen,
  );
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === threadId),
    [threadId, threads],
  );
  const activeProject = useMemo(
    () =>
      activeThread
        ? (projects.find((project) => project.id === activeThread.projectId) ?? null)
        : null,
    [activeThread, projects],
  );
  const ideExplorerOpen = useUiStateStore((state) => state.ideExplorerOpen);
  const ideExplorerExpandedSections = useUiStateStore((state) => state.ideExplorerExpandedSections);
  const ideChatDrawerOpen = useUiStateStore((state) => state.ideChatDrawerOpen);
  const ideOrchestrationManagerOpen = useUiStateStore((state) => state.ideOrchestrationManagerOpen);
  const ideSelectedFile = useUiStateStore((state) => state.ideSelectedFile);
  const setIdeExplorerOpen = useUiStateStore((state) => state.setIdeExplorerOpen);
  const setIdeChatDrawerOpen = useUiStateStore((state) => state.setIdeChatDrawerOpen);
  const setIdeOrchestrationManagerOpen = useUiStateStore(
    (state) => state.setIdeOrchestrationManagerOpen,
  );
  const focusIdeExplorerSection = useUiStateStore((state) => state.focusIdeExplorerSection);
  const toggleIdeChatDrawer = useUiStateStore((state) => state.toggleIdeChatDrawer);
  const toggleIdeOrchestrationManager = useUiStateStore(
    (state) => state.toggleIdeOrchestrationManager,
  );
  const toggleIdeMarkdownPreview = useUiStateStore((state) => state.toggleIdeMarkdownPreview);
  const toggleIdeDiff = useUiStateStore((state) => state.toggleIdeDiff);
  const setIdeSelectedDrawerThreadId = useUiStateStore(
    (state) => state.setIdeSelectedDrawerThreadId,
  );
  const [explorerWidth, setExplorerWidth] = useStoredWidth(
    IDE_EXPLORER_WIDTH_STORAGE_KEY,
    IDE_EXPLORER_DEFAULT_WIDTH,
  );
  const [chatDrawerWidth, setChatDrawerWidth] = useStoredWidth(
    IDE_CHAT_DRAWER_WIDTH_STORAGE_KEY,
    IDE_CHAT_DRAWER_DEFAULT_WIDTH,
  );

  const beginResize = useCallback(
    (
      side: "left" | "right",
      event: ReactPointerEvent<HTMLButtonElement>,
      setWidth: (nextWidth: number | ((currentWidth: number) => number)) => void,
    ) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const viewportWidth = window.innerWidth;
        const maxWidth =
          side === "left"
            ? viewportWidth - (ideChatDrawerOpen ? chatDrawerWidth : 0) - IDE_MIN_EDITOR_WIDTH
            : viewportWidth - (ideExplorerOpen ? explorerWidth : 0) - IDE_MIN_EDITOR_WIDTH;
        const minWidth = side === "left" ? IDE_EXPLORER_MIN_WIDTH : IDE_CHAT_DRAWER_MIN_WIDTH;
        const nextWidth = side === "left" ? moveEvent.clientX : viewportWidth - moveEvent.clientX;
        setWidth(clamp(nextWidth, minWidth, Math.max(minWidth, maxWidth)));
      };

      const stopResize = () => {
        if (handle.hasPointerCapture(event.pointerId)) {
          handle.releasePointerCapture(event.pointerId);
        }
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [chatDrawerWidth, explorerWidth, ideChatDrawerOpen, ideExplorerOpen],
  );

  useEffect(() => {
    const onWindowResize = () => {
      const viewportWidth = window.innerWidth;

      setExplorerWidth((currentWidth) => {
        const maxWidth =
          viewportWidth - (ideChatDrawerOpen ? chatDrawerWidth : 0) - IDE_MIN_EDITOR_WIDTH;
        return clamp(
          currentWidth,
          IDE_EXPLORER_MIN_WIDTH,
          Math.max(IDE_EXPLORER_MIN_WIDTH, maxWidth),
        );
      });

      setChatDrawerWidth((currentWidth) => {
        const maxWidth =
          viewportWidth - (ideExplorerOpen ? explorerWidth : 0) - IDE_MIN_EDITOR_WIDTH;
        return clamp(
          currentWidth,
          IDE_CHAT_DRAWER_MIN_WIDTH,
          Math.max(IDE_CHAT_DRAWER_MIN_WIDTH, maxWidth),
        );
      });
    };

    onWindowResize();
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [
    chatDrawerWidth,
    explorerWidth,
    ideChatDrawerOpen,
    ideExplorerOpen,
    setChatDrawerWidth,
    setExplorerWidth,
  ]);

  useEffect(() => {
    const platform = navigator.platform;
    const getShortcutContext = () => ({
      ideMode: true,
      terminalFocus: isTerminalFocused(),
      terminalOpen,
    });

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveIdeShortcutCommand(event, keybindings, {
        platform,
        context: getShortcutContext(),
      });
      if (!command) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (command === "ide.changes.focus") {
        focusIdeExplorerSection("changes");
        return;
      }
      if (command === "ide.explorer.toggle") {
        if (ideExplorerOpen && ideExplorerExpandedSections.includes("explorer")) {
          setIdeExplorerOpen(false);
          return;
        }
        focusIdeExplorerSection("explorer");
        return;
      }
      if (command === "ide.threads.focus") {
        focusIdeExplorerSection("threads");
        return;
      }
      if (command === "ide.manager.toggle") {
        toggleIdeOrchestrationManager();
        return;
      }
      if (command === "ide.chat.toggle") {
        toggleIdeChatDrawer();
        return;
      }
      if (command === "ide.markdownPreview.toggle") {
        if (ideSelectedFile && /\.mdx?$/i.test(ideSelectedFile.absolutePath)) {
          toggleIdeMarkdownPreview();
        }
        return;
      }
      if (command === "ide.diff.toggle") {
        if (ideSelectedFile) {
          toggleIdeDiff();
        }
        return;
      }
      if (command === "ide.chat.executive") {
        const executiveThreadId = resolveIdeDrawerPrimaryThreadId({
          activeThreadId: threadId,
          kind: "executive",
          projects,
          threads,
        });
        if (executiveThreadId) {
          setIdeSelectedDrawerThreadId(executiveThreadId);
          setIdeChatDrawerOpen(true);
        }
        return;
      }
      if (command === "ide.chat.orchestrator") {
        const orchestratorThreadId = resolveIdeDrawerPrimaryThreadId({
          activeThreadId: threadId,
          kind: "orchestrator",
          projects,
          threads,
        });
        if (orchestratorThreadId) {
          setIdeSelectedDrawerThreadId(orchestratorThreadId);
          setIdeChatDrawerOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    focusIdeExplorerSection,
    ideExplorerExpandedSections,
    ideExplorerOpen,
    ideSelectedFile,
    keybindings,
    projects,
    setIdeChatDrawerOpen,
    setIdeExplorerOpen,
    setIdeSelectedDrawerThreadId,
    terminalOpen,
    threadId,
    threads,
    toggleIdeChatDrawer,
    toggleIdeDiff,
    toggleIdeMarkdownPreview,
    toggleIdeOrchestrationManager,
  ]);

  const title =
    activeProject &&
    resolveSidebarProjectKind({ project: activeProject }) !== "project" &&
    activeThread
      ? collapseThreadToCanonicalProject({ thread: activeThread, projects }).canonicalProjectName
      : (activeProject?.name ?? null);

  return (
    <>
      <div className="flex h-dvh min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground">
        {ideExplorerOpen ? (
          <>
            <aside
              className="flex h-full min-h-0 shrink-0 overflow-hidden border-r border-border bg-card"
              style={{ width: `${explorerWidth}px` }}
            >
              <ExplorerSidebar threadId={threadId} />
            </aside>
            <PanelResizeHandle
              ariaLabel="Resize Explorer Panel"
              side="left"
              onPointerDown={(event) => beginResize("left", event, setExplorerWidth)}
            />
          </>
        ) : null}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background isolate">
          {title ? <div className="sr-only">{title}</div> : null}
          <IdeEditorPane selectedFile={ideSelectedFile} />
        </main>

        {ideChatDrawerOpen ? (
          <>
            <PanelResizeHandle
              ariaLabel="Resize Chat Drawer"
              side="right"
              onPointerDown={(event) => beginResize("right", event, setChatDrawerWidth)}
            />
            <aside
              className="flex h-full min-h-0 shrink-0 overflow-hidden border-l border-border bg-card"
              style={{ width: `${chatDrawerWidth}px` }}
            >
              <IdeChatDrawer threadId={threadId} />
            </aside>
          </>
        ) : null}
      </div>

      <OrchestrationManager
        open={ideOrchestrationManagerOpen}
        onOpenChange={setIdeOrchestrationManagerOpen}
        threadId={threadId}
      />
    </>
  );
}
