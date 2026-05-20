import { createFileRoute } from "@tanstack/react-router";

import { ProgramsTodosView } from "~/features/vxapp/components/ProgramsTodosView";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";

function ProgramsRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <header className="border-b border-border px-3 py-2 sm:px-5">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <span className="text-sm font-medium text-foreground">Programs</span>
          </div>
        </header>
        <ProgramsTodosView />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/programs")({
  component: ProgramsRouteView,
});
