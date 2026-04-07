/**
 * ArtifactPanel — Right-side artifact viewer for thread markdown artifacts.
 *
 * Discovers and renders `.md` files stored under `@Docs/@Scratch/{repo}/`
 * relative to the active thread's worktree. Uses the shared resizable
 * sidebar primitive so the drawer can expand like other side panels.
 */
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { openInPreferredEditor } from "../editorPreferences";
import { buildArtifactWindowHref } from "../lib/artifactWindow";
import {
  discoverThreadArtifacts,
  readArtifactContent,
  titleFromFilename,
  type DiscoveredArtifact,
} from "../artifactDiscovery";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";

// ── Internal types ────────────────────────────────────────────────────────────

export type ContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; content: string; path: string }
  | { status: "error"; message: string };

const ARTIFACT_PANEL_WIDTH_STORAGE_KEY = "chat_artifact_panel_width";
const ARTIFACT_PANEL_DEFAULT_WIDTH = "clamp(30rem,42vw,60rem)";
const ARTIFACT_PANEL_MAX_WIDTH = 96 * 16;
const ARTIFACT_PANEL_MIN_WIDTH = 24 * 16;

function useArtifactContentState(
  worktreePath: string | null,
  artifactPath: string | null,
): ContentState {
  const [contentState, setContentState] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!artifactPath) {
      setContentState({ status: "idle" });
      return;
    }

    const path = artifactPath;
    setContentState({ status: "loading" });

    let cancelled = false;
    void readArtifactContent(worktreePath, path)
      .then((content) => {
        if (!cancelled) {
          setContentState({ status: "loaded", content, path });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setContentState({
            status: "error",
            message: err instanceof Error ? err.message : "Unable to load artifact.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifactPath, worktreePath]);

  return contentState;
}

function resolveArtifactTitle(
  artifactPath: string | null,
  activeArtifact: DiscoveredArtifact | null,
): string {
  return (
    activeArtifact?.title ??
    (artifactPath
      ? titleFromFilename(artifactPath.slice(artifactPath.lastIndexOf("/") + 1))
      : "Artifact")
  );
}

function resolveArtifactCwd(
  artifactPath: string | null,
  worktreePath: string | null,
): string | undefined {
  if (worktreePath) {
    return worktreePath;
  }
  if (!artifactPath) {
    return undefined;
  }
  const lastSlash = artifactPath.lastIndexOf("/");
  return lastSlash >= 0 ? artifactPath.slice(0, lastSlash) : undefined;
}

interface ArtifactViewerFrameProps {
  activeArtifact: DiscoveredArtifact | null;
  activeArtifactPath: string | null;
  artifacts: readonly DiscoveredArtifact[];
  cwd: string | undefined;
  onClose?: (() => void) | undefined;
  onOpenInEditor?: (() => void) | undefined;
  onPopOut?: (() => void) | undefined;
  onSelectArtifact?: ((path: string) => void) | undefined;
  panelTitle: string;
  state: ContentState;
}

function ArtifactViewerFrame({
  activeArtifact,
  activeArtifactPath,
  artifacts,
  cwd,
  onClose,
  onOpenInEditor,
  onPopOut,
  onSelectArtifact,
  panelTitle,
  state,
}: ArtifactViewerFrameProps) {
  const artifactLocation =
    activeArtifact?.relativePath ??
    (activeArtifactPath ? activeArtifactPath.slice(activeArtifactPath.lastIndexOf("/") + 1) : null);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[linear-gradient(180deg,color-mix(in_srgb,var(--card)_88%,var(--background))_0%,var(--background)_26%,color-mix(in_srgb,var(--background)_94%,var(--card))_100%)] text-foreground">
      <div className="border-b border-border/70 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground/70 uppercase">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-foreground/70 shadow-xs">
                <BookOpenIcon className="size-3" />
                Markdown viewer
              </span>
              {activeArtifact?.repo ? (
                <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-1 text-muted-foreground">
                  {activeArtifact.repo}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {panelTitle}
              </h2>
              {artifactLocation ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">{artifactLocation}</p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onPopOut ? (
              <Button
                size="icon"
                variant="ghost"
                title="Open in separate window"
                aria-label="Open artifact in separate window"
                onClick={onPopOut}
                className="size-8"
              >
                <ArrowUpRightIcon className="size-4" />
              </Button>
            ) : null}
            {onOpenInEditor ? (
              <Button
                size="icon"
                variant="ghost"
                title="Open in editor"
                aria-label="Open artifact in editor"
                onClick={onOpenInEditor}
                className="size-8"
              >
                <ExternalLinkIcon className="size-4" />
              </Button>
            ) : null}
            {onClose ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close artifact panel"
                title="Close artifact panel"
                className="size-8"
                onClick={onClose}
              >
                <XIcon className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {artifacts.length > 1 ? (
          <nav
            className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border/60 bg-background/55 p-3"
            aria-label="Artifact list"
          >
            <p className="px-1 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 uppercase">
              Thread artifacts
            </p>
            {artifacts.map((artifact) => (
              <button
                key={artifact.path}
                type="button"
                onClick={() => onSelectArtifact?.(artifact.path)}
                className={cn(
                  "group flex w-full flex-col rounded-xl border px-3 py-2.5 text-left transition-colors",
                  activeArtifactPath === artifact.path
                    ? "border-primary/30 bg-primary/8 text-foreground shadow-sm"
                    : "border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:bg-card/70 hover:text-foreground",
                )}
                title={artifact.relativePath}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <FileTextIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{artifact.title}</span>
                </span>
                <span className="mt-1 truncate pl-5 text-[11px] text-muted-foreground/75">
                  {artifact.relativePath}
                </span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground/75">
              <FolderOpenIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {artifactLocation ?? "Select an artifact to preview the document."}
              </span>
            </div>
            <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-card/92 p-5 shadow-[0_22px_50px_-34px_rgba(0,0,0,0.55)] backdrop-blur-xs">
              <ArtifactContent state={state} cwd={cwd} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ArtifactPanel() {
  const artifactPanelOpen = useUiStateStore((s) => s.artifactPanelOpen);
  const artifactPanelPath = useUiStateStore((s) => s.artifactPanelPath);
  const artifactPanelArtifacts = useUiStateStore((s) => s.artifactPanelArtifacts);
  const closeArtifactPanel = useUiStateStore((s) => s.closeArtifactPanel);
  const openArtifactPanel = useUiStateStore((s) => s.openArtifactPanel);
  const setDiscoveredArtifacts = useUiStateStore((s) => s.setDiscoveredArtifacts);

  // Resolve active thread's worktree path
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore((store) =>
    routeThreadId ? store.threads.find((t) => t.id === routeThreadId) : undefined,
  );
  const worktreePath = activeThread?.worktreePath ?? null;
  const contentState = useArtifactContentState(worktreePath, artifactPanelPath);

  // ── Discovery: refresh artifact list when the panel opens ──────────────────
  useEffect(() => {
    if (!artifactPanelOpen || !worktreePath) {
      return;
    }
    let cancelled = false;
    void discoverThreadArtifacts(worktreePath).then((artifacts) => {
      if (!cancelled) {
        setDiscoveredArtifacts(artifacts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artifactPanelOpen, worktreePath, setDiscoveredArtifacts]);

  // ── Open in editor ─────────────────────────────────────────────────────────
  const handleOpenInEditor = useCallback(() => {
    const api = readNativeApi();
    if (!api || !artifactPanelPath) return;
    void openInPreferredEditor(api, artifactPanelPath).catch(() => undefined);
  }, [artifactPanelPath]);

  const handlePopOut = useCallback(() => {
    if (!artifactPanelPath || typeof window === "undefined") {
      return;
    }

    const href = buildArtifactWindowHref({
      path: artifactPanelPath,
      worktreePath,
    });
    const popoutWindow = window.open(
      href,
      "_blank",
      "noopener,noreferrer,popup=yes,width=1240,height=920",
    );
    if (popoutWindow) {
      closeArtifactPanel();
    }
  }, [artifactPanelPath, closeArtifactPanel, worktreePath]);

  // ── Active artifact info ───────────────────────────────────────────────────
  const activeArtifact =
    artifactPanelPath != null
      ? (artifactPanelArtifacts.find((a) => a.path === artifactPanelPath) ?? null)
      : null;
  const panelTitle = resolveArtifactTitle(artifactPanelPath, activeArtifact);
  const activeCwd = resolveArtifactCwd(artifactPanelPath, activeThread?.worktreePath ?? null);

  return (
    <SidebarProvider
      defaultOpen={false}
      open={artifactPanelOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeArtifactPanel();
        }
      }}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": ARTIFACT_PANEL_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border/60 bg-transparent text-foreground"
        resizable={{
          maxWidth: ARTIFACT_PANEL_MAX_WIDTH,
          minWidth: ARTIFACT_PANEL_MIN_WIDTH,
          storageKey: ARTIFACT_PANEL_WIDTH_STORAGE_KEY,
        }}
      >
        <ArtifactViewerFrame
          activeArtifact={activeArtifact}
          activeArtifactPath={artifactPanelPath}
          artifacts={artifactPanelArtifacts}
          cwd={activeCwd}
          onClose={closeArtifactPanel}
          onOpenInEditor={artifactPanelPath ? handleOpenInEditor : undefined}
          onPopOut={artifactPanelPath ? handlePopOut : undefined}
          onSelectArtifact={openArtifactPanel}
          panelTitle={panelTitle}
          state={contentState}
        />
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
}

// ── ArtifactWindow ────────────────────────────────────────────────────────────

export interface ArtifactWindowProps {
  initialArtifactPath: string;
  initialWorktreePath: string | null;
}

export function ArtifactWindow({ initialArtifactPath, initialWorktreePath }: ArtifactWindowProps) {
  const [artifactPath, setArtifactPath] = useState(initialArtifactPath);
  const [artifacts, setArtifacts] = useState<DiscoveredArtifact[]>([]);
  const worktreePath = initialWorktreePath;
  const contentState = useArtifactContentState(worktreePath, artifactPath);

  useEffect(() => {
    setArtifactPath(initialArtifactPath);
  }, [initialArtifactPath]);

  useEffect(() => {
    if (!worktreePath) {
      setArtifacts([]);
      return;
    }

    let cancelled = false;
    void discoverThreadArtifacts(worktreePath).then((nextArtifacts) => {
      if (!cancelled) {
        setArtifacts(nextArtifacts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [worktreePath]);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.path === artifactPath) ?? null,
    [artifactPath, artifacts],
  );
  const panelTitle = resolveArtifactTitle(artifactPath, activeArtifact);
  const cwd = resolveArtifactCwd(artifactPath, worktreePath);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${panelTitle} · Artifact Viewer`;
    }
  }, [panelTitle]);

  const handleOpenInEditor = useCallback(() => {
    const api = readNativeApi();
    if (!api) return;
    void openInPreferredEditor(api, artifactPath).catch(() => undefined);
  }, [artifactPath]);

  return (
    <div className="h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground">
      <ArtifactViewerFrame
        activeArtifact={activeArtifact}
        activeArtifactPath={artifactPath}
        artifacts={artifacts}
        cwd={cwd}
        onOpenInEditor={handleOpenInEditor}
        onSelectArtifact={setArtifactPath}
        panelTitle={panelTitle}
        state={contentState}
      />
    </div>
  );
}

// ── ArtifactContent ───────────────────────────────────────────────────────────

export interface ArtifactContentProps {
  state: ContentState;
  cwd: string | undefined;
}

export function ArtifactContent({ state, cwd }: ArtifactContentProps) {
  if (state.status === "idle") {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/60 text-muted-foreground">
          <BookOpenIcon className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/80">Select an artifact to preview.</p>
          <p className="text-sm text-muted-foreground">
            Markdown documents from the current thread will render here.
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-4 p-1" role="status" aria-label="Loading artifact">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/3 rounded-full" />
        <Skeleton className="h-4 w-full rounded-full" />
        <Skeleton className="h-4 w-11/12 rounded-full" />
        <Skeleton className="h-4 w-9/12 rounded-full" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <span className="sr-only">Loading artifact content…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="rounded-2xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive shadow-xs"
        role="alert"
      >
        {state.message}
      </div>
    );
  }

  // loaded
  return <ChatMarkdown text={state.content} cwd={cwd} variant="document" />;
}
