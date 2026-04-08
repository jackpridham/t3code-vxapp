import { describe, expect, it } from "vitest";

import {
  CHANGES_WINDOW_ROUTE,
  buildChangesWindowHref,
  isChangesWindowPath,
  parseChangesWindowSearch,
} from "./changesWindow";

describe("changesWindow helpers", () => {
  it("recognizes the standalone changes window route", () => {
    expect(isChangesWindowPath(CHANGES_WINDOW_ROUTE.replace("$threadId", "thread-1"))).toBe(true);
    expect(isChangesWindowPath("/artifact")).toBe(false);
  });

  it("parses optional search params", () => {
    expect(
      parseChangesWindowSearch({
        path: " /repo/@Docs/@TODO/repo/PLAN_repo.md` ",
        mode: "diff",
      }),
    ).toEqual({
      path: "/repo/@Docs/@TODO/repo/PLAN_repo.md",
      mode: "diff",
    });
  });

  it("ignores unsupported search params", () => {
    expect(parseChangesWindowSearch({ mode: "edit", path: 123 })).toEqual({});
  });

  it("builds a browser changes window href with encoded params", () => {
    expect(
      buildChangesWindowHref({
        threadId: "thread-1",
        path: "/repo/src/report name.ts",
        mode: "preview",
      }),
    ).toBe("/changes/thread-1?path=%2Frepo%2Fsrc%2Freport+name.ts&mode=preview");
  });
});
