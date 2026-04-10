import { describe, expect, it } from "vitest";

import {
  CHANGES_PANEL_DEFAULT_WIDTH,
  CHANGES_PANEL_MIN_MAIN_CONTENT_WIDTH,
  CHANGES_PANEL_MIN_WIDTH,
  resolveEffectiveChangesPanelOpen,
} from "./chatChangesPanelLayout";

describe("chatChangesPanelLayout", () => {
  it("uses the reduced default drawer width", () => {
    expect(CHANGES_PANEL_DEFAULT_WIDTH).toBe("clamp(14rem,24vw,22rem)");
    expect(CHANGES_PANEL_MIN_WIDTH).toBe(13 * 16);
    expect(CHANGES_PANEL_MIN_MAIN_CONTENT_WIDTH).toBe(40 * 16);
  });

  it("uses the setting default before the drawer has been initialized", () => {
    expect(
      resolveEffectiveChangesPanelOpen({
        changesPanelOpen: false,
        initializedFromSettings: false,
        showByDefault: true,
      }),
    ).toBe(true);
  });

  it("respects the user-controlled store state after initialization", () => {
    expect(
      resolveEffectiveChangesPanelOpen({
        changesPanelOpen: false,
        initializedFromSettings: true,
        showByDefault: true,
      }),
    ).toBe(false);
  });
});
