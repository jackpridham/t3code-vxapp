import { describe, expect, it } from "vitest";

import { resolveSidebarSurfaceVariant } from "./sidebarMode";

describe("resolveSidebarSurfaceVariant", () => {
  it("returns settings for settings routes regardless of the stored sidebar variant", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/settings/orchestration",
        sidebarVariant: "project",
      }),
    ).toBe("settings");
  });

  it("returns the stored project variant for chat routes", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/",
        sidebarVariant: "project",
      }),
    ).toBe("project");
  });

  it("returns the stored orchestration variant for chat routes", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/projects/thread-1",
        sidebarVariant: "orchestration",
      }),
    ).toBe("orchestration");
  });
});
