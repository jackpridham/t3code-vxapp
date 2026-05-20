import { useSettings } from "~/hooks/useSettings";
import ProjectSidebar from "./ProjectSidebar";
import VxOrchestrationSidebar from "~/features/vxapp/components/OrchestrationSidebar";

export default function Sidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const appSettings = useSettings();

  if (appSettings.sidebarOrchestrationModeEnabled) {
    return <VxOrchestrationSidebar mode={mode} />;
  }

  return <ProjectSidebar mode={mode} />;
}
