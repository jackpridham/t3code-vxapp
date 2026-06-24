import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SIDEBAR_VARIANTS } from "../../lib/sidebarMode";
const state = vi.hoisted(() => ({
  sidebarVariant: "project" as "project" | "orchestration",
  updateSettings: vi.fn<(patch: { sidebarVariant: "project" | "orchestration" }) => void>(),
  buttonPropsByLabel: new Map<string, Record<string, unknown>>(),
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

vi.mock("../ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => {
    const ariaLabel = props["aria-label"];
    if (typeof ariaLabel === "string") {
      state.buttonPropsByLabel.set(ariaLabel, { onClick, ...props });
    }
    return (
      <button onClick={onClick} type="button" {...props}>
        {children}
      </button>
    );
  },
}));

import { SidebarModeSwitch } from "./SidebarModeSwitch";

function renderSwitch() {
  state.buttonPropsByLabel.clear();
  return renderToStaticMarkup(<SidebarModeSwitch />);
}

function getButtonPropsByLabel(label: string, message: string): Record<string, unknown> {
  const props = state.buttonPropsByLabel.get(label);
  if (!props) {
    throw new Error(message);
  }
  return props;
}

describe("SidebarModeSwitch", () => {
  beforeEach(() => {
    state.sidebarVariant = "project";
    state.updateSettings.mockReset();
    state.buttonPropsByLabel.clear();
  });

  it("renders the expected switch labels and discovers the host buttons", () => {
    const html = renderSwitch();

    for (const variant of SIDEBAR_VARIANTS) {
      expect(html).toContain(variant.shortLabel);
      expect(html).toContain(`aria-label="${variant.label}"`);
      expect(state.buttonPropsByLabel.has(variant.label)).toBe(true);
    }
  });

  it("updates settings to project when the standard sidebar control is pressed", () => {
    renderSwitch();
    const controlProps = getButtonPropsByLabel(
      "Use standard sidebar",
      "Expected to find the standard sidebar control.",
    );

    (controlProps.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
  });

  it("updates settings to orchestration when the orchestration control is pressed", () => {
    renderSwitch();
    const controlProps = getButtonPropsByLabel(
      "Use orchestration sidebar",
      "Expected to find the orchestration sidebar control.",
    );

    (controlProps.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
  });
});
