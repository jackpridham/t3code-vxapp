import { useQuery } from "@tanstack/react-query";
import { BotIcon, ChevronDownIcon, ChevronRightIcon, HardHatIcon, Layers3Icon } from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import { ChangesPanel } from "../ChangesPanel";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";
import { inferCheckpointTurnCountByTurnId } from "../../session-logic";
import { useStore } from "../../store";
import { useUiStateStore } from "../../uiStateStore";
import { projectSearchEntriesQueryOptions } from "../../lib/projectReactQuery";
import { resolveChangesAbsolutePath } from "../../lib/changesPath";
import { buildOrchestrationModeRowDescriptor } from "../../lib/orchestrationMode";
import {
  collectIdeDrawerThreads,
  resolveIdeExplorerRoot,
  type IdeExplorerSection,
} from "../../lib/ide";
import { serverConfigQueryOptions } from "../../lib/serverReactQuery";
import { cn } from "../../lib/utils";
import { WorkspaceExplorerTree } from "./WorkspaceExplorerTree";
import { ideShortcutLabelForCommand } from "./ideShortcuts";
import { useTheme } from "../../hooks/useTheme";
import { type ThreadId as ThreadIdType } from "@t3tools/contracts";
import type { TurnDiffSummary } from "../../types";

function resolveLatestCheckpointTurnCount(
  turnDiffSummaries: readonly TurnDiffSummary[],
): number | null {
  const inferredCheckpointTurnCountByTurnId = inferCheckpointTurnCountByTurnId([
    ...turnDiffSummaries,
  ]);
  const turnCounts = turnDiffSummaries
    .map(
      (summary) =>
        summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
    )
    .filter((value): value is number => typeof value === "number");
  if (turnCounts.length === 0) {
    return null;
  }
  return Math.max(...turnCounts);
}

