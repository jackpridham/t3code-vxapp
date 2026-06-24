import { describe, expect, it } from "vitest";

import {
  buildSkillPromptReference,
  parseSkillPromptReference,
  resolveSkillCatalogRoots,
  toSkillCatalogEntry,
} from "./skillCatalog";

describe("skillCatalog", () => {
  it("resolves the active project skill root", () => {
    expect(resolveSkillCatalogRoots({ projectCwd: "/workspace/app" })).toEqual([
      {
        source: "project",
        rootPath: "/workspace/app/.agents/skills",
      },
      {
        source: "project",
        rootPath: "/workspace/app/.claude/skills",
      },
    ]);
  });

  it("resolves the active worktree skill root when present", () => {
    expect(
      resolveSkillCatalogRoots({
        projectCwd: "/workspace/app",
        worktreePath: "/workspace/app-worktree",
      }),
    ).toEqual([
      {
        source: "worktree",
        rootPath: "/workspace/app-worktree/.agents/skills",
      },
      {
        source: "worktree",
        rootPath: "/workspace/app-worktree/.claude/skills",
      },
    ]);
  });

  it("maps top-level directories to catalog entries", () => {
    expect(
      toSkillCatalogEntry(
        { source: "project", rootPath: "/workspace/app/.agents/skills" },
        { path: "find-skills", kind: "directory" },
      ),
    ).toEqual({
      id: "project:/workspace/app/.agents/skills/find-skills/SKILL.md",
      name: "find-skills",
      source: "project",
      rootPath: "/workspace/app/.agents/skills",
      relativeDirectory: "find-skills",
      skillMarkdownPath: "/workspace/app/.agents/skills/find-skills/SKILL.md",
      displayPath: "/workspace/app/.agents/skills/find-skills/SKILL.md",
    });
  });

  it("ignores nested skill entries", () => {
    expect(
      toSkillCatalogEntry(
        { source: "project", rootPath: "/workspace/app/.agents/skills" },
        { path: "find-skills/SKILL.md", kind: "file" },
      ),
    ).toBeNull();
  });

  it("builds and parses prompt references", () => {
    const skillMarkdownPath = "/workspace/app/.agents/skills/find-skills/SKILL.md";
    expect(buildSkillPromptReference({ skillMarkdownPath })).toBe(
      "@/workspace/app/.agents/skills/find-skills/SKILL.md ",
    );
    expect(parseSkillPromptReference(skillMarkdownPath)).toEqual({
      skillName: "find-skills",
      skillMarkdownPath,
    });
  });
});
