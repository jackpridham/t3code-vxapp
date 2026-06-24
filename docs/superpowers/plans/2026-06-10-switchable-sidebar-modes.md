# Switchable Sidebar Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app sidebar explicitly switchable between the original T3 project/thread sidebar and the orchestration sidebar without losing normal T3 workflows.

**Architecture:** Keep both sidebar implementations alive and selectable behind one shared sidebar surface instead of treating orchestration as a one-way replacement. Replace the current boolean orchestration gate with an explicit client-side sidebar variant, centralize route-aware sidebar selection in one component, and add a fast in-sidebar switch plus a settings control so users can move between modes without leaving the current thread.

**Tech Stack:** React 19, TanStack Router, TanStack React Query, Zustand, Effect Schema, Vitest, Bun

---

## Current State Review

- `apps/web/src/components/Sidebar.tsx` currently hard-switches the entire sidebar implementation with `sidebarOrchestrationModeEnabled`, so only one sidebar tree exists at runtime.
- `apps/web/src/components/AppSidebarLayout.tsx` special-cases settings routes and otherwise mounts that hard-switched sidebar surface.
- `apps/web/src/components/SidebarWindow.tsx` mounts the same hard-switched sidebar for `/sidebar` and `/sidebar/$threadId`.
- `packages/contracts/src/settings.ts` still models the choice as `sidebarOrchestrationModeEnabled: boolean`, and its decoding default is `true`, so orchestration mode is the default experience in this fork.
- The parent baseline in `.parent/t3code/apps/web/src/components/AppSidebarLayout.tsx` only mounted the standard thread sidebar; the fork added the hard orchestration replacement after the fork point.
- `apps/web/src/components/ProjectSidebar.tsx` and `apps/web/src/features/vxapp/components/OrchestrationSidebar.tsx` already share `SidebarBrandHeader`, which is the lowest-risk place to add a mode switch without duplicating chrome.

## File Structure

- Modify: `packages/contracts/src/settings.ts`
  - Replace the boolean sidebar mode flag with an explicit `SidebarVariant` literal union and default it to the standard T3 sidebar.
- Modify: `apps/web/src/hooks/useSettings.ts`
  - Migrate legacy `sidebarOrchestrationModeEnabled` values into the new variant setting while preserving existing local storage.
- Modify: `apps/web/src/hooks/useSettings.test.ts`
  - Lock down default and migration behavior for the new sidebar variant.
- Create: `apps/web/src/lib/sidebarMode.ts`
  - Own route-aware sidebar variant resolution helpers used by both app and standalone sidebar surfaces.
- Create: `apps/web/src/lib/sidebarMode.test.ts`
  - Pure tests for route-to-variant resolution.
- Modify: `apps/web/src/components/Sidebar.tsx`
  - Become the single route-aware sidebar surface that selects `ProjectSidebar`, `VxOrchestrationSidebar`, or `SettingsAppSidebar`.
- Modify: `apps/web/src/components/AppSidebarLayout.tsx`
  - Stop duplicating sidebar route branching that now belongs in `Sidebar.tsx`; preserve the parent layout’s shell behavior.
- Modify: `apps/web/src/components/SidebarWindow.tsx`
  - Reuse the same unified sidebar surface in standalone mode.
- Create: `apps/web/src/components/Sidebar.test.tsx`
  - Verify sidebar surface selection for normal, orchestration, and settings routes.
- Create: `apps/web/src/components/sidebar/SidebarModeSwitch.tsx`
  - Render the user-facing mode toggle shared by both sidebar variants.
- Create: `apps/web/src/components/sidebar/SidebarModeSwitch.test.tsx`
  - Verify that the header switch updates the client sidebar variant.
