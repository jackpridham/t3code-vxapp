import { describe, expect, it } from "vitest";

import { getDisplayThreadLabelEntries, normalizeDisplayThreadLabel } from "./threadLabels";

describe("normalizeDisplayThreadLabel", () => {
  it("returns null for empty and provider labels", () => {
    expect(normalizeDisplayThreadLabel("   ")).toBeNull();
    expect(normalizeDisplayThreadLabel("provider:codex")).toBeNull();
  });

  it("strips model prefixes and preserves other labels", () => {
    expect(normalizeDisplayThreadLabel("model:gpt-5.4")).toBe("gpt-5.4");
    expect(normalizeDisplayThreadLabel(" worker ")).toBe("worker");
  });
});

describe("getDisplayThreadLabelEntries", () => {
  it("dedupes by displayed label while preserving the first raw label", () => {
    expect(
      getDisplayThreadLabelEntries([" model:gpt-5.4 ", "gpt-5.4", "worker", "worker"], 5),
    ).toEqual([
      {
        key: "model:gpt-5.4",
        rawLabel: "model:gpt-5.4",
        displayLabel: "gpt-5.4",
      },
      {
        key: "worker",
        rawLabel: "worker",
        displayLabel: "worker",
      },
    ]);
  });

  it("drops provider labels and respects the requested limit", () => {
    expect(
      getDisplayThreadLabelEntries(["provider:codex", "worker", "needs-review", "gpt-5.4"], 2),
    ).toEqual([
      {
        key: "worker",
        rawLabel: "worker",
        displayLabel: "worker",
      },
      {
        key: "needs-review",
        rawLabel: "needs-review",
        displayLabel: "needs-review",
      },
    ]);
  });
});
