/**
 * changesDiscovery — Scan chat messages for file references and categorize
 * them into groups for the Changes panel.
 *
 * Groups: Plans, Artifacts, Working Memory, Files Changed, Changelog, Reports.
 */

import type { ChatMessage } from "./types";
import {
  basenameOfChangesPath,
  canonicalizeChangesPathForLookup,
  cleanDiscoveredChangesRawRef,
  isAbsoluteChangesPath,
  normalizeChangesPath,
  resolveChangesAbsolutePath,
} from "./lib/changesPath";

// ── Types ────────────────────────────────────────────────────────────────────

/** Which section a discovered file belongs to. */
export type ChangesSectionKind =
  | "plans"
  | "artifacts"
  | "working_memory"
  | "files_changed"
  | "changelog"
  | "reports";

/** A single file reference discovered in chat messages. */
export interface DiscoveredFileReference {
  /** The raw href or path as it appeared in the message. */
  rawRef: string;
  /** Resolved absolute path (when cwd is available), or the cleaned relative path. */
  resolvedPath: string;
  /** Filename only (basename). */
  filename: string;
  /** Which section this file belongs to. */
  section: ChangesSectionKind;
  /** MessageId of the first message that referenced this file. */
  firstSeenMessageId: string;
}

/** A group of file references for one section of the Changes panel. */
export interface ChangesPanelGroup {
  section: ChangesSectionKind;
  label: string;
  items: DiscoveredFileReference[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Section display labels and sort order. */
const SECTION_CONFIG: ReadonlyArray<{
  section: ChangesSectionKind;
  label: string;
}> = [
  { section: "plans", label: "Plans" },
  { section: "artifacts", label: "Artifacts" },
  { section: "working_memory", label: "Working Memory" },
  { section: "files_changed", label: "Files Changed" },
  { section: "changelog", label: "Changelog" },
  { section: "reports", label: "Reports" },
];

// ── Extraction patterns ──────────────────────────────────────────────────────

/** file:/// URLs with any extension. */
const FILE_URL_PATTERN = /file:\/\/\/[^\s)"'>`\]]+\.[A-Za-z0-9_-]+/gi;

/** @Docs/@TODO/ paths (plans, TODOs). */
const TODO_PATH_PATTERN = /@Docs\/@TODO\/[^\s)"'>`\]]+/gi;

/** @Docs/@Scratch/ paths (artifacts). */
const SCRATCH_PATH_PATTERN = /@Docs\/@Scratch\/[^\s)"'>`\]]+/gi;

/** @Docs/@CHANGELOG/ paths. */
const CHANGELOG_PATH_PATTERN = /@Docs\/@CHANGELOG\/[^\s)"'>`\]]+/gi;

/** @Docs/@Reports/ paths. */
const REPORTS_PATH_PATTERN = /@Docs\/@Reports\/[^\s)"'>`\]]+/gi;

/** Working memory markdown files. */
const WORKING_MEMORY_PATH_PATTERN = /[^\s)"'>`\]]*memory\/working_[^\s)"'>`\]]+\.md/gi;

/** Markdown link targets: [text](path.ext) */
const MD_LINK_PATTERN = /\[[^\]]*\]\(([^)]+\.[A-Za-z0-9_-]+(?:[^)]*)?)\)/gi;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveReferencePath(rawPath: string, cwd: string | undefined): string {
  const normalizedRawPath = normalizeChangesPath(rawPath);
  if (!cwd || isAbsoluteChangesPath(normalizedRawPath)) {
    return normalizedRawPath;
  }

  return resolveChangesAbsolutePath(cwd, normalizedRawPath);
}

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Extract raw file reference strings from a single message's text.
 * Returns a deduplicated array of raw href strings.
 */
