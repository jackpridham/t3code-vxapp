import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/" as string,
  sidebarVariant: "project" as "project" | "orchestration",
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: (options?: { select?: (location: { pathname: string }) => unknown }) => {
    const location = { pathname: state.pathname };
    return options?.select ? options.select(location) : location;
  },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: (selector?: (value: { sidebarVariant: typeof state.sidebarVariant }) => unknown) => {
    const settings = { sidebarVariant: state.sidebarVariant };
    return selector ? selector(settings) : settings;
  },
}));

vi.mock("./ProjectSidebar", () => ({
  default: ({ mode }: { mode?: "app" | "standalone" }) => (
    <div data-mode={mode ?? "app"} data-testid="project-sidebar" />
  ),
}));

vi.mock("~/features/vxapp/components/OrchestrationSidebar", () => ({
  default: ({ mode }: { mode?: "app" | "standalone" }) => (
    <div data-mode={mode ?? "app"} data-testid="orchestration-sidebar" />
  ),
}));

vi.mock("./settings/SettingsAppSidebar", () => ({
  SettingsAppSidebar: () => <div data-testid="settings-sidebar" />,
}));

import Sidebar from "./Sidebar";

function renderSidebar(mode?: "app" | "standalone") {
  return renderToStaticMarkup(mode ? <Sidebar mode={mode} /> : <Sidebar />);
}

describe("Sidebar", () => {
  beforeEach(() => {
    state.pathname = "/";
    state.sidebarVariant = "project";
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
});
