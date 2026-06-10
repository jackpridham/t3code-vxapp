import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({
  sidebarVariant: "project" as "project" | "orchestration",
  updateSettings: vi.fn<(patch: { sidebarVariant: "project" | "orchestration" }) => void>(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: (selector?: (value: { sidebarVariant: "project" | "orchestration" }) => unknown) => {
    const settings = { sidebarVariant: state.sidebarVariant };
    return selector ? selector(settings) : settings;
  },
  useUpdateSettings: () => ({
    updateSettings: state.updateSettings,
  }),
}));

import { SidebarModeSwitch } from "./SidebarModeSwitch";

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

function findElementByLabel(root: ReactNode, label: string) {
  let match: InspectableElement | null = null;

  visitReactNodes(root, (element) => {
    if (match) return;
    if (element.props["aria-label"] === label) {
      match = element;
    }
  });

  return match;
}

function expectElement(element: InspectableElement | null, message: string): InspectableElement {
  if (!element) {
    throw new Error(message);
  }

  return element;
}

describe("SidebarModeSwitch", () => {
  beforeEach(() => {
    state.sidebarVariant = "project";
    state.updateSettings.mockReset();
  });

  it("updates settings to project when the standard sidebar control is pressed", () => {
    const tree = SidebarModeSwitch();
    const control = expectElement(
      findElementByLabel(tree, "Use standard sidebar"),
      "Expected to find the standard sidebar control.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
  });

  it("updates settings to orchestration when the orchestration control is pressed", () => {
    const tree = SidebarModeSwitch();
    const control = expectElement(
      findElementByLabel(tree, "Use orchestration sidebar"),
      "Expected to find the orchestration sidebar control.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
  });
});
