import { useLocation } from "@tanstack/react-router";
import { useSettings } from "~/hooks/useSettings";
import { resolveSidebarSurfaceVariant } from "~/lib/sidebarMode";
import { SettingsAppSidebar } from "./settings/SettingsAppSidebar";
import ProjectSidebar from "./ProjectSidebar";
import VxOrchestrationSidebar from "~/features/vxapp/components/OrchestrationSidebar";

export default function Sidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const sidebarVariant = useSettings((settings) => settings.sidebarVariant);
  const sidebarSurfaceVariant = resolveSidebarSurfaceVariant({
    pathname,
    sidebarVariant,
  });

  if (sidebarSurfaceVariant === "settings") {
    return <SettingsAppSidebar />;
  }

  if (sidebarSurfaceVariant === "orchestration") {
    return <VxOrchestrationSidebar mode={mode} />;
  }

  return <ProjectSidebar mode={mode} />;
}
