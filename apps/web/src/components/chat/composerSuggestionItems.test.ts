import { describe, expect, it } from "vitest";

import {
  buildPathComposerItems,
  buildSkillComposerItems,
  buildSkillPromptReference,
  buildSlashCommandComposerItems,
} from "./composerSuggestionItems";

describe("composerSuggestionItems", () => {
  it("maps path entries to composer menu items", () => {
    expect(
      buildPathComposerItems([
        { path: "src/components/ChatView.tsx", kind: "file", parentPath: "src/components" },
      ]),
    ).toEqual([
      {
        id: "path:file:src/components/ChatView.tsx",
        type: "path",
        path: "src/components/ChatView.tsx",
        pathKind: "file",
        label: "ChatView.tsx",
        description: "src/components",
      },
    ]);
  });

  it("maps skill entries to composer menu items", () => {
    const skillMarkdownPath = "/workspace/app/.claude/skills/find-skills/SKILL.md";
    const items = buildSkillComposerItems([
      {
        id: `project:${skillMarkdownPath}`,
        name: "find-skills",
        source: "project",
        rootPath: "/workspace/app/.claude/skills",
        relativeDirectory: "find-skills",
        skillMarkdownPath,
        displayPath: skillMarkdownPath,
      },
    ]);

    expect(items).toEqual([
      {
        id: "skill:find-skills",
        type: "skill",
        skillName: "find-skills",
        skillMarkdownPath,
        label: "find-skills",
        description: skillMarkdownPath,
      },
    ]);
    const item = items[0];
    if (!item || item.type !== "skill") {
      throw new Error("Expected a skill composer item.");
    }
    expect(buildSkillPromptReference(item)).toBe(
      "@/workspace/app/.claude/skills/find-skills/SKILL.md ",
    );
  });

  it("filters slash command items", () => {
    expect(buildSlashCommandComposerItems("pla").map((item) => item.label)).toEqual(["/plan"]);
  });
});
