/**
 * submoduleDiscovery — Parse .gitmodules to discover submodule paths
 * and query submodule git status for changed files.
 */
import { readNativeApi } from "../nativeApi";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SubmoduleEntry {
  /** Submodule name (from [submodule "name"]). */
  name: string;
  /** Relative path to the submodule directory. */
  path: string;
  /** Remote URL, if available. */
  url?: string;
}

export interface SubmoduleFileChange {
  /** File path relative to the MAIN repo root (e.g., "@Docs/path/to/file.md"). */
  path: string;
  /** Insertions count. */
  insertions: number;
  /** Deletions count. */
  deletions: number;
  /** Which submodule this file belongs to. */
  submoduleName: string;
  /** Submodule path relative to repo root. */
  submodulePath: string;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Regex to match [submodule "name"] sections in .gitmodules.
 * Captures: name, then the section body (indented key=value lines).
 */
const SUBMODULE_SECTION_PATTERN = /\[submodule\s+"([^"]+)"\]\s*\r?\n((?:\s+[a-z]+ = .+\r?\n?)*)/gi;
const PATH_LINE_PATTERN = /^\s*path\s*=\s*(.+)$/m;
const URL_LINE_PATTERN = /^\s*url\s*=\s*(.+)$/m;

/**
 * Parse .gitmodules file content into SubmoduleEntry objects.
 * Pure function — no I/O.
 */
export function parseGitmodules(content: string): SubmoduleEntry[] {
  const entries: SubmoduleEntry[] = [];

  for (const match of content.matchAll(SUBMODULE_SECTION_PATTERN)) {
    const name = match[1];
    const body = match[2] ?? "";

    if (!name) continue;

    const pathMatch = body.match(PATH_LINE_PATTERN);
    const path = pathMatch?.[1]?.trim();
    if (!path) continue;

    const urlMatch = body.match(URL_LINE_PATTERN);
    const url = urlMatch?.[1]?.trim();

    entries.push({
      name,
      path,
      ...(url ? { url } : {}),
    });
  }

  return entries;
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Discover submodule paths for a given project root.
 * Reads .gitmodules using the native file API.
 *
 * Returns an empty array if:
 * - The native API is unavailable
 * - .gitmodules doesn't exist
 * - Parsing fails
 */
export async function discoverSubmodulePaths(cwd: string): Promise<SubmoduleEntry[]> {
  const api = readNativeApi();
  if (!api) return [];

  try {
    const result = await api.projects.readFile({
      cwd,
      relativePath: ".gitmodules",
    });
    return parseGitmodules(result.content);
  } catch {
    // .gitmodules doesn't exist or can't be read
    return [];
  }
}

// ── Status query ────────────────────────────────────────────────────────────

/**
 * Get changed files from all submodules.
 * For each submodule, runs git status and maps file paths to be
 * relative to the parent repo root.
 *
 * @param cwd — Parent repo working directory
 * @param submodules — Discovered submodule entries
 */
export async function getSubmoduleChangedFiles(
  cwd: string,
  submodules: readonly SubmoduleEntry[],
): Promise<SubmoduleFileChange[]> {
  const api = readNativeApi();
  if (!api || submodules.length === 0) return [];

  const normalizedCwd = cwd.replace(/[/\\]+$/, "");
  const allChanges: SubmoduleFileChange[] = [];

  // Query each submodule in parallel
  const results = await Promise.allSettled(
    submodules.map(async (sub) => {
      const submoduleCwd = `${normalizedCwd}/${sub.path}`;
      try {
        const status = await api.git.status({ cwd: submoduleCwd });
        return { sub, status };
      } catch {
        return { sub, status: null };
      }
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { sub, status } = result.value;
    if (!status?.hasWorkingTreeChanges) continue;

    for (const file of status.workingTree.files) {
      allChanges.push({
        // Prefix file path with submodule path so it's relative to parent repo
        path: `${sub.path}/${file.path}`,
        insertions: file.insertions,
        deletions: file.deletions,
        submoduleName: sub.name,
        submodulePath: sub.path,
      });
    }
  }

  return allChanges;
}
