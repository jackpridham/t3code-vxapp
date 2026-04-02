import type { ProjectEntry } from "@t3tools/contracts";

const SKILL_REFERENCE_PATH_PATTERN = /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i;
const SKILL_REFERENCE_PREFIX_BOUNDARY_PATTERN = /[\s([{'"]/;
const SKILL_REFERENCE_TRAILING_PUNCTUATION_PATTERN = /[),.!?;:\]}'"]/;

export interface ProjectSkillEntry {
  name: string;
  relativeDirectory: string;
  skillMarkdownPath: string;
}

export type SkillReferenceTextSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "skill";
      skillName: string;
      skillMarkdownPath: string;
    };

export function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/");
}

export function joinFilePath(base: string, next: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const cleanBase = base.replace(/[\\/]+$/, "");
  if (separator === "\\") {
    return `${cleanBase}\\${next.replaceAll("/", "\\")}`;
  }
  return `${cleanBase}/${next.replace(/^\/+/, "")}`;
}

export function buildSkillsRootPath(projectCwd: string): string {
  return joinFilePath(projectCwd, ".claude/skills");
}

export function buildSkillMarkdownPath(skillsRootPath: string, relativeDirectory: string): string {
  return joinFilePath(joinFilePath(skillsRootPath, relativeDirectory), "SKILL.md");
}

export function isTopLevelSkillDirectoryEntry(entry: ProjectEntry): boolean {
  return entry.kind === "directory" && !entry.path.includes("/");
}

export function toProjectSkillEntry(
  skillsRootPath: string,
  entry: ProjectEntry,
): ProjectSkillEntry | null {
  if (!isTopLevelSkillDirectoryEntry(entry)) {
    return null;
  }

  return {
    name: entry.path,
    relativeDirectory: entry.path,
    skillMarkdownPath: buildSkillMarkdownPath(skillsRootPath, entry.path),
  };
}

export function getSkillReferenceName(pathValue: string): string | null {
  const normalizedPath = normalizePathSeparators(pathValue);
  return SKILL_REFERENCE_PATH_PATTERN.exec(normalizedPath)?.[1] ?? null;
}

export function isSkillReferencePath(pathValue: string): boolean {
  return getSkillReferenceName(pathValue) !== null;
}

function isSkillReferencePrefixBoundary(char: string | undefined): boolean {
  return char == null || char.length === 0 || SKILL_REFERENCE_PREFIX_BOUNDARY_PATTERN.test(char);
}

function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

function trimTrailingSkillReferencePunctuation(token: string): string {
  let end = token.length;
  while (
    end > 0 &&
    SKILL_REFERENCE_TRAILING_PUNCTUATION_PATTERN.test(token.charAt(end - 1) ?? "")
  ) {
    end -= 1;
  }
  return token.slice(0, end);
}

export function splitTextIntoSkillReferenceSegments(text: string): SkillReferenceTextSegment[] {
  if (text.length === 0) {
    return [];
  }

  const segments: SkillReferenceTextSegment[] = [];
  let cursor = 0;
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const atIndex = text.indexOf("@", searchIndex);
    if (atIndex === -1) {
      break;
    }

    if (!isSkillReferencePrefixBoundary(text.charAt(atIndex - 1))) {
      searchIndex = atIndex + 1;
      continue;
    }

    let rawTokenEnd = atIndex + 1;
    while (rawTokenEnd < text.length && !isWhitespaceChar(text.charAt(rawTokenEnd))) {
      rawTokenEnd += 1;
    }

    const rawToken = text.slice(atIndex + 1, rawTokenEnd);
    const skillMarkdownPath = trimTrailingSkillReferencePunctuation(rawToken);
    const skillName = getSkillReferenceName(skillMarkdownPath);
    if (!skillName) {
      searchIndex = atIndex + 1;
      continue;
    }

    if (atIndex > cursor) {
      segments.push({
        type: "text",
        text: text.slice(cursor, atIndex),
      });
    }

    segments.push({
      type: "skill",
      skillName,
      skillMarkdownPath,
    });
    cursor = atIndex + 1 + skillMarkdownPath.length;
    searchIndex = rawTokenEnd;
  }

  if (cursor < text.length) {
    segments.push({
      type: "text",
      text: text.slice(cursor),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", text }];
}
