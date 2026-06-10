import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Fragment,
  isValidElement,
  type JSXElementConstructor,
  type ReactElement,
  type ReactNode,
} from "react";

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

type HostElement = ReactElement<Record<string, unknown>, string>;

function renderHostElements(node: ReactNode): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => renderHostElements(child));
  }

  if (!isValidElement(node)) {
    return [];
  }

  if (node.type === Fragment) {
    return renderHostElements(node.props.children as ReactNode);
  }

  if (typeof node.type === "function") {
    const rendered = (node.type as JSXElementConstructor<Record<string, unknown>>)(
      node.props as Record<string, unknown>,
    );
    return renderHostElements(rendered);
  }

  const hostElement = node as HostElement;
  return [
    hostElement,
    ...renderHostElements((hostElement.props.children as ReactNode | undefined) ?? null),
  ];
}

function findButtonByLabel(root: ReactNode, label: string): HostElement | undefined {
  return renderHostElements(root).find(
    (element) => element.type === "button" && element.props["aria-label"] === label,
  );
}

function expectElement(element: HostElement | undefined, message: string): HostElement {
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
    const tree = <SidebarModeSwitch />;
    const control = expectElement(
      findButtonByLabel(tree, "Use standard sidebar"),
      "Expected to find the standard sidebar control.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
  });

  it("updates settings to orchestration when the orchestration control is pressed", () => {
    const tree = <SidebarModeSwitch />;
    const control = expectElement(
      findButtonByLabel(tree, "Use orchestration sidebar"),
      "Expected to find the orchestration sidebar control.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
  });
});