export function extractFileReferences(messageText: string): string[] {
  const found = new Set<string>();

  for (const match of messageText.matchAll(FILE_URL_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(TODO_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(SCRATCH_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(CHANGELOG_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(REPORTS_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(WORKING_MEMORY_PATH_PATTERN)) {
    const raw = match[0].trim();
    if (raw) found.add(raw);
  }

  for (const match of messageText.matchAll(MD_LINK_PATTERN)) {
    const target = match[1]?.trim();
    if (target && !target.startsWith("http://") && !target.startsWith("https://")) {
      found.add(target);
    }
  }

  return Array.from(found);
}

// ── Categorization ───────────────────────────────────────────────────────────

/** Determine which section a file reference belongs to. */
export function categorizeReference(cleanedPath: string): ChangesSectionKind {
  const lower = cleanedPath.toLowerCase();
  const filename = basenameOfChangesPath(cleanedPath).toLowerCase();

  // Plans: files in @TODO directories, or matching PLAN_*.md / TODO_*.md / PHASE_*.md patterns
  if (lower.includes("@todo/") || lower.includes("/@todo/")) {
    return "plans";
  }
  if (filename.startsWith("plan_") && filename.endsWith(".md")) {
    return "plans";
  }
  if (filename.startsWith("todo_") && filename.endsWith(".md")) {
    return "plans";
  }
  if (filename.startsWith("phase_") && filename.endsWith(".md")) {
    return "plans";
  }

  // Changelog: files in @CHANGELOG or matching CHANGELOG_*.md
  if (lower.includes("@changelog/") || lower.includes("/@changelog/")) {
    return "changelog";
  }
  if (filename.startsWith("changelog_") && filename.endsWith(".md")) {
    return "changelog";
  }
  if (filename === "changelog.md") {
    return "changelog";
  }

  // Reports: files in @Reports or matching REPORT_*.md
  if (lower.includes("@reports/") || lower.includes("/@reports/")) {
    return "reports";
  }
  if (filename.startsWith("report_") && filename.endsWith(".md")) {
    return "reports";
  }

  // Artifacts: files in @Scratch directory
  if (lower.includes("@scratch/") || lower.includes("/@scratch/")) {
    return "artifacts";
  }

  if (lower.includes("/memory/working_") && filename.endsWith(".md")) {
    return "working_memory";
  }

  // Other .md files that don't match above patterns — artifacts (loose docs)
  if (filename.endsWith(".md")) {
    return "artifacts";
  }

  // Everything else is a code file → files_changed
  return "files_changed";
}

// ── Main discovery function ──────────────────────────────────────────────────

/**
 * Scan all chat messages and produce categorized file reference groups
 * for the Changes panel.
 *
 * @param messages — Thread messages to scan
 * @param _cwd — Optional working directory for resolving relative paths (reserved for future use)
 * @returns Array of ChangesPanelGroup in display order. Empty sections are included
 *          with `items: []` so the caller can decide whether to render them.
 */
export function discoverChangesReferences(
  messages: readonly ChatMessage[],
  _cwd: string | undefined,
): ChangesPanelGroup[] {
  const seenPaths = new Map<string, DiscoveredFileReference>();

  for (const message of messages) {
    const rawRefs = extractFileReferences(message.text);

    for (const rawRef of rawRefs) {
      const cleaned = cleanDiscoveredChangesRawRef(rawRef);
      if (cleaned.length === 0) continue;

      const resolvedPath = resolveReferencePath(cleaned, _cwd);
      const filename = basenameOfChangesPath(resolvedPath);
      if (filename.length === 0) continue;

      const dedupeKey = canonicalizeChangesPathForLookup(resolvedPath);
      if (seenPaths.has(dedupeKey)) continue;

      const section = categorizeReference(cleaned);

      seenPaths.set(dedupeKey, {
        rawRef,
        resolvedPath,
        filename,
        section,
        firstSeenMessageId: message.id,
      });
    }
  }

  // Group by section in display order
  const groupedBySectionKind = new Map<ChangesSectionKind, DiscoveredFileReference[]>();
  for (const ref of seenPaths.values()) {
    const existing = groupedBySectionKind.get(ref.section);
    if (existing) {
      existing.push(ref);
    } else {
      groupedBySectionKind.set(ref.section, [ref]);
    }
  }

  return SECTION_CONFIG.map(({ section, label }) => ({
    section,
    label,
    items: groupedBySectionKind.get(section) ?? [],
  }));
}
