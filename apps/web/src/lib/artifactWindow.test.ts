import { describe, expect, it } from "vitest";

import {
  ARTIFACT_WINDOW_ROUTE,
  buildArtifactWindowHref,
  isArtifactWindowPath,
  parseArtifactWindowSearch,
} from "./artifactWindow";

describe("artifactWindow helpers", () => {
  it("recognizes the standalone artifact window route", () => {
    expect(isArtifactWindowPath(ARTIFACT_WINDOW_ROUTE)).toBe(true);
    expect(isArtifactWindowPath("/sidebar")).toBe(false);
  });

  it("parses required artifact search params", () => {
    expect(
      parseArtifactWindowSearch({
        path: " /repo/@Docs/@Scratch/repo/report.md ",
        worktree: " /repo ",
      }),
    ).toEqual({
      path: "/repo/@Docs/@Scratch/repo/report.md",
      worktree: "/repo",
    });
  });

  it("rejects missing artifact paths", () => {
    expect(() => parseArtifactWindowSearch({ worktree: "/repo" })).toThrow(
      "Artifact path is required.",
    );
  });

  it("builds a browser artifact window href with encoded params", () => {
    expect(
      buildArtifactWindowHref({
        path: "/repo/@Docs/@Scratch/repo/report name.md",
        worktreePath: "/repo",
      }),
    ).toBe(
      "/artifact?path=%2Frepo%2F%40Docs%2F%40Scratch%2Frepo%2Freport+name.md&worktree=%2Frepo",
    );
  });
});
