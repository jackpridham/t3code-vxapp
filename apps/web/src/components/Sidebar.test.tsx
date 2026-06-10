import { renderToStaticMarkup } from "react-dom/server";
import {
  Fragment,
  isValidElement,
  type JSXElementConstructor,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/" as string,
  sidebarVariant: "project" as "project" | "orchestration",
  navigate: vi.fn(),
  updateSettings: vi.fn<(patch: { sidebarVariant: "project" | "orchestration" }) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: (options?: { select?: (location: { pathname: string }) => unknown }) => {
    const location = { pathname: state.pathname };
    return options?.select ? options.select(location) : location;
  },
  useNavigate: () => state.navigate,
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: (selector?: (value: { sidebarVariant: typeof state.sidebarVariant }) => unknown) => {
    const settings = { sidebarVariant: state.sidebarVariant };
    return selector ? selector(settings) : settings;
  },
  useUpdateSettings: () => ({
    updateSettings: state.updateSettings,
  }),
}));

function MockSidebarBrandHeader() {
  return (
    <div data-testid="sidebar-brand-header">
      <button
        aria-label="Use standard sidebar"
        onClick={() => state.updateSettings({ sidebarVariant: "project" })}
        type="button"
      />
      <button
        aria-label="Use orchestration sidebar"
        onClick={() => state.updateSettings({ sidebarVariant: "orchestration" })}
        type="button"
      />
    </div>
  );
}

vi.mock("./ProjectSidebar", () => ({
  default: ({ mode }: { mode?: "app" | "standalone" }) => (
    <div data-mode={mode ?? "app"} data-testid="project-sidebar">
      <MockSidebarBrandHeader />
    </div>
  ),
}));

vi.mock("~/features/vxapp/components/OrchestrationSidebar", () => ({
  default: ({ mode }: { mode?: "app" | "standalone" }) => (
    <div data-mode={mode ?? "app"} data-testid="orchestration-sidebar">
      <MockSidebarBrandHeader />
    </div>
  ),
}));

vi.mock("./settings/SettingsAppSidebar", () => ({
  SettingsAppSidebar: () => <div data-testid="settings-sidebar" />,
}));

import Sidebar from "./Sidebar";

function renderSidebar(mode?: "app" | "standalone") {
  return renderToStaticMarkup(mode ? <Sidebar mode={mode} /> : <Sidebar />);
}

type HostElement = ReactElement<Record<string, unknown>, string>;

function renderHostElements(node: ReactNode): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => renderHostElements(child));
  }

  if (!isValidElement(node)) {
    return [];
  }

  const element = node as ReactElement<
    Record<string, unknown>,
    string | JSXElementConstructor<Record<string, unknown>>
  >;

  if (element.type === Fragment) {
    return renderHostElements(element.props.children as ReactNode);
  }

  if (typeof element.type === "function") {
    const rendered = (element.type as (props: Record<string, unknown>) => ReactNode)(element.props);
    return renderHostElements(rendered);
  }

  const hostElement = element as HostElement;
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

describe("Sidebar", () => {
  beforeEach(() => {
    state.pathname = "/";
    state.sidebarVariant = "project";
    state.navigate.mockReset();
    state.updateSettings.mockReset();
    state.updateSettings.mockImplementation((patch) => {
      state.sidebarVariant = patch.sidebarVariant;
    });
  });

  it("renders the settings sidebar for settings routes regardless of stored variant", () => {
    state.pathname = "/settings/orchestration";
    state.sidebarVariant = "project";

    const html = renderSidebar();

    expect(html).toContain('data-testid="settings-sidebar"');
    expect(html).not.toContain('data-testid="project-sidebar"');
    expect(html).not.toContain('data-testid="orchestration-sidebar"');
  });

  it("renders the project sidebar for chat routes when the stored variant is project", () => {
    state.pathname = "/";
    state.sidebarVariant = "project";

    const html = renderSidebar();

    expect(html).toContain('data-testid="project-sidebar"');
    expect(html).not.toContain('data-testid="settings-sidebar"');
    expect(html).not.toContain('data-testid="orchestration-sidebar"');
  });

  it("renders the orchestration sidebar for chat routes when the stored variant is orchestration", () => {
    state.pathname = "/projects/thread-1";
    state.sidebarVariant = "orchestration";

    const html = renderSidebar("standalone");

    expect(html).toContain('data-testid="orchestration-sidebar"');
    expect(html).toContain('data-mode="standalone"');
    expect(html).not.toContain('data-testid="settings-sidebar"');
    expect(html).not.toContain('data-testid="project-sidebar"');
  });

  it("switches from project to orchestration without navigating away from the current route", () => {
    state.pathname = "/projects/thread-1";
    state.sidebarVariant = "project";

    const tree = <Sidebar />;
    const control = expectElement(
      findButtonByLabel(tree, "Use orchestration sidebar"),
      "Expected to find the orchestration sidebar switch control in the shared header.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.pathname).toBe("/projects/thread-1");
    expect(renderSidebar()).toContain('data-testid="orchestration-sidebar"');
  });

  it("switches from orchestration to project without navigating away from the current route", () => {
    state.pathname = "/projects/thread-1";
    state.sidebarVariant = "orchestration";

    const tree = <Sidebar />;
    const control = expectElement(
      findButtonByLabel(tree, "Use standard sidebar"),
      "Expected to find the standard sidebar switch control in the shared header.",
    );

    (control.props.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.pathname).toBe("/projects/thread-1");
    expect(renderSidebar()).toContain('data-testid="project-sidebar"');
  });
});
