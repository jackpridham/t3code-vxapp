import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SIDEBAR_VARIANTS, SIDEBAR_VARIANT_SETTINGS_LABELS } from "../../lib/sidebarMode";
const state = vi.hoisted(() => ({
  settings: {
    sidebarVariant: "project" as "project" | "orchestration",
    sidebarOrchestrationDataMode: "live" as "live" | "demo",
    startupThreadTarget: "executive" as "executive" | "orchestrator",
    sidebarGroupWorktreesWithParentProject: true,
    sidebarWorkerVisibilityScope: "current_orchestrator" as
      | "current_orchestrator"
      | "all_orchestrators",
    sidebarWorkerLineageFilter: "hide_invalid" as "hide_invalid" | "show_invalid" | "only_invalid",
    sidebarWorkerActivityFilter: "all" as "all" | "active" | "needs_attention",
    workerChatViewVisibility: "always_show" as "always_show" | "always_hide",
    workerOrchestrationNoticesVisibility: "always_show" as "always_show" | "always_hide",
    notifyActiveOrchestratorOnRejectedWorkerWake: false,
    ideModeEnabled: false,
  },
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => state.settings,
  useUpdateSettings: () => ({
    updateSettings: state.updateSettings,
  }),
}));

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: () => null,
}));

import { OrchestrationSettingsPanel } from "./SettingsPanels";

describe("OrchestrationSettingsPanel", () => {
  it("renders a sidebar mode control labeled Sidebar mode", () => {
    const html = renderToStaticMarkup(<OrchestrationSettingsPanel />);

    expect(html).toContain("Sidebar mode");
    expect(html).toContain('aria-label="Sidebar mode"');
    for (const variant of SIDEBAR_VARIANTS) {
      expect(html).toContain(SIDEBAR_VARIANT_SETTINGS_LABELS[variant.value]);
    }
  });
});