function ExplorerSidebarSection(props: {
  expanded: boolean;
  shortcutLabel: string | null;
  title: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={props.expanded}>
      <CollapsibleTrigger
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40"
        onClick={props.onToggle}
      >
        {props.expanded ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">
          {props.title}
        </span>
        {props.shortcutLabel ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {props.shortcutLabel}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="border-l border-border/50 pl-2">{props.children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

interface ExplorerSidebarProps {
  threadId: ThreadIdType;
}

export const ExplorerSidebar = memo(function ExplorerSidebar({ threadId }: ExplorerSidebarProps) {
  const { resolvedTheme } = useTheme();
  const activeThread = useStore((store) => store.threads.find((thread) => thread.id === threadId));
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const keybindings = useQuery(serverConfigQueryOptions()).data?.keybindings ?? [];
  const expandedSections = useUiStateStore((state) => state.ideExplorerExpandedSections);
  const toggleSection = useUiStateStore((state) => state.toggleIdeExplorerSection);
  const setIdeSelectedFile = useUiStateStore((state) => state.setIdeSelectedFile);
  const setIdeSelectedDrawerThreadId = useUiStateStore(
    (state) => state.setIdeSelectedDrawerThreadId,
  );
  const setIdeChatDrawerOpen = useUiStateStore((state) => state.setIdeChatDrawerOpen);
  const selectedDrawerThreadId = useUiStateStore((state) => state.ideSelectedDrawerThreadId);
  const selectedRelativePath = useUiStateStore(
    (state) => state.ideSelectedFile?.relativePath ?? null,
  );

  const explorerRoot = useMemo(
    () =>
      resolveIdeExplorerRoot({
        activeThreadId: threadId,
        projects,
        threads,
      }),
    [projects, threadId, threads],
  );
  const activeWorktreePath = explorerRoot.cwd;
  const explorerEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: activeWorktreePath,
      query: "",
      limit: 200,
      enabled: activeWorktreePath !== null,
    }),
  );
  const threadRows = useMemo(
    () =>
      activeThread
        ? collectIdeDrawerThreads({
            activeThreadId: activeThread.id,
            projects,
            threads,
          })
        : [],
    [activeThread, projects, threads],
  );
  const latestCheckpointTurnCount = useMemo(
    () => resolveLatestCheckpointTurnCount(activeThread?.turnDiffSummaries ?? []),
    [activeThread?.turnDiffSummaries],
  );

  const shortcutLabel = (command: Parameters<typeof ideShortcutLabelForCommand>[1]) =>
    ideShortcutLabelForCommand(keybindings, command, {
      context: { ideMode: true, terminalFocus: false, terminalOpen: false },
    });

  const handleSelectWorkspacePath = (relativePath: string) => {
    if (!activeWorktreePath) {
      return;
    }
    const absolutePath = resolveChangesAbsolutePath(activeWorktreePath, relativePath);
    const fileName = relativePath.split("/").at(-1) ?? relativePath;
    setIdeSelectedFile({
      absolutePath,
      relativePath,
      displayPath: relativePath,
      fileName,
      source: "explorer",
      section: "explorer",
      threadId: activeThread?.id ?? null,
      worktreePath: activeWorktreePath,
      sourcePath: relativePath,
      latestCheckpointTurnCount,
    });
  };

  const openThreadInDrawer = (targetThreadId: ThreadIdType) => {
    setIdeSelectedDrawerThreadId(targetThreadId);
    setIdeChatDrawerOpen(true);
  };

  const isExpanded = (section: IdeExplorerSection) => expandedSections.includes(section);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Layers3Icon className="size-4 text-muted-foreground/70" />
        <span className="truncate text-sm font-medium">
          Explorer {explorerRoot.projectName ? `· ${explorerRoot.projectName}` : ""}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-2">
          <ExplorerSidebarSection
            expanded={isExpanded("changes")}
            shortcutLabel={shortcutLabel("ide.changes.focus")}
            title="Changes"
            onToggle={() => toggleSection("changes")}
          >
            <div className="py-1">
              <ChangesPanel onReferenceSelect={setIdeSelectedFile} showHeader={false} />
            </div>
          </ExplorerSidebarSection>

          <ExplorerSidebarSection
            expanded={isExpanded("explorer")}
            shortcutLabel={shortcutLabel("ide.explorer.toggle")}
            title="Explorer"
            onToggle={() => toggleSection("explorer")}
          >
            <div className="py-1">
              {explorerEntriesQuery.data?.entries.length ? (
                <WorkspaceExplorerTree
                  activePath={selectedRelativePath}
                  entries={explorerEntriesQuery.data.entries}
                  resolvedTheme={resolvedTheme}
                  onSelectPath={handleSelectWorkspacePath}
                />
              ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {activeWorktreePath
                    ? "No workspace files available."
                    : "No workspace is available for this thread."}
                </div>
              )}
            </div>
          </ExplorerSidebarSection>

          <ExplorerSidebarSection
            expanded={isExpanded("threads")}
            shortcutLabel={shortcutLabel("ide.threads.focus")}
            title="Threads"
            onToggle={() => toggleSection("threads")}
          >
            <div className="space-y-1 py-1">
              {threadRows.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No active threads for this project.
                </div>
              ) : (
                threadRows.map((thread) => {
                  const descriptor = buildOrchestrationModeRowDescriptor({ thread });
                  const isActive = (selectedDrawerThreadId ?? threadId) === thread.id;
                  const isWorker = thread.spawnRole === "worker";
                  const isRunning = thread.session?.status === "running";
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/40",
                        isActive && "bg-primary/8",
                      )}
                      onClick={() => openThreadInDrawer(thread.id)}
                      aria-label={descriptor.accessibleTitle}
                    >
                      <div className="mt-0.5 flex items-center gap-1">
                        {isWorker ? (
                          <HardHatIcon className="size-3.5 text-amber-500" />
                        ) : (
                          <BotIcon className="size-3.5 text-sky-500" />
                        )}
                        {isRunning ? (
                          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {isWorker ? null : (
                          <div className="truncate text-xs font-medium text-foreground/90">
                            {thread.title}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-1">
                          {descriptor.visibleBadges.map((badge) => (
                            <Badge
                              key={badge.key}
                              variant="outline"
                              className="h-4 min-w-0 max-w-24 px-1 text-[9px] leading-none text-muted-foreground/80"
                              title={isWorker ? `${thread.title} · ${badge.label}` : badge.label}
                            >
                              <span className="truncate">{badge.label}</span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ExplorerSidebarSection>
        </div>
      </ScrollArea>
    </div>
  );
});
