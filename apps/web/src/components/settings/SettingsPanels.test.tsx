import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

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

type InspectableElement = ReactElement<Record<string, unknown>>;

function visitReactNodes(node: ReactNode, visitor: (element: InspectableElement) => void) {
  if (Array.isArray(node)) {
    for (const child of node) {
      visitReactNodes(child, visitor);
    }
    return;
  }

  if (!isValidElement(node)) {
    return;
  }

  visitor(node as InspectableElement);

  for (const value of Object.values(node.props as Record<string, unknown>)) {
    visitReactNodes(value as ReactNode, visitor);
  }
}

describe("OrchestrationSettingsPanel", () => {
  it("renders a sidebar mode control labeled Sidebar mode", () => {
    const tree = OrchestrationSettingsPanel();
    let hasSidebarModeTitle = false;
    let hasSidebarModeAriaLabel = false;

    visitReactNodes(tree, (element) => {
      if (element.props.title === "Sidebar mode") {
        hasSidebarModeTitle = true;
      }
      if (element.props["aria-label"] === "Sidebar mode") {
        hasSidebarModeAriaLabel = true;
      }
    });

    expect(hasSidebarModeTitle).toBe(true);
    expect(hasSidebarModeAriaLabel).toBe(true);
  });
});