- Modify: `apps/web/src/components/sidebar/SidebarBrandHeader.tsx`
  - Host the mode switch without duplicating it in each sidebar implementation.
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`
  - Replace the boolean switch with an explicit sidebar variant control and keep orchestration-only settings subordinate to the orchestration choice.
- Create: `apps/web/src/components/settings/SettingsPanels.test.tsx`
  - Verify that the orchestration settings page exposes the new sidebar variant control.
- Modify: `apps/web/src/features/vxapp/components/OrchestrationSidebar.tsx`
  - Consume the shared header switch and remove assumptions that it is the only sidebar experience.
- Modify: `apps/web/src/components/ProjectSidebar.tsx`
  - Consume the shared header switch and preserve the original T3 sidebar behavior when selected.

### Task 1: Replace the Boolean Setting with an Explicit Sidebar Variant

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Modify: `apps/web/src/hooks/useSettings.ts`
- Modify: `apps/web/src/hooks/useSettings.test.ts`

- [ ] **Step 1: Write the failing settings migration test**

```ts
it("defaults the sidebar variant to the standard project sidebar", () => {
  expect(DEFAULT_CLIENT_SETTINGS.sidebarVariant).toBe("project");
});

it("migrates legacy sidebarOrchestrationModeEnabled=true to the orchestration variant", () => {
  expect(
    buildLegacyClientSettingsMigrationPatch({
      sidebarOrchestrationModeEnabled: true,
    }),
  ).toMatchObject({
    sidebarVariant: "orchestration",
  });
});

