import { useSettings } from "~/hooks/useSettings";
import OrchestrationSidebar from "./OrchestrationSidebar";
import ProjectSidebar from "./ProjectSidebar";

export default function Sidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const appSettings = useSettings();

  if (appSettings.sidebarOrchestrationModeEnabled) {
    return <OrchestrationSidebar mode={mode} />;
  }

  return <ProjectSidebar mode={mode} />;
}
