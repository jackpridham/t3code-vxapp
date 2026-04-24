import { type ProjectEntry } from "@t3tools/contracts";
import { ChevronRightIcon, FolderClosedIcon, FolderIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { cn } from "../../lib/utils";

interface WorkspaceExplorerNode {
  kind: "directory" | "file";
  name: string;
  path: string;
  children?: WorkspaceExplorerNode[];
}

function compareByName(left: WorkspaceExplorerNode, right: WorkspaceExplorerNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function buildWorkspaceExplorerTree(entries: readonly ProjectEntry[]): WorkspaceExplorerNode[] {
  type MutableDirectoryNode = WorkspaceExplorerNode & {
    kind: "directory";
    children: WorkspaceExplorerNode[];
    directories: Map<string, MutableDirectoryNode>;
  };

  const root: MutableDirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    children: [],
    directories: new Map(),
  };

  const ensureDirectory = (pathValue: string) => {
    const segments = pathValue.split("/").filter((segment) => segment.length > 0);
    let current = root;
    for (const [index, segment] of segments.entries()) {
      const nextPath = segments.slice(0, index + 1).join("/");
      const existing = current.directories.get(segment);
      if (existing) {
        current = existing;
        continue;
      }
      const created: MutableDirectoryNode = {
        kind: "directory",
        name: segment,
        path: nextPath,
        children: [],
        directories: new Map(),
      };
      current.directories.set(segment, created);
      current.children.push(created);
      current = created;
    }
    return current;
  };

  for (const entry of entries) {
    if (entry.kind === "directory") {
      ensureDirectory(entry.path);
      continue;
    }

    const segments = entry.path.split("/").filter((segment) => segment.length > 0);
    const fileName = segments.at(-1);
    if (!fileName) {
      continue;
    }
    const parentPath = segments.slice(0, -1).join("/");
    const directory = ensureDirectory(parentPath);
    directory.children.push({
      kind: "file",
      name: fileName,
      path: entry.path,
    });
  }

  const sortNode = (node: WorkspaceExplorerNode): WorkspaceExplorerNode => {
    if (node.kind === "file") {
      return node;
    }
    return {
      kind: "directory",
      name: node.name,
      path: node.path,
      children: (node.children ?? []).map(sortNode).toSorted(compareByName),
    };
  };

  return root.children.map(sortNode).toSorted(compareByName);
}

function collectAncestorPaths(pathValue: string | null): Set<string> {
  if (!pathValue) {
    return new Set();
  }
  const segments = pathValue.split("/").filter((segment) => segment.length > 0);
  const ancestors = new Set<string>();
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.add(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

interface WorkspaceExplorerTreeProps {
  activePath: string | null;
  entries: readonly ProjectEntry[];
  resolvedTheme: "light" | "dark";
  onSelectPath: (relativePath: string) => void;
}

export const WorkspaceExplorerTree = memo(function WorkspaceExplorerTree({
  activePath,
  entries,
  resolvedTheme,
  onSelectPath,
}: WorkspaceExplorerTreeProps) {
  const tree = useMemo(() => buildWorkspaceExplorerTree(entries), [entries]);
  const activeAncestorPaths = useMemo(() => collectAncestorPaths(activePath), [activePath]);
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(new Set());

  const toggleDirectory = (pathValue: string) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(pathValue)) {
        next.delete(pathValue);
      } else {
        next.add(pathValue);
      }
      return next;
    });
  };

  const renderNode = (node: WorkspaceExplorerNode, depth: number) => {
    if (node.kind === "directory") {
      const isExpanded = !collapsedDirectories.has(node.path) || activeAncestorPaths.has(node.path);
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
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
          </button>
          {isExpanded ? (
            <div>{node.children?.map((child) => renderNode(child, depth + 1))}</div>
          ) : null}
        </div>
      );
    }

    return (
      <button
        key={`file:${node.path}`}
        type="button"
        className={cn(
          "group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80",
          activePath === node.path && "bg-primary/8 text-foreground",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelectPath(node.path)}
        title={node.path}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <VscodeEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 shrink-0 text-muted-foreground/70"
        />
        <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
          {node.name}
        </span>
      </button>
    );
  };

  return <div className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</div>;
});
