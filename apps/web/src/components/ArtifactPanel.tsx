/**
 * ArtifactPanel — Slide-out viewer for thread markdown artifacts.
 *
 * Discovers and renders `.md` files stored under `@Docs/@Scratch/{repo}/`
 * relative to the active thread's worktree. Follows the Sheet-based
 * slide-out panel pattern used by DiffPanel.
 */
import { BookOpenIcon, ExternalLinkIcon, FileTextIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { openInPreferredEditor } from "../editorPreferences";
import { readNativeApi } from "../nativeApi";
import {
  discoverThreadArtifacts,
  readArtifactContent,
  type DiscoveredArtifact,
} from "../artifactDiscovery";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import ChatMarkdown from "./ChatMarkdown";
import {
  Sheet,
  SheetClose,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { cn } from "~/lib/utils";

// ── Internal types ────────────────────────────────────────────────────────────

export type ContentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; content: string; path: string }
  | { status: "error"; message: string };

// ── ArtifactPanel ─────────────────────────────────────────────────────────────

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

  // Content loading state
  const [contentState, setContentState] = useState<ContentState>({ status: "idle" });

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

  // ── Content loading: load artifact when path changes ──────────────────────
  useEffect(() => {
    if (!artifactPanelPath || !worktreePath) {
      setContentState({ status: "idle" });
      return;
    }

    const path = artifactPanelPath;
    const wt = worktreePath;
    setContentState({ status: "loading" });

    let cancelled = false;
    void readArtifactContent(wt, path)
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
  }, [artifactPanelPath, worktreePath]);

  // ── Open in editor ─────────────────────────────────────────────────────────
  const handleOpenInEditor = useCallback(() => {
    const api = readNativeApi();
    if (!api || !artifactPanelPath) return;
    void openInPreferredEditor(api, artifactPanelPath).catch(() => undefined);
  }, [artifactPanelPath]);

  // ── Active artifact info ───────────────────────────────────────────────────
  const activeArtifact =
    artifactPanelPath != null
      ? (artifactPanelArtifacts.find((a) => a.path === artifactPanelPath) ?? null)
      : null;

  const panelTitle = activeArtifact?.title ?? "Artifact";
  const activeCwd =
    activeThread?.worktreePath ?? (activeThread ? undefined : undefined);

  return (
    <Sheet open={artifactPanelOpen} onOpenChange={(open) => !open && closeArtifactPanel()}>
      <SheetPopup side="right" showCloseButton={false} className="max-w-2xl w-full">
        <SheetHeader className="border-b border-border pb-3 pt-4">
          <div className="flex items-center justify-between gap-2 pr-2">
            <div className="flex min-w-0 items-center gap-2">
              <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
              <SheetTitle className="truncate text-base">{panelTitle}</SheetTitle>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {artifactPanelPath && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Open in editor"
                  aria-label="Open artifact in editor"
                  onClick={handleOpenInEditor}
                  className="size-7"
                >
                  <ExternalLinkIcon className="size-4" />
                </Button>
              )}
              <SheetClose
                render={
                  <Button size="icon" variant="ghost" aria-label="Close artifact panel" className="size-7">
                    <XIcon className="size-4" />
                  </Button>
                }
              />
            </div>
          </div>
        </SheetHeader>

        {/* Artifact list + content split */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Artifact list sidebar */}
          {artifactPanelArtifacts.length > 1 && (
            <nav
              className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2"
              aria-label="Artifact list"
            >
              {artifactPanelArtifacts.map((artifact) => (
                <button
                  key={artifact.path}
                  type="button"
                  onClick={() => openArtifactPanel(artifact.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    artifactPanelPath === artifact.path
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={artifact.relativePath}
                >
                  <FileTextIcon className="size-3 shrink-0" />
                  <span className="truncate">{artifact.title}</span>
                </button>
              ))}
            </nav>
          )}

          {/* Content area */}
          <SheetPanel className="flex-1 overflow-y-auto" scrollFade>
            <ArtifactContent state={contentState} cwd={activeCwd ?? undefined} />
          </SheetPanel>
        </div>
      </SheetPopup>
    </Sheet>
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
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Select an artifact to view its contents.
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-3 p-1" role="status" aria-label="Loading artifact">
        <Skeleton className="h-6 w-2/3 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-10/12 rounded-md" />
        <Skeleton className="h-4 w-11/12 rounded-md" />
        <span className="sr-only">Loading artifact content…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        {state.message}
      </div>
    );
  }

  // loaded
  return <ChatMarkdown text={state.content} cwd={cwd} />;
}
