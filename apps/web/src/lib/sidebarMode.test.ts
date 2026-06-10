import { describe, expect, it } from "vitest";

import { resolveSidebarSurfaceVariant } from "./sidebarMode";

describe("resolveSidebarSurfaceVariant", () => {
  it('returns settings for the exact "/settings" route', () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/settings",
        sidebarVariant: "orchestration",
      }),
    ).toBe("settings");
  });

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

  it('does not treat "/settings-foo" as a settings route', () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/settings-foo",
        sidebarVariant: "orchestration",
      }),
    ).toBe("orchestration");
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
