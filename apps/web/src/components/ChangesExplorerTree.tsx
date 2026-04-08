import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  DiffIcon,
  FileIcon,
  FolderClosedIcon,
  FolderIcon,
  ListTodoIcon,
  NotebookTextIcon,
} from "lucide-react";
import { memo, useMemo, useState, type ComponentType, type ReactNode } from "react";

import type { ChangesSectionKind, DiscoveredFileReference } from "../changesDiscovery";
import {
  buildChangesExplorerTree,
  type ChangesExplorerStat,
  type ChangesExplorerTreeNode,
} from "../lib/changesExplorerTree";
import { getChangeKindTextClass } from "../lib/changeKindColor";
import { canonicalizeChangesPathForLookup, stripChangesBasePath } from "../lib/changesPath";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { DiffStatLabel, hasNonZeroStat } from "./chat/DiffStatLabel";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";

export const CHANGES_SECTION_ICON: Record<
  ChangesSectionKind,
  ComponentType<{ className?: string }>
> = {
  plans: ListTodoIcon,
  artifacts: BookOpenIcon,
  working_memory: NotebookTextIcon,
  files_changed: DiffIcon,
  changelog: ClipboardListIcon,
  reports: FileIcon,
};

interface ChangesExplorerTreeProps {
  groups: ReadonlyArray<{
    section: ChangesSectionKind;
    label: string;
    items: DiscoveredFileReference[];
  }>;
  activePath: string | null;
  activeSection: ChangesSectionKind | null;
  basePath: string | null;
  resolvedTheme: "light" | "dark";
  fileStatsByPath?: ReadonlyMap<string, ChangesExplorerStat | null>;
  fileKindsByPath: ReadonlyMap<string, string | undefined> | undefined;
  onSelectItem: (item: DiscoveredFileReference) => void;
}

function collectAncestorDirectoryPaths(
  pathValue: string | null,
  basePath: string | null,
): Set<string> {
  if (!pathValue) {
    return new Set();
  }

  const relativePath = stripChangesBasePath(pathValue, basePath).replace(/^\/+/, "");
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  const paths = new Set<string>();
  for (let index = 1; index < segments.length; index += 1) {
    paths.add(segments.slice(0, index).join("/"));
  }
  return paths;
}

function getSectionIcon(section: ChangesSectionKind) {
  return CHANGES_SECTION_ICON[section];
}

function renderTreeNode(
  node: ChangesExplorerTreeNode,
  depth: number,
  options: {
    activePath: string | null;
    activeDirectoryPaths: Set<string>;
    activeSection: ChangesSectionKind | null;
    collapsedSections: ReadonlySet<string>;
    collapsedDirectories: ReadonlySet<string>;
    onToggleSection: (section: string) => void;
    onToggleDirectory: (directoryPath: string) => void;
    onSelectItem: (item: DiscoveredFileReference) => void;
    resolvedTheme: "light" | "dark";
    fileKindsByPath: ReadonlyMap<string, string | undefined> | undefined;
  },
): ReactNode {
  const leftPadding = 8 + depth * 14;
  if (node.kind === "section") {
    const Icon = getSectionIcon(node.section);
    const isExpanded =
      !options.collapsedSections.has(node.section) || options.activeSection === node.section;

    return (
      <div key={`section:${node.section}`}>
        <Collapsible open={isExpanded}>
          <CollapsibleTrigger
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/40"
            onClick={() => options.onToggleSection(node.section)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/70">
              {isExpanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </span>
            <Icon className="size-3.5 shrink-0 text-muted-foreground/80" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
              {node.label}
            </span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {node.count}
            </span>
            {node.section === "files_changed" && hasNonZeroStat(node.stat) ? (
              <span className="ml-1 shrink-0 font-mono text-[10px] tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            ) : null}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-0.5 pb-1 pl-5">
              {node.children.map((child) =>
                renderTreeNode(child, depth + 1, {
                  ...options,
                  collapsedSections: options.collapsedSections,
                  fileKindsByPath: options.fileKindsByPath,
                }),
              )}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
    );
  }

  if (node.kind === "directory") {
    const isExpanded =
      !options.collapsedDirectories.has(node.path) || options.activeDirectoryPaths.has(node.path);

    return (
      <div key={`dir:${node.path}`}>
        <button
          type="button"
          className="group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
          style={{ paddingLeft: `${leftPadding}px` }}
          onClick={() => options.onToggleDirectory(node.path)}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
              isExpanded && "rotate-90",
            )}
          />
          {isExpanded ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          ) : (
            <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          )}
          <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
            {node.name}
          </span>
          {hasNonZeroStat(node.stat) ? (
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
              <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
            </span>
          ) : null}
        </button>
        {isExpanded && (
          <div className="space-y-0.5">
            {node.children.map((child) =>
              renderTreeNode(child, depth + 1, {
                ...options,
                collapsedSections: options.collapsedSections,
                fileKindsByPath: options.fileKindsByPath,
              }),
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      key={`file:${node.path}`}
      type="button"
      className={cn(
        "group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
        options.activePath === node.item.resolvedPath && "bg-primary/8 text-foreground",
      )}
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={() => options.onSelectItem(node.item)}
      title={node.item.resolvedPath}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <VscodeEntryIcon
        pathValue={node.path}
        kind="file"
        theme={options.resolvedTheme}
        className="size-3.5 text-muted-foreground/70"
      />
      <span
        className={cn(
          "truncate font-mono text-[11px]",
          getChangeKindTextClass(
            options.fileKindsByPath?.get(canonicalizeChangesPathForLookup(node.item.resolvedPath)),
          ),
        )}
      >
        {node.name}
      </span>
      {node.stat && hasNonZeroStat(node.stat) ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
          <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
        </span>
      ) : null}
    </button>
  );
}

export const ChangesExplorerTree = memo(function ChangesExplorerTree({
  groups,
  activePath,
  activeSection,
  basePath,
  resolvedTheme,
  fileStatsByPath,
  fileKindsByPath,
  onSelectItem,
}: ChangesExplorerTreeProps) {
  const tree = useMemo(
    () =>
      buildChangesExplorerTree(
        groups,
        fileStatsByPath ? { basePath, fileStatsByPath } : { basePath },
      ),
    [basePath, fileStatsByPath, groups],
  );
  const activeDirectoryPaths = useMemo(
    () => collectAncestorDirectoryPaths(activePath, basePath),
    [activePath, basePath],
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set<string>());
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    () => new Set<string>(),
  );

  const handleToggleSection = (section: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const handleToggleDirectory = (directoryPath: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  };

  if (tree.length === 0) {
    return null;
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) =>
        renderTreeNode(node, 0, {
          activePath,
          activeDirectoryPaths,
          activeSection,
          collapsedSections,
          collapsedDirectories,
          onToggleSection: handleToggleSection,
          onToggleDirectory: handleToggleDirectory,
          onSelectItem,
          resolvedTheme,
          fileKindsByPath,
        }),
      )}
    </div>
  );
});
