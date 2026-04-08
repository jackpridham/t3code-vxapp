import type {
  ChangesPanelGroup,
  ChangesSectionKind,
  DiscoveredFileReference,
} from "../changesDiscovery";

export interface ChangesExplorerStat {
  additions: number;
  deletions: number;
}

export interface ChangesExplorerSectionNode {
  kind: "section";
  section: ChangesSectionKind;
  label: string;
  path: string;
  count: number;
  stat: ChangesExplorerStat;
  children: ChangesExplorerTreeNode[];
}

export interface ChangesExplorerDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  stat: ChangesExplorerStat;
  children: ChangesExplorerTreeNode[];
}

export interface ChangesExplorerFileNode {
  kind: "file";
  name: string;
  path: string;
  stat: ChangesExplorerStat | null;
  item: DiscoveredFileReference;
}

export type ChangesExplorerTreeNode =
  | ChangesExplorerSectionNode
  | ChangesExplorerDirectoryNode
  | ChangesExplorerFileNode;

interface BuildOptions {
  basePath?: string | null;
  fileStatsByPath?: ReadonlyMap<string, ChangesExplorerStat | null>;
}

interface MutableDirectoryNode {
  name: string;
  path: string;
  stat: ChangesExplorerStat;
  directories: Map<string, MutableDirectoryNode>;
  files: ChangesExplorerFileNode[];
}

const SECTION_ORDER: ChangesSectionKind[] = [
  "plans",
  "artifacts",
  "working_memory",
  "files_changed",
  "changelog",
  "reports",
];

const SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function normalizePath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

function normalizePathKey(pathValue: string): string {
  return normalizePath(pathValue).replace(/\/+$/, "").toLowerCase();
}

function splitSegments(pathValue: string): string[] {
  return normalizePath(pathValue)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function stripBasePath(pathValue: string, basePath: string | null | undefined): string {
  const normalizedPath = normalizePath(pathValue);
  const normalizedBase = basePath ? normalizePath(basePath).replace(/\/+$/, "") : null;
  if (!normalizedBase) {
    return normalizedPath;
  }

  if (normalizedPath === normalizedBase) {
    return "";
  }
  const prefix = `${normalizedBase}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }

  return normalizedPath;
}

function compareByName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, SORT_OPTIONS);
}

function readStat(stat: ChangesExplorerStat | null | undefined): ChangesExplorerStat | null {
  if (!stat) {
    return null;
  }
  return {
    additions: stat.additions,
    deletions: stat.deletions,
  };
}

function mergeStat(target: ChangesExplorerStat, source: ChangesExplorerStat | null): void {
  if (!source) {
    return;
  }
  target.additions += source.additions;
  target.deletions += source.deletions;
}

function toDisplayNodes(directory: MutableDirectoryNode): ChangesExplorerTreeNode[] {
  const subdirectories: ChangesExplorerDirectoryNode[] = Array.from(directory.directories.values())
    .toSorted(compareByName)
    .map((subdirectory) => ({
      kind: "directory" as const,
      name: subdirectory.name,
      path: subdirectory.path,
      stat: {
        additions: subdirectory.stat.additions,
        deletions: subdirectory.stat.deletions,
      },
      children: toDisplayNodes(subdirectory),
    }));

  const files = directory.files.toSorted(compareByName);
  return [...subdirectories, ...files];
}

function createDirectoryNode(name: string, path: string): MutableDirectoryNode {
  return {
    name,
    path,
    stat: { additions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  };
}

function ensureDirectory(
  currentDirectory: MutableDirectoryNode,
  segment: string,
  nextPath: string,
): MutableDirectoryNode {
  const existing = currentDirectory.directories.get(segment);
  if (existing) {
    return existing;
  }
  const created = createDirectoryNode(segment, nextPath);
  currentDirectory.directories.set(segment, created);
  return created;
}

function readFileStat(
  item: DiscoveredFileReference,
  relativePath: string,
  fileStatsByPath: ReadonlyMap<string, ChangesExplorerStat | null> | undefined,
): ChangesExplorerStat | null {
  if (!fileStatsByPath) {
    return null;
  }
  return (
    readStat(fileStatsByPath.get(normalizePathKey(item.resolvedPath))) ??
    readStat(fileStatsByPath.get(normalizePathKey(relativePath))) ??
    null
  );
}

export function buildChangesExplorerTree(
  groups: ReadonlyArray<ChangesPanelGroup>,
  options: BuildOptions = {},
): ChangesExplorerSectionNode[] {
  const basePath = options.basePath ?? null;
  const fileStatsByPath = options.fileStatsByPath;

  return SECTION_ORDER.flatMap((section) => {
    const group = groups.find((entry) => entry.section === section);
    if (!group) {
      return [];
    }

    const root = createDirectoryNode("", section);
    for (const item of group.items) {
      const relativePath = stripBasePath(item.resolvedPath, basePath);
      const normalizedRelativePath = relativePath.replace(/^\/+/, "");
      const segments = splitSegments(normalizedRelativePath);
      if (segments.length === 0) {
        continue;
      }

      const fileName = segments.at(-1);
      if (!fileName) {
        continue;
      }

      const fileStat = readFileStat(item, relativePath, fileStatsByPath);
      const ancestors: MutableDirectoryNode[] = [root];
      let currentDirectory = root;

      for (const [index, segment] of segments.slice(0, -1).entries()) {
        const nextPath = segments.slice(0, index + 1).join("/");
        currentDirectory = ensureDirectory(currentDirectory, segment, nextPath);
        ancestors.push(currentDirectory);
      }

      currentDirectory.files.push({
        kind: "file",
        name: fileName,
        path: normalizePath(item.resolvedPath),
        stat: fileStat,
        item,
      });

      mergeStat(root.stat, fileStat);
      for (const ancestor of ancestors.slice(1)) {
        mergeStat(ancestor.stat, fileStat);
      }
    }

    return [
      {
        kind: "section" as const,
        section: group.section,
        label: group.label,
        path: group.section,
        count: group.items.length,
        stat: {
          additions: root.stat.additions,
          deletions: root.stat.deletions,
        },
        children: toDisplayNodes(root),
      },
    ];
  });
}
