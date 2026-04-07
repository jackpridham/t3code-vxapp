/**
 * ChangesPanel — Right-side panel showing categorized file references
 * from the current thread. Groups: Plans, Artifacts, Files Changed,
 * Changelog, Reports.
 *
 * Clicking a markdown file renders its content inline.
 * Clicking a code file delegates to the diff viewer via `onOpenFileDiff`.
 */
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DiffIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  ListTodoIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";

import type { ChangesSectionKind, DiscoveredFileReference } from "../changesDiscovery";
import { readArtifactContent } from "../artifactDiscovery";
import { useChangesDiscovery } from "../hooks/useChangesDiscovery";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "./ui/collapsible";
import { ArtifactContent, type ContentState } from "./ArtifactPanel";

// ── Section metadata ────────────────────────────────────────────────────────

const SECTION_ICON: Record<ChangesSectionKind, React.ComponentType<{ className?: string }>> = {
  plans: ListTodoIcon,
  artifacts: BookOpenIcon,
  files_changed: DiffIcon,
  changelog: ClipboardListIcon,
  reports: FileIcon,
};

const SECTION_ACCENT: Record<ChangesSectionKind, string> = {
  plans: "text-blue-400",
  artifacts: "text-purple-400",
  files_changed: "text-emerald-400",
  changelog: "text-amber-400",
  reports: "text-orange-400",
};

const SECTION_COUNT_BG: Record<ChangesSectionKind, string> = {
  plans: "bg-blue-500/10 text-blue-400",
  artifacts: "bg-purple-500/10 text-purple-400",
  files_changed: "bg-emerald-500/10 text-emerald-400",
  changelog: "bg-amber-500/10 text-amber-400",
  reports: "bg-orange-500/10 text-orange-400",
};

// ── Markdown content loading ────────────────────────────────────────────────

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function useMarkdownContentState(
  worktreePath: string | null,
  activePath: string | null,
  isMarkdownFile: boolean,
): ContentState {
  const [state, setState] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!activePath || !isMarkdownFile) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "loading" });
    let cancelled = false;

    void readArtifactContent(worktreePath, activePath)
      .then((content) => {
        if (!cancelled) {
          setState({ status: "loaded", content, path: activePath });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unable to load file.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePath, isMarkdownFile, worktreePath]);

  return state;
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface ChangesSectionHeaderProps {
  section: ChangesSectionKind;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

const ChangesSectionHeader = memo(function ChangesSectionHeader({
  section,
  label,
  count,
  expanded,
  onToggle,
}: ChangesSectionHeaderProps) {
  const Icon = SECTION_ICON[section];
  const accentClass = SECTION_ACCENT[section];
  const countClass = SECTION_COUNT_BG[section];

  return (
    <CollapsibleTrigger
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40"
      onClick={onToggle}
    >
      <span className={cn("flex size-5 shrink-0 items-center justify-center", accentClass)}>
        {expanded ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
      </span>
      <Icon className={cn("size-3.5 shrink-0", accentClass)} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
        {label}
      </span>
      {count > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            countClass,
          )}
        >
          {count}
        </span>
      )}
    </CollapsibleTrigger>
  );
});

interface ChangesSectionItemProps {
  item: DiscoveredFileReference;
  isActive: boolean;
  onClick: () => void;
}

const ChangesSectionItem = memo(function ChangesSectionItem({
  item,
  isActive,
  onClick,
}: ChangesSectionItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors",
        isActive
          ? "bg-primary/8 text-foreground"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
      )}
      title={item.resolvedPath}
    >
      <FileTextIcon className="size-3 shrink-0 opacity-50" />
      <span className="min-w-0 flex-1 truncate text-[12px]">{item.filename}</span>
    </button>
  );
});

// ── Main component ──────────────────────────────────────────────────────────

export interface ChangesPanelProps {
  /** Called when the user clicks a code file to view its diff. */
  onOpenFileDiff?: ((filePath: string) => void) | undefined;
}

