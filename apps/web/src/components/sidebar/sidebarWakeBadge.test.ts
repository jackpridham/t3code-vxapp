import { describe, expect, it } from "vitest";

import { buildSidebarWakeBadge } from "./sidebarWakeBadge";

describe("buildSidebarWakeBadge", () => {
  it("returns null when the open wake count is zero or absent", () => {
    expect(buildSidebarWakeBadge(0)).toBeNull();
    expect(buildSidebarWakeBadge(null)).toBeNull();
    expect(buildSidebarWakeBadge(undefined)).toBeNull();
  });

  it('returns "1 wake" for a single open wake', () => {
    expect(buildSidebarWakeBadge(1)).toMatchObject({
      label: "1 wake",
    });
  });

  it('returns "<n> wakes" for multiple open wakes', () => {
    expect(buildSidebarWakeBadge(3)).toMatchObject({
      label: "3 wakes",
    });
  });

  it("keeps the helper surface neutral and count-only", () => {
    const badge = buildSidebarWakeBadge(2);
    expect(badge).not.toBeNull();
    expect(badge?.label).toBe("2 wakes");
    expect(badge?.label).not.toMatch(/active|waiting|waking|queued/i);
  });
});
