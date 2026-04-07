import { describe, expect, it } from "vitest";
import { MessageId, TurnId } from "@t3tools/contracts";

import { discoverChangesReferences, type ChangesPanelGroup } from "../changesDiscovery";
import type { ChatMessage, PersistedFileChange } from "../types";

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMessage(text: string, id = "msg-1"): ChatMessage {
  return {
    id: MessageId.makeUnsafe(id),
    role: "assistant",
    text,
    createdAt: "2026-04-07T00:00:00.000Z",
    streaming: false,
  };
}

function filesChangedGroup(groups: ChangesPanelGroup[]): ChangesPanelGroup | undefined {
  return groups.find((g) => g.section === "files_changed");
}

// ── useChangesDiscovery logic (tested via pure functions) ────────────────────

describe("ChangesPanel discovery integration", () => {
  it("discovers plan references from messages", () => {
    const messages = [makeMessage("See @Docs/@TODO/repo/PLAN_auth.md for details.")];
    const groups = discoverChangesReferences(messages, undefined);
    const plansGroup = groups.find((g) => g.section === "plans");
    expect(plansGroup?.items).toHaveLength(1);
    expect(plansGroup?.items[0]?.filename).toBe("PLAN_auth.md");
  });

  it("discovers artifact references from @Scratch paths", () => {
    const messages = [makeMessage("Created @Docs/@Scratch/repo/notes.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const artifactsGroup = groups.find((g) => g.section === "artifacts");
    expect(artifactsGroup?.items).toHaveLength(1);
  });

  it("discovers code file references in files_changed", () => {
    const messages = [
      makeMessage("Modified file:///repo/src/index.ts and file:///repo/src/app.tsx"),
    ];
    const groups = discoverChangesReferences(messages, undefined);
    const fcGroup = filesChangedGroup(groups);
    expect(fcGroup?.items.length).toBeGreaterThanOrEqual(2);
  });

  it("discovers changelog references", () => {
    const messages = [makeMessage("Updated @Docs/@CHANGELOG/repo/CHANGELOG_2026-04-07.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const clGroup = groups.find((g) => g.section === "changelog");
    expect(clGroup?.items).toHaveLength(1);
  });

  it("discovers report references", () => {
    const messages = [makeMessage("Generated @Docs/@Reports/repo/REPORT_coverage.md")];
    const groups = discoverChangesReferences(messages, undefined);
    const reportsGroup = groups.find((g) => g.section === "reports");
    expect(reportsGroup?.items).toHaveLength(1);
  });

  it("returns empty groups when no messages", () => {
    const groups = discoverChangesReferences([], undefined);
    const nonEmpty = groups.filter((g) => g.items.length > 0);
    expect(nonEmpty).toHaveLength(0);
  });

  it("empty sections have zero items", () => {
    const groups = discoverChangesReferences([makeMessage("No file paths here.")], undefined);
    for (const group of groups) {
      expect(group.items).toHaveLength(0);
    }
  });
});

describe("persisted file changes merge", () => {
  it("persisted changes appear in files_changed group when not already discovered", () => {
    const messages: ChatMessage[] = [];
    const persistedFileChanges: PersistedFileChange[] = [
      {
        path: "src/store.ts",
        kind: "modified",
        totalInsertions: 10,
        totalDeletions: 5,
        firstTurnId: TurnId.makeUnsafe("turn-1"),
        lastTurnId: TurnId.makeUnsafe("turn-1"),
      },
    ];

    const groups = discoverChangesReferences(messages, undefined);
    // Simulate the merge logic from useChangesDiscovery
    const fcGroup = filesChangedGroup(groups);
    expect(fcGroup).toBeDefined();
    if (fcGroup) {
      const existingPaths = new Set(fcGroup.items.map((item) => item.resolvedPath.toLowerCase()));
      for (const fc of persistedFileChanges) {
        if (!existingPaths.has(fc.path.toLowerCase())) {
          fcGroup.items.push({
            rawRef: fc.path,
            resolvedPath: fc.path,
            filename: fc.path.slice(
              Math.max(fc.path.lastIndexOf("/"), fc.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: fc.firstTurnId,
          });
          existingPaths.add(fc.path.toLowerCase());
        }
      }
    }

    expect(fcGroup?.items).toHaveLength(1);
    expect(fcGroup?.items[0]?.filename).toBe("store.ts");
  });

  it("does not duplicate files already discovered from messages", () => {
    const messages = [makeMessage("Modified file:///repo/src/store.ts")];
    const persistedFileChanges: PersistedFileChange[] = [
      {
        path: "/repo/src/store.ts",
        kind: "modified",
        totalInsertions: 10,
        totalDeletions: 5,
        firstTurnId: TurnId.makeUnsafe("turn-1"),
        lastTurnId: TurnId.makeUnsafe("turn-1"),
      },
    ];

    const groups = discoverChangesReferences(messages, undefined);
    const fcGroup = filesChangedGroup(groups);
    const countBefore = fcGroup?.items.length ?? 0;

    if (fcGroup) {
      const existingPaths = new Set(fcGroup.items.map((item) => item.resolvedPath.toLowerCase()));
      for (const fc of persistedFileChanges) {
        if (!existingPaths.has(fc.path.toLowerCase())) {
          fcGroup.items.push({
            rawRef: fc.path,
            resolvedPath: fc.path,
            filename: fc.path.slice(
              Math.max(fc.path.lastIndexOf("/"), fc.path.lastIndexOf("\\")) + 1,
            ),
            section: "files_changed",
            firstSeenMessageId: fc.firstTurnId,
          });
          existingPaths.add(fc.path.toLowerCase());
        }
      }
    }

    expect(fcGroup?.items.length).toBe(countBefore);
  });
});
