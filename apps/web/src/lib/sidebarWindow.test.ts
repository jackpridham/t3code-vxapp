import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  isSidebarWindowPath,
  resolveNoThreadRouteTarget,
  resolveThreadRouteTarget,
} from "./sidebarWindow";

describe("sidebarWindow route targets", () => {
  it("recognizes sidebar window paths", () => {
    expect(isSidebarWindowPath("/sidebar")).toBe(true);
    expect(isSidebarWindowPath("/sidebar/thread-1")).toBe(true);
    expect(isSidebarWindowPath("/thread-1")).toBe(false);
  });

  it("routes thread clicks to supported root thread routes even from sidebar windows", () => {
    expect(resolveThreadRouteTarget("/sidebar", ThreadId.makeUnsafe("thread-1"))).toEqual({
      to: "/$threadId",
      params: { threadId: ThreadId.makeUnsafe("thread-1") },
    });
  });

  it("keeps no-thread sidebar navigation in the sidebar shell", () => {
    expect(resolveNoThreadRouteTarget("/sidebar/thread-1")).toEqual({ to: "/sidebar" });
  });
});
