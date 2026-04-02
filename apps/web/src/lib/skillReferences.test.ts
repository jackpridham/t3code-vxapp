import { describe, expect, it } from "vitest";

import {
  buildSkillMarkdownPath,
  buildSkillsRootPath,
  getSkillReferenceName,
  isSkillReferencePath,
  splitTextIntoSkillReferenceSegments,
  toProjectSkillEntry,
} from "./skillReferences";

describe("skillReferences", () => {
  it("builds a skills root path under the project cwd", () => {
    expect(buildSkillsRootPath("/workspace/app")).toBe("/workspace/app/.claude/skills");
  });

  it("builds the absolute SKILL.md path for a selected skill", () => {
    expect(buildSkillMarkdownPath("/workspace/app/.claude/skills", "find-skills")).toBe(
      "/workspace/app/.claude/skills/find-skills/SKILL.md",
    );
  });

  it("detects skill reference paths and extracts the skill name", () => {
    const skillPath = "/workspace/app/.claude/skills/find-skills/SKILL.md";
    expect(isSkillReferencePath(skillPath)).toBe(true);
    expect(getSkillReferenceName(skillPath)).toBe("find-skills");
  });

  it("extracts a skill name from windows-style paths", () => {
    expect(
      getSkillReferenceName("C:\\workspace\\app\\.claude\\skills\\find-skills\\SKILL.md"),
    ).toBe("find-skills");
  });

  it("maps top-level skill directory entries into selectable skill entries", () => {
    expect(
      toProjectSkillEntry("/workspace/app/.claude/skills", {
        path: "find-skills",
        kind: "directory",
      }),
    ).toEqual({
      name: "find-skills",
      relativeDirectory: "find-skills",
      skillMarkdownPath: "/workspace/app/.claude/skills/find-skills/SKILL.md",
    });
  });

  it("ignores nested workspace entries that are not top-level skills", () => {
    expect(
      toProjectSkillEntry("/workspace/app/.claude/skills", {
        path: "find-skills/references",
        kind: "directory",
      }),
    ).toBeNull();
  });

  it("splits user-visible text around inline skill references", () => {
    expect(
      splitTextIntoSkillReferenceSegments(
        "Use @/workspace/app/.claude/skills/find-skills/SKILL.md before continuing",
      ),
    ).toEqual([
      { type: "text", text: "Use " },
      {
        type: "skill",
        skillName: "find-skills",
        skillMarkdownPath: "/workspace/app/.claude/skills/find-skills/SKILL.md",
      },
      { type: "text", text: " before continuing" },
    ]);
  });

  it("keeps trailing punctuation outside rendered skill references", () => {
    expect(
      splitTextIntoSkillReferenceSegments(
        "Use @/workspace/app/.claude/skills/find-skills/SKILL.md, then continue.",
      ),
    ).toEqual([
      { type: "text", text: "Use " },
      {
        type: "skill",
        skillName: "find-skills",
        skillMarkdownPath: "/workspace/app/.claude/skills/find-skills/SKILL.md",
      },
      { type: "text", text: ", then continue." },
    ]);
  });

  it("recognizes skill references wrapped in punctuation", () => {
    expect(
      splitTextIntoSkillReferenceSegments(
        "Run (@/workspace/app/.claude/skills/find-skills/SKILL.md) before continuing.",
      ),
    ).toEqual([
      { type: "text", text: "Run (" },
      {
        type: "skill",
        skillName: "find-skills",
        skillMarkdownPath: "/workspace/app/.claude/skills/find-skills/SKILL.md",
      },
      { type: "text", text: ") before continuing." },
    ]);
  });
});