export const ChangesPanel = memo(function ChangesPanel({ onOpenFileDiff }: ChangesPanelProps) {
  const changesPanelOpen = useUiStateStore((s) => s.changesPanelOpen);
  const activePath = useUiStateStore((s) => s.changesPanelActivePath);
  const closePanel = useUiStateStore((s) => s.closeChangesPanel);
  const setActivePath = useUiStateStore((s) => s.setChangesPanelActivePath);

  // Resolve active thread
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useStore((store) =>
    routeThreadId ? store.threads.find((t) => t.id === routeThreadId) : undefined,
  );
  const messages = activeThread?.messages ?? EMPTY_MESSAGES;
  const persistedFileChanges = activeThread?.persistedFileChanges ?? EMPTY_PERSISTED;
  const worktreePath = activeThread?.worktreePath ?? null;
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeProjectId ? store.projects.find((p) => p.id === activeProjectId) : undefined,
  );
  const cwd = worktreePath ?? activeProject?.cwd;

  // Discovery
  const groups = useChangesDiscovery(messages, persistedFileChanges, cwd);
  const nonEmptyGroups = useMemo(() => groups.filter((g) => g.items.length > 0), [groups]);

  // Section expand/collapse (local state — all non-empty sections start expanded)
  const [collapsedSections, setCollapsedSections] = useState<Set<ChangesSectionKind>>(new Set());
  const toggleSection = useCallback((section: ChangesSectionKind) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  // Markdown content viewer
  const isActivePathMarkdown = activePath ? isMarkdownPath(activePath) : false;
  const markdownState = useMarkdownContentState(worktreePath, activePath, isActivePathMarkdown);

  // Handle item click
  const handleItemClick = useCallback(
    (item: DiscoveredFileReference) => {
      if (item.section === "files_changed" && !isMarkdownPath(item.resolvedPath)) {
        // Code file -> delegate to diff viewer
        onOpenFileDiff?.(item.resolvedPath);
        return;
      }
      // Markdown or doc file -> load inline
      setActivePath(item.resolvedPath);
    },
    [onOpenFileDiff, setActivePath],
  );

  if (!changesPanelOpen) {
    return null;
  }

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="size-4 text-muted-foreground/70" />
          <span className="text-[13px] font-medium text-foreground/90">Changes</span>
          {totalCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {totalCount}
            </span>
          )}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={closePanel}
          aria-label="Close changes panel"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        {/* File list */}
        <div
          className={cn(
            "flex flex-col overflow-y-auto",
            activePath && isActivePathMarkdown
              ? "w-56 shrink-0 border-r border-border/50"
              : "min-w-0 flex-1",
          )}
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              {nonEmptyGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-[13px] text-muted-foreground/40">No file references found.</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/30">
                    References will appear as the conversation progresses.
                  </p>
                </div>
              ) : (
                nonEmptyGroups.map((group) => {
                  const isExpanded = !collapsedSections.has(group.section);
                  return (
                    <Collapsible key={group.section} defaultOpen open={isExpanded}>
                      <ChangesSectionHeader
                        section={group.section}
                        label={group.label}
                        count={group.items.length}
                        expanded={isExpanded}
                        onToggle={() => toggleSection(group.section)}
                      />
                      <CollapsiblePanel>
                        <div className="space-y-0.5 pb-1 pl-5">
                          {group.items.map((item) => (
                            <ChangesSectionItem
                              key={item.resolvedPath}
                              item={item}
                              isActive={activePath === item.resolvedPath}
                              onClick={() => handleItemClick(item)}
                            />
                          ))}
                        </div>
                      </CollapsiblePanel>
                    </Collapsible>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Inline content viewer (for markdown files) */}
        {activePath && isActivePathMarkdown && (
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto w-full max-w-3xl min-w-0">
              <div className="mb-3 flex items-center gap-2 px-1 text-[11px] font-medium text-muted-foreground/75">
                <FileTextIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {activePath.slice(Math.max(activePath.lastIndexOf("/") + 1, 0))}
                </span>
              </div>
              <div className="min-w-0 rounded-xl border border-border/70 bg-card/92 p-5 shadow-sm">
                <ArtifactContent state={markdownState} cwd={cwd} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Stable empty references (avoid re-renders) ─────────────────────────────

const EMPTY_MESSAGES: readonly [] = [];
const EMPTY_PERSISTED: readonly [] = [];