it("migrates legacy sidebarOrchestrationModeEnabled=false to the project variant", () => {
  expect(
    buildLegacyClientSettingsMigrationPatch({
      sidebarOrchestrationModeEnabled: false,
    }),
  ).toMatchObject({
    sidebarVariant: "project",
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `cd apps/web && bun run test src/hooks/useSettings.test.ts -t "sidebar variant"`

Expected: FAIL because `DEFAULT_CLIENT_SETTINGS.sidebarVariant` and the migration mapping do not exist yet.

- [ ] **Step 3: Implement the schema and migration change**

```ts
export const SidebarVariant = Schema.Literals(["project", "orchestration"]);
export type SidebarVariant = typeof SidebarVariant.Type;
export const DEFAULT_SIDEBAR_VARIANT: SidebarVariant = "project";

export const ClientSettingsSchema = Schema.Struct({
  allowActiveThreadsInFold: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarVariant: SidebarVariant.pipe(Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_VARIANT)),
  sidebarOrchestrationDataMode: SidebarOrchestrationDataMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_ORCHESTRATION_DATA_MODE),
  ),
  // ...
});
```

```ts
if (Predicate.isBoolean(legacySettings.sidebarOrchestrationModeEnabled)) {
  patch.sidebarVariant = legacySettings.sidebarOrchestrationModeEnabled
    ? "orchestration"
    : "project";
}
```

- [ ] **Step 4: Update the existing settings tests to assert the new default**

```ts
describe("DEFAULT_CLIENT_SETTINGS", () => {
  it("defaults the sidebar variant to project", () => {
    expect(DEFAULT_CLIENT_SETTINGS.sidebarVariant).toBe("project");
  });
});
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `cd apps/web && bun run test src/hooks/useSettings.test.ts -t "sidebar variant"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/settings.ts apps/web/src/hooks/useSettings.ts apps/web/src/hooks/useSettings.test.ts
git commit -m "refactor: replace sidebar mode boolean with explicit variant"
```

### Task 2: Centralize Sidebar Surface Selection

**Files:**

- Create: `apps/web/src/lib/sidebarMode.ts`
- Create: `apps/web/src/lib/sidebarMode.test.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/AppSidebarLayout.tsx`
- Modify: `apps/web/src/components/SidebarWindow.tsx`
- Create: `apps/web/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write failing tests for route-aware sidebar resolution**

```ts
describe("resolveSidebarSurfaceVariant", () => {
  it("returns settings for settings routes regardless of the stored sidebar variant", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/settings/orchestration",
        sidebarVariant: "project",
      }),
    ).toBe("settings");
  });

  it("returns the stored project variant for chat routes", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/",
        sidebarVariant: "project",
      }),
    ).toBe("project");
  });

  it("returns the stored orchestration variant for chat routes", () => {
    expect(
      resolveSidebarSurfaceVariant({
        pathname: "/projects/thread-1",
        sidebarVariant: "orchestration",
      }),
    ).toBe("orchestration");
  });
});
```

```tsx
it("renders the settings sidebar on settings routes", () => {
  renderSidebarSurface({
    initialPath: "/settings/general",
    sidebarVariant: "orchestration",
  });

  expect(screen.getByText("settings-sidebar")).toBeInTheDocument();
});

it("renders the project sidebar when the stored variant is project", () => {
  renderSidebarSurface({
    initialPath: "/",
    sidebarVariant: "project",
  });

  expect(screen.getByText("project-sidebar")).toBeInTheDocument();
});

it("renders the orchestration sidebar when the stored variant is orchestration", () => {
  renderSidebarSurface({
    initialPath: "/",
    sidebarVariant: "orchestration",
  });

  expect(screen.getByText("orchestration-sidebar")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `cd apps/web && bun run test src/lib/sidebarMode.test.ts src/components/Sidebar.test.tsx`

Expected: FAIL because the helper and unified sidebar surface do not exist yet.

- [ ] **Step 3: Add the shared route-aware sidebar helper**

```ts
import type { SidebarVariant } from "@t3tools/contracts/settings";

export type SidebarSurfaceVariant = SidebarVariant | "settings";

export function isSettingsSidebarPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function resolveSidebarSurfaceVariant(input: {
  pathname: string;
  sidebarVariant: SidebarVariant;
}): SidebarSurfaceVariant {
  if (isSettingsSidebarPath(input.pathname)) {
    return "settings";
  }

  return input.sidebarVariant;
}
```

- [ ] **Step 4: Refactor the sidebar surface and layout wiring**

```tsx
export default function Sidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sidebarVariant = useSettings((settings) => settings.sidebarVariant);
  const surfaceVariant = resolveSidebarSurfaceVariant({
    pathname,
    sidebarVariant,
  });

  if (surfaceVariant === "settings") {
    return <SettingsAppSidebar />;
  }

  return surfaceVariant === "orchestration" ? (
    <VxOrchestrationSidebar mode={mode} />
  ) : (
    <ProjectSidebar mode={mode} />
  );
}
```

```tsx
export function AppSidebarLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
```

```tsx
export function SidebarWindow() {
  return (
    <div className="h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground">
      <SidebarProvider
        defaultOpen
        open
        className="h-full min-h-0 w-full"
        style={SIDEBAR_WINDOW_STYLE}
      >
        <Sidebar
          side="left"
          collapsible="none"
          className="h-full w-full border-r-0 bg-card text-foreground"
        >
          <ThreadSidebar mode="standalone" />
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}
```

- [ ] **Step 5: Add the component test harness for the unified surface**

```tsx
vi.mock("./ProjectSidebar", () => ({
  default: () => <div>project-sidebar</div>,
}));

vi.mock("~/features/vxapp/components/OrchestrationSidebar", () => ({
  default: () => <div>orchestration-sidebar</div>,
}));

vi.mock("./settings/SettingsAppSidebar", () => ({
  SettingsAppSidebar: () => <div>settings-sidebar</div>,
}));
```

- [ ] **Step 6: Run the focused tests to verify they pass**

Run: `cd apps/web && bun run test src/lib/sidebarMode.test.ts src/components/Sidebar.test.tsx`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/sidebarMode.ts apps/web/src/lib/sidebarMode.test.ts apps/web/src/components/Sidebar.tsx apps/web/src/components/AppSidebarLayout.tsx apps/web/src/components/SidebarWindow.tsx apps/web/src/components/Sidebar.test.tsx
git commit -m "refactor: centralize sidebar surface selection"
```

### Task 3: Add an In-Sidebar Mode Switch and Replace the Settings Toggle

**Files:**

- Create: `apps/web/src/components/sidebar/SidebarModeSwitch.tsx`
- Create: `apps/web/src/components/sidebar/SidebarModeSwitch.test.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarBrandHeader.tsx`
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`
- Create: `apps/web/src/components/settings/SettingsPanels.test.tsx`

- [ ] **Step 1: Write the failing UI tests for switching sidebar variants**

```tsx
const mockUseSettings = vi.fn();
const mockUseUpdateSettings = vi.fn();

vi.mock("~/hooks/useSettings", () => ({
  useSettings: mockUseSettings,
  useUpdateSettings: mockUseUpdateSettings,
}));

it("updates the client setting when the project sidebar mode button is pressed", async () => {
  const updateSettings = vi.fn();
  mockUseSettings.mockReturnValue({ sidebarVariant: "orchestration" });
  mockUseUpdateSettings.mockReturnValue({ updateSettings, resetSettings: vi.fn() });

  render(<SidebarModeSwitch />);

  await user.click(screen.getByRole("button", { name: "Use standard sidebar" }));

  expect(updateSettings).toHaveBeenCalledWith({ sidebarVariant: "project" });
});

it("updates the client setting when the orchestration sidebar mode button is pressed", async () => {
  const updateSettings = vi.fn();
  mockUseSettings.mockReturnValue({ sidebarVariant: "project" });
  mockUseUpdateSettings.mockReturnValue({ updateSettings, resetSettings: vi.fn() });

  render(<SidebarModeSwitch />);

  await user.click(screen.getByRole("button", { name: "Use orchestration sidebar" }));

  expect(updateSettings).toHaveBeenCalledWith({ sidebarVariant: "orchestration" });
});
```

```tsx
it("renders the sidebar variant select in orchestration settings", () => {
  render(<OrchestrationSettingsPanel />);

  expect(screen.getByLabelText("Sidebar mode")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `cd apps/web && bun run test src/components/sidebar/SidebarModeSwitch.test.tsx src/components/settings/SettingsPanels.test.tsx`

Expected: FAIL because the mode switch component and settings control do not exist yet.

- [ ] **Step 3: Implement the shared mode switch component**

```tsx
import { FolderIcon, NetworkIcon } from "lucide-react";
import type { SidebarVariant } from "@t3tools/contracts/settings";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

const SIDEBAR_VARIANTS: readonly {
  value: SidebarVariant;
  label: string;
  shortLabel: string;
  icon: typeof FolderIcon;
}[] = [
  { value: "project", label: "Use standard sidebar", shortLabel: "T3", icon: FolderIcon },
  {
    value: "orchestration",
    label: "Use orchestration sidebar",
    shortLabel: "Orch",
    icon: NetworkIcon,
  },
];

export function SidebarModeSwitch() {
  const sidebarVariant = useSettings((settings) => settings.sidebarVariant);
  const { updateSettings } = useUpdateSettings();

  return (
    <div className="hidden items-center gap-1 rounded-md border border-border/60 bg-background/70 p-0.5 md:flex">
      {SIDEBAR_VARIANTS.map((item) => {
        const Icon = item.icon;
        const isActive = item.value === sidebarVariant;

        return (
          <Button
            key={item.value}
            aria-label={item.label}
            className={cn(
              "h-7 gap-1.5 px-2 text-[11px]",
              isActive
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "text-muted-foreground",
            )}
            onClick={() => updateSettings({ sidebarVariant: item.value })}
            size="sm"
            type="button"
            variant={isActive ? "default" : "ghost"}
          >
            <Icon className="size-3.5" />
            <span>{item.shortLabel}</span>
          </Button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Mount the switch in the shared header and replace the settings boolean**

```tsx
<div className="flex w-full min-w-0 items-center gap-2">
  {!isStandaloneWindow ? <SidebarTrigger className="shrink-0 md:hidden" /> : null}
  <SidebarBrandMark />
  <SidebarModeSwitch />
  <SidebarNavigationMenu />
</div>
```

```tsx
<SettingsRow
  title="Sidebar mode"
  description="Choose whether the left sidebar shows the standard T3 project navigator or the orchestration navigator."
  control={
    <Select
      value={settings.sidebarVariant}
      onValueChange={(value) =>
        updateSettings({ sidebarVariant: value as "project" | "orchestration" })
      }
    >
      <SelectTrigger aria-label="Sidebar mode" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="project">Standard T3 sidebar</SelectItem>
        <SelectItem value="orchestration">Orchestration sidebar</SelectItem>
      </SelectPopup>
    </Select>
  }
/>
```

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `cd apps/web && bun run test src/components/sidebar/SidebarModeSwitch.test.tsx src/components/settings/SettingsPanels.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarModeSwitch.tsx apps/web/src/components/sidebar/SidebarModeSwitch.test.tsx apps/web/src/components/sidebar/SidebarBrandHeader.tsx apps/web/src/components/settings/SettingsPanels.tsx apps/web/src/components/settings/SettingsPanels.test.tsx
git commit -m "feat: add switchable sidebar mode controls"
```

### Task 4: Harden Coexistence Between the Standard and Orchestration Sidebars

**Files:**

- Modify: `apps/web/src/components/ProjectSidebar.tsx`
- Modify: `apps/web/src/features/vxapp/components/OrchestrationSidebar.tsx`
- Modify: `apps/web/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing coexistence tests**

```tsx
it("keeps the current route mounted while switching sidebar variants", async () => {
  renderSidebarSurface({
    initialPath: "/projects/thread-1",
    sidebarVariant: "project",
  });

  await user.click(screen.getByRole("button", { name: "Use orchestration sidebar" }));

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByText("orchestration-sidebar")).toBeInTheDocument();
});

it("can switch back to the project sidebar without leaving the current thread route", async () => {
  renderSidebarSurface({
    initialPath: "/projects/thread-1",
    sidebarVariant: "orchestration",
  });

  await user.click(screen.getByRole("button", { name: "Use standard sidebar" }));

  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByText("project-sidebar")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused coexistence test to verify it fails**

Run: `cd apps/web && bun run test src/components/Sidebar.test.tsx -t "switch"`

Expected: FAIL because the shared header switch is not yet wired through both sidebar variants cleanly.

- [ ] **Step 3: Remove exclusive-ownership assumptions from both sidebars**

```tsx
export default function ProjectSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const isStandaloneWindow = mode === "standalone";

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={isStandaloneWindow} />
      <SidebarContent>{/* existing project/thread body stays unchanged */}</SidebarContent>
      <SidebarFooter>{/* existing footer stays unchanged */}</SidebarFooter>
    </>
  );
}
```

```tsx
export default function VxOrchestrationSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const isStandaloneWindow = mode === "standalone";

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={isStandaloneWindow} />
      <SidebarContent>{/* existing orchestration body stays unchanged */}</SidebarContent>
    </>
  );
}
```

- [ ] **Step 4: Extend the sidebar surface test to prove bidirectional switching**

```tsx
const updateSettings = vi.fn((patch: { sidebarVariant: "project" | "orchestration" }) => {
  currentSidebarVariant = patch.sidebarVariant;
  rerenderWithVariant(currentSidebarVariant);
});
```

- [ ] **Step 5: Run the focused test and then the full required checks**

Run: `cd apps/web && bun run test src/components/Sidebar.test.tsx`
Expected: PASS

Run: `bun fmt`
Expected: PASS

Run: `bun lint`
Expected: PASS

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ProjectSidebar.tsx apps/web/src/features/vxapp/components/OrchestrationSidebar.tsx apps/web/src/components/Sidebar.test.tsx
git commit -m "test: harden switchable sidebar coexistence"
```

## Acceptance Criteria

- The standard T3 sidebar remains available as a first-class option even when orchestration features are enabled elsewhere in the app.
- Users can switch between `project` and `orchestration` sidebar variants from inside the sidebar itself and from settings.
- Settings routes still show `SettingsAppSidebar` regardless of the selected sidebar variant.
- `/sidebar` and `/sidebar/$threadId` use the same sidebar variant logic as the main app shell.
- The default sidebar variant for fresh local settings is the standard T3 project sidebar.
- Existing users with `sidebarOrchestrationModeEnabled` persisted locally are migrated deterministically to the matching sidebar variant.
