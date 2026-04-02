import type { CSSProperties } from "react";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider } from "./ui/sidebar";

const SIDEBAR_WINDOW_STYLE = {
  "--sidebar-width": "100%",
} as CSSProperties;

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
