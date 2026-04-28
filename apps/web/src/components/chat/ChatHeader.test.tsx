import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatHeader } from "./ChatHeader";

const baseProps = {
  activeThreadLabels: [],
  activeThreadWorkerLineageIndicator: null,
  activeThreadId: ThreadId.makeUnsafe("thread-1"),
  activeThreadTitle: "Thread One",
  canRenameActiveThread: false,
  activeProjectName: "Project One",
  activeProjectHooks: undefined,
  terminalAvailable: true,
  terminalOpen: false,
  terminalToggleShortcutLabel: null,
  changesPanelShortcutLabel: null,
  changesPanelOpen: false,
  mobileSidebarOpen: false,
  showChangesDrawerToggle: true,
  onAddProjectHook: vi.fn(async () => {}),
  onUpdateProjectHook: vi.fn(async () => {}),
  onDeleteProjectHook: vi.fn(async () => {}),
  onToggleTerminal: vi.fn(),
  onToggleChangesPanel: vi.fn(),
  onOpenChangesWindow: vi.fn(),
};

describe("ChatHeader", () => {
  it("renders the dev orchestration toggle when enabled", () => {
    const markup = renderToStaticMarkup(
      <ChatHeader
        {...baseProps}
        showDevOrchestrationToggle
        devOrchestrationPanelOpen={false}
        onToggleDevOrchestrationPanel={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Toggle dev orchestration notifications"');
  });

  it("does not render the dev orchestration toggle when disabled", () => {
    const markup = renderToStaticMarkup(<ChatHeader {...baseProps} />);

    expect(markup).not.toContain('aria-label="Toggle dev orchestration notifications"');
  });
});
