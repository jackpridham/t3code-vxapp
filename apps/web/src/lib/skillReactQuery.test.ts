import { describe, expect, it } from "vitest";

import { isMissingSkillDirectoryError } from "./skillReactQuery";

describe("skillReactQuery", () => {
  it("treats missing skill directories as empty search results", () => {
    expect(isMissingSkillDirectoryError(new Error("ENOENT: no such file or directory"))).toBe(true);
    expect(
      isMissingSkillDirectoryError({
        message: "The system cannot find the path specified: C:\\repo\\.claude\\skills",
      }),
    ).toBe(true);
  });

  it("does not hide unrelated skill search failures", () => {
    expect(isMissingSkillDirectoryError(new Error("permission denied"))).toBe(false);
    expect(isMissingSkillDirectoryError("search service unavailable")).toBe(false);
  });
});
