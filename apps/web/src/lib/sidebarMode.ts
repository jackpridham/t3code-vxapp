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
