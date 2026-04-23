import type { ProjectEntry, ProviderKind } from "@t3tools/contracts";

import {
  buildSkillMarkdownPath,
  buildSkillsRootPath,
  getSkillReferenceName,
  isTopLevelSkillDirectoryEntry,
} from "./skillReferences";

export interface SkillCatalogContext {
  projectCwd: string | null;
  worktreePath?: string | null;
  provider?: ProviderKind | null;
}

export interface SkillCatalogRoot {
  source: "project" | "worktree";
  rootPath: string;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  source: SkillCatalogRoot["source"];
  rootPath: string;
  relativeDirectory: string;
  skillMarkdownPath: string;
  displayPath: string;
}

export interface SkillReference {
  skillName: string;
  skillMarkdownPath: string;
}

export function resolveSkillCatalogRoots(context: SkillCatalogContext): SkillCatalogRoot[] {
  const activeCwd = context.worktreePath ?? context.projectCwd;
  if (!activeCwd) {
    return [];
  }

  return [
    {
      source: context.worktreePath ? "worktree" : "project",
      rootPath: buildSkillsRootPath(activeCwd),
    },
  ];
}

export function toSkillCatalogEntry(
  root: SkillCatalogRoot,
  entry: ProjectEntry,
): SkillCatalogEntry | null {
  if (!isTopLevelSkillDirectoryEntry(entry)) {
    return null;
  }

  const skillMarkdownPath = buildSkillMarkdownPath(root.rootPath, entry.path);
  return {
    id: `${root.source}:${skillMarkdownPath}`,
    name: entry.path,
    source: root.source,
    rootPath: root.rootPath,
    relativeDirectory: entry.path,
    skillMarkdownPath,
    displayPath: skillMarkdownPath,
  };
}

export function buildSkillPromptReference(entry: Pick<SkillCatalogEntry, "skillMarkdownPath">) {
  return `@${entry.skillMarkdownPath} `;
}

export function parseSkillPromptReference(pathValue: string): SkillReference | null {
  const skillName = getSkillReferenceName(pathValue);
  if (!skillName) {
    return null;
  }

  return {
    skillName,
    skillMarkdownPath: pathValue,
  };
}
