import { type ComponentType } from "react";
import { FolderIcon, NetworkIcon } from "lucide-react";
import type { SidebarVariant } from "@t3tools/contracts/settings";

export type SidebarSurfaceVariant = SidebarVariant | "settings";

export const SIDEBAR_VARIANTS = [
  {
    value: "project",
    label: "Use standard sidebar",
    settingsLabel: "Standard T3 sidebar",
    shortLabel: "T3",
    icon: FolderIcon,
  },
  {
    value: "orchestration",
    label: "Use orchestration sidebar",
    settingsLabel: "Orchestration sidebar",
    shortLabel: "Orch",
    icon: NetworkIcon,
  },
] as const satisfies ReadonlyArray<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  settingsLabel: string;
  shortLabel: string;
  value: SidebarVariant;
}>;

export const SIDEBAR_VARIANT_SETTINGS_LABELS = Object.fromEntries(
  SIDEBAR_VARIANTS.map((variant) => [variant.value, variant.settingsLabel]),
) as Record<SidebarVariant, string>;

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
