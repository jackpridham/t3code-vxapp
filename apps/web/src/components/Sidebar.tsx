import { useSettings } from "~/hooks/useSettings";
import OrchestrationSidebar from "./OrchestrationSidebar";
import ProjectSidebar from "./ProjectSidebar";
import VxOrchestrationSidebar from "./vx/OrchestrationSidebar";

export default function Sidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const appSettings = useSettings();

  if (appSettings.sidebarOrchestrationModeEnabled) {
    if (import.meta.env.DEV) {
      return <VxOrchestrationSidebar mode={mode} />;
    }
    return <OrchestrationSidebar mode={mode} />;
  }

  return <ProjectSidebar mode={mode} />;
}
