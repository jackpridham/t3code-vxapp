import { renderToStaticMarkup } from "react-dom/server";
import { type PropsWithChildren, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/" as string,
  sidebarVariant: "project" as "project" | "orchestration",
  navigate: vi.fn(),
  updateSettings: vi.fn<(patch: { sidebarVariant: "project" | "orchestration" }) => void>(),
  buttonPropsByLabel: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: (options?: { select?: (location: { pathname: string }) => unknown }) => {
    const location = { pathname: state.pathname };
    return options?.select ? options.select(location) : location;
  },
  useNavigate: () => state.navigate,
  useRouterState: (options?: {
    select?: (state: { location: { pathname: string } }) => unknown;
  }) => {
    const routerState = { location: { pathname: state.pathname } };
    return options?.select ? options.select(routerState) : routerState;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: undefined,
  }),
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

vi.mock("~/features/vxapp/vortexAppsReactQuery", () => ({
  vortexAppsListQueryOptions: () => ({
    queryKey: ["vortex-apps"],
    queryFn: async () => ({ catalog: { projects: [] } }),
  }),
}));

vi.mock("./ProjectFavicon", () => ({
  ProjectFavicon: () => null,
}));

vi.mock("./ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: PropsWithChildren<{ onClick?: () => void } & Record<string, unknown>>) =>
    (() => {
      const ariaLabel = props["aria-label"];
      if (typeof ariaLabel === "string") {
        state.buttonPropsByLabel.set(ariaLabel, { onClick, ...props });
      }
      return (
        <button onClick={onClick} type="button" {...props}>
          {children}
        </button>
      );
    })(),
}));

vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipPopup: ({ children }: PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({ children, render }: PropsWithChildren<{ render?: ReactNode }>) => (
    <>{render ?? children}</>
  ),
}));

vi.mock("./ui/sheet", () => ({
  Sheet: ({ children }: PropsWithChildren) => <>{children}</>,
  SheetDescription: ({ children }: PropsWithChildren) => <>{children}</>,
  SheetHeader: ({ children }: PropsWithChildren) => <>{children}</>,
  SheetPopup: ({ children }: PropsWithChildren) => <>{children}</>,
  SheetTitle: ({ children }: PropsWithChildren) => <>{children}</>,
  SheetTrigger: ({ children, render }: PropsWithChildren<{ render?: ReactNode }>) => (
    <>{render ?? children}</>
  ),
}));

vi.mock("./ui/sidebar", () => ({
  Sidebar: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarContent: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarFooter: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarHeader: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarMenu: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarMenuButton: ({
    children,
    onClick,
    ...props
  }: PropsWithChildren<{ onClick?: () => void } & Record<string, unknown>>) => (
    <button onClick={onClick} type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarMenuSub: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarMenuSubButton: ({
    children,
    onClick,
    ...props
  }: PropsWithChildren<{ onClick?: () => void } & Record<string, unknown>>) => (
    <button onClick={onClick} type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuSubItem: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  SidebarSeparator: () => null,
  SidebarTrigger: (props: Record<string, unknown>) => <button type="button" {...props} />,
}));

vi.mock("./sidebar/SidebarShared", () => ({
  VortexWordmark: () => <span>Vortex</span>,
}));

vi.mock("./ProjectSidebar", async () => {
  const actual = await vi.importActual<typeof import("./ProjectSidebar")>("./ProjectSidebar");
  return {
    ...actual,
    default: ({ mode }: { mode?: "app" | "standalone" }) => (
      <actual.ProjectSidebarShell {...(mode ? { mode } : {})}>
        <div data-mode={mode ?? "app"} data-testid="project-sidebar" />
      </actual.ProjectSidebarShell>
    ),
  };
});

vi.mock("~/features/vxapp/components/OrchestrationSidebar", async () => {
  const actual = await vi.importActual<
    typeof import("~/features/vxapp/components/OrchestrationSidebar")
  >("~/features/vxapp/components/OrchestrationSidebar");
  return {
    ...actual,
    default: ({ mode }: { mode?: "app" | "standalone" }) => (
      <actual.OrchestrationSidebarShell {...(mode ? { mode } : {})}>
        <div data-mode={mode ?? "app"} data-testid="orchestration-sidebar" />
      </actual.OrchestrationSidebarShell>
    ),
  };
});

vi.mock("./settings/SettingsAppSidebar", () => ({
  SettingsAppSidebar: () => <div data-testid="settings-sidebar" />,
}));

import Sidebar from "./Sidebar";

function renderSidebar(mode?: "app" | "standalone") {
  state.buttonPropsByLabel.clear();
  return renderToStaticMarkup(mode ? <Sidebar mode={mode} /> : <Sidebar />);
}

function getButtonPropsByLabel(label: string, message: string): Record<string, unknown> {
  const props = state.buttonPropsByLabel.get(label);
  if (!props) {
    throw new Error(message);
  }
  return props;
}

describe("Sidebar", () => {
  beforeEach(() => {
    state.pathname = "/";
    state.sidebarVariant = "project";
    state.navigate.mockReset();
    state.updateSettings.mockReset();
    state.buttonPropsByLabel.clear();
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

    renderSidebar();
    const controlProps = getButtonPropsByLabel(
      "Use orchestration sidebar",
      "Expected to find the orchestration sidebar switch control in the shared header.",
    );

    (controlProps.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderSidebar()).toContain('data-testid="orchestration-sidebar"');
  });

  it("switches from orchestration to project without navigating away from the current route", () => {
    state.pathname = "/projects/thread-1";
    state.sidebarVariant = "orchestration";

    renderSidebar();
    const controlProps = getButtonPropsByLabel(
      "Use standard sidebar",
      "Expected to find the standard sidebar switch control in the shared header.",
    );

    (controlProps.onClick as undefined | (() => void))?.();

    expect(state.updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderSidebar()).toContain('data-testid="project-sidebar"');
  });
});
