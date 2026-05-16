export interface SidebarWakeBadge {
  className: string;
  label: string;
}

const SIDEBAR_WAKE_BADGE_CLASS_NAME =
  "h-4 shrink-0 border-0 bg-muted px-1 text-[9px] font-medium leading-none text-muted-foreground";

export function buildSidebarWakeBadge(
  openWakeCount: number | null | undefined,
): SidebarWakeBadge | null {
  if (!openWakeCount) {
    return null;
  }

  return {
    className: SIDEBAR_WAKE_BADGE_CLASS_NAME,
    label: openWakeCount === 1 ? "1 wake" : `${openWakeCount} wakes`,
  };
}
