import { useLocation } from "@tanstack/react-router";
import { isElectron } from "../../env";
import { SidebarBrandHeader } from "../sidebar/SidebarBrandHeader";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

export function SettingsAppSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={false} />
      <SettingsSidebarNav pathname={pathname} />
    </>
  );
}
