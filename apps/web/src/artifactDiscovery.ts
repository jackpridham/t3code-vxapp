/**
 * artifactDiscovery — Artifact link extraction and thread-based discovery.
 *
 * Artifacts are markdown files managed by the `vx agents artifacts` CLI,
 * stored under `@Docs/@Scratch/{repo}/` relative to the thread's worktree.
 */

import { readNativeApi } from "./nativeApi";
import { readWorkspaceFileContent } from "./lib/workspaceFileContent";

export interface DiscoveredArtifact {
  /** Absolute path to the markdown file. */
  path: string;
  /** Extracted from first # heading, or derived from filename. */
  title: string;
  /** Which repo it belongs to (last path component of worktreePath). */
  repo: string;
  /** Relative path from the worktree root. */
  relativePath: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Path prefix (relative to worktree) where Vortex artifacts live. */
const SCRATCH_DIR_PREFIX = "@Docs/@Scratch";

/** Max search results when discovering artifacts. */
const DISCOVERY_SEARCH_LIMIT = 50;

// ── Link extraction ───────────────────────────────────────────────────────────

/**
 * Matches file:///... URLs with a .md extension.
 * Tolerant of URL-encoded characters in the path.
 */
const FILE_URL_MD_PATTERN = /file:\/\/\/[^\s)"'>\]]+\.md(?:[^\s)"'>\]]*)?/gi;

/**
 * Matches bare @Docs/@Scratch/... paths (written by the vx CLI in agent output).
 */
const SCRATCH_BARE_PATH_PATTERN = /@Docs\/@Scratch\/[^\s)"'>\]]+\.md/gi;

/**
 * Matches markdown link targets: [text](path.md) or [text](file:///...)
 */
const MD_LINK_TARGET_PATTERN = /\[[^\]]*\]\(([^)]+\.md[^)]*)\)/gi;

/**
 * Extract markdown file references from message content.
 *
 * Looks for:
 * - `file:///path/to/*.md` links
 * - `@Docs/@Scratch/` paths in plain text
 * - Markdown `[label](path.md)` links where the target is a .md file
 *
 * Returns a deduplicated array of raw href strings (not resolved to absolute paths).
 */
export function extractArtifactLinks(messageText: string): string[] {
  const found = new Set<string>();

  // 1. file:/// URLs
  for (const match of messageText.matchAll(FILE_URL_MD_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  // 2. Bare @Docs/@Scratch/... paths
  for (const match of messageText.matchAll(SCRATCH_BARE_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  // 3. Markdown link targets ending in .md
  for (const match of messageText.matchAll(MD_LINK_TARGET_PATTERN)) {
    const target = match[1]?.trim();
    if (target) found.add(target);
  }

  return Array.from(found);
}

// ── Title extraction ──────────────────────────────────────────────────────────

/**
 * Extract the title from markdown content.
 *
 * Returns the text of the first ATX heading (`# Title`), or falls back to
 * deriving a human-readable title from the filename.
 */
export function extractTitleFromMarkdown(content: string, filename: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      const heading = trimmed.slice(2).trim();
      if (heading.length > 0) {
        return heading;
      }
    }
    // Stop at the first non-blank line that isn't a heading
    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      break;
    }
  }
  return titleFromFilename(filename);
}

/**
 * Derive a human-readable title from a filename.
 * Strips `.md` extension, converts underscores/hyphens to spaces, title-cases.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.md$/i, "");
  return base.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// ── Thread-based discovery ────────────────────────────────────────────────────

function basenameOf(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}

function repoNameFromWorktreePath(worktreePath: string): string {
  return basenameOf(worktreePath.replace(/[/\\]+$/, ""));
}

/**
 * Given a thread's worktree path, discover artifacts stored under
 * `@Docs/@Scratch/{repoName}/` relative to that path.
 *
 * Uses the `projects.searchEntries` API to enumerate markdown files in the
 * scratch directory without requiring a separate readdir RPC.
 *
 * Returns an empty array if the native API is unavailable or discovery fails.
 */
export async function discoverThreadArtifacts(worktreePath: string): Promise<DiscoveredArtifact[]> {
  const api = readNativeApi();
  if (!api) return [];

  const repoName = repoNameFromWorktreePath(worktreePath);
  const searchQuery = `${SCRATCH_DIR_PREFIX}/${repoName}`;

  let entries: ReadonlyArray<{ readonly path: string; readonly kind: string }>;
  try {
    const result = await api.projects.searchEntries({
      cwd: worktreePath,
      query: searchQuery,
      limit: DISCOVERY_SEARCH_LIMIT,
      includeIgnored: true,
    });
    entries = result.entries;
  } catch {
    return [];
  }

  // Keep only .md files within the expected scratch path for this repo
  const expectedPrefix = `${SCRATCH_DIR_PREFIX}/${repoName}/`;
  const mdEntries = entries.filter(
    (e) =>
      e.kind === "file" &&
      e.path.toLowerCase().endsWith(".md") &&
      e.path.startsWith(expectedPrefix),
  );

  const artifacts: DiscoveredArtifact[] = [];
  for (const entry of mdEntries) {
    const absolutePath = worktreePath.replace(/[/\\]+$/, "") + "/" + entry.path;
    const filename = basenameOf(entry.path);
    artifacts.push({
      path: absolutePath,
      title: titleFromFilename(filename),
      repo: repoName,
      relativePath: entry.path,
    });
  }

  return artifacts;
}

// ── Content loading ───────────────────────────────────────────────────────────

export async function readArtifactContent(
  worktreePath: string | null,
  absolutePath: string,
): Promise<string> {
  return readWorkspaceFileContent({ worktreePath, absolutePath });
}
