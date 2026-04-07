import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  extractFileReferences,
  categorizeReference,
  discoverChangesReferences,
  type ChangesSectionKind,
} from "./changesDiscovery";

// ── extractFileReferences ────────────────────────────────────────────────────

describe("extractFileReferences", () => {
  it("extracts file:/// URLs", () => {
    const text = "Created file:///home/user/project/PLAN_feat.md successfully.";
    const refs = extractFileReferences(text);
    expect(refs).toContain("file:///home/user/project/PLAN_feat.md");
  });

  it("extracts @Docs/@TODO paths", () => {
    const text =
      "Plan saved to @Docs/@TODO/t3code-vxapp/feat/changes-panel/PLAN_feat-changes-panel.md";
    const refs = extractFileReferences(text);
    expect(refs).toContain(
      "@Docs/@TODO/t3code-vxapp/feat/changes-panel/PLAN_feat-changes-panel.md",
    );
  });

  it("extracts @Docs/@Scratch paths", () => {
    const text = "Artifact at @Docs/@Scratch/t3code-vxapp/analysis.md";
    const refs = extractFileReferences(text);
    expect(refs).toContain("@Docs/@Scratch/t3code-vxapp/analysis.md");
  });

  it("extracts @Docs/@CHANGELOG paths", () => {
    const text = "Updated @Docs/@CHANGELOG/CHANGELOG_2026-04-07.md";
    const refs = extractFileReferences(text);
    expect(refs).toContain("@Docs/@CHANGELOG/CHANGELOG_2026-04-07.md");
  });

  it("extracts @Docs/@Reports paths", () => {
    const text = "Report at @Docs/@Reports/REPORT_audit.md";
    const refs = extractFileReferences(text);
    expect(refs).toContain("@Docs/@Reports/REPORT_audit.md");
  });

  it("extracts markdown link targets", () => {
    const text = "See [the plan](./PLAN_feat-changes-panel.md) for details.";
    const refs = extractFileReferences(text);
    expect(refs).toContain("./PLAN_feat-changes-panel.md");
  });

  it("ignores http/https URLs in markdown links", () => {
    const text = "See [docs](https://example.com/readme.md) for details.";
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(0);
  });

  it("deduplicates references", () => {
    const text = "File @Docs/@TODO/plan.md and also @Docs/@TODO/plan.md again.";
    const refs = extractFileReferences(text);
    expect(refs).toHaveLength(1);
  });

  it("extracts multiple different references from one message", () => {
    const text = [
      "Created @Docs/@TODO/repo/PLAN_x.md",
      "and @Docs/@Scratch/repo/notes.md",
      "also [link](./src/app.tsx)",
    ].join("\n");
    const refs = extractFileReferences(text);
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });
});

// ── categorizeReference ──────────────────────────────────────────────────────

describe("categorizeReference", () => {
  const cases: Array<[string, ChangesSectionKind]> = [
    ["@Docs/@TODO/t3code-vxapp/feat/x/PLAN_feat-x.md", "plans"],
    ["PLAN_something.md", "plans"],
    ["TODO_t3code-vxapp.md", "plans"],
    ["PHASE_01_contracts.md", "plans"],
    ["/home/user/@Docs/@TODO/repo/PLAN_x.md", "plans"],
    ["@Docs/@CHANGELOG/CHANGELOG_2026.md", "changelog"],
    ["CHANGELOG_latest.md", "changelog"],
    ["CHANGELOG.md", "changelog"],
    ["@Docs/@Reports/REPORT_audit.md", "reports"],
    ["REPORT_review.md", "reports"],
    ["@Docs/@Scratch/t3code-vxapp/analysis.md", "artifacts"],
    ["README.md", "artifacts"],
    ["some-doc.md", "artifacts"],
    ["src/components/ChatView.tsx", "files_changed"],
    ["apps/server/src/wsServer.ts", "files_changed"],
    ["/home/user/project/index.ts", "files_changed"],
    ["package.json", "files_changed"],
  ];

  for (const [path, expectedSection] of cases) {
    it(`categorizes "${path}" as "${expectedSection}"`, () => {
      expect(categorizeReference(path)).toBe(expectedSection);
    });
  }
});

// ── discoverChangesReferences ────────────────────────────────────────────────

describe("discoverChangesReferences", () => {
  const makeMessage = (id: string, text: string) => ({
    id: MessageId.makeUnsafe(id),
    role: "assistant" as const,
    text,
    createdAt: new Date().toISOString(),
    streaming: false,
  });

  it("groups references by section", () => {
    const messages = [
      makeMessage("m1", "Created @Docs/@TODO/repo/feat/x/PLAN_x.md"),
      makeMessage("m2", "Artifact at @Docs/@Scratch/repo/notes.md"),
    ];
    const groups = discoverChangesReferences(messages, undefined);

    const plans = groups.find((g) => g.section === "plans");
    expect(plans?.items).toHaveLength(1);
    expect(plans?.items[0]?.filename).toBe("PLAN_x.md");

    const artifacts = groups.find((g) => g.section === "artifacts");
    expect(artifacts?.items).toHaveLength(1);
    expect(artifacts?.items[0]?.filename).toBe("notes.md");
  });

  it("returns all five sections even when empty", () => {
    const groups = discoverChangesReferences([], undefined);
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
  });

  it("returns sections in display order", () => {
    const groups = discoverChangesReferences([], undefined);
    expect(groups.map((g) => g.section)).toEqual([
      "plans",
      "artifacts",
      "files_changed",
      "changelog",
      "reports",
    ]);
  });

  it("deduplicates across messages", () => {
    const messages = [
      makeMessage("m1", "Created @Docs/@TODO/repo/PLAN_x.md"),
      makeMessage("m2", "Updated @Docs/@TODO/repo/PLAN_x.md"),
    ];
    const groups = discoverChangesReferences(messages, undefined);
    const plans = groups.find((g) => g.section === "plans");
    expect(plans?.items).toHaveLength(1);
    expect(plans?.items[0]?.firstSeenMessageId).toBe("m1");
  });

  it("assigns correct section labels", () => {
    const groups = discoverChangesReferences([], undefined);
    const labels = groups.map((g) => g.label);
    expect(labels).toEqual(["Plans", "Artifacts", "Files Changed", "Changelog", "Reports"]);
  });

  it("categorizes changelog and report references", () => {
    const messages = [
      makeMessage("m1", "Changelog at @Docs/@CHANGELOG/CHANGELOG_2026.md"),
      makeMessage("m2", "Report at @Docs/@Reports/REPORT_review.md"),
    ];
    const groups = discoverChangesReferences(messages, undefined);

    const changelog = groups.find((g) => g.section === "changelog");
    expect(changelog?.items).toHaveLength(1);

    const reports = groups.find((g) => g.section === "reports");
    expect(reports?.items).toHaveLength(1);
  });
});
