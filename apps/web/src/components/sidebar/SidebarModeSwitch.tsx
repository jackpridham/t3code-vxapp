import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { SIDEBAR_VARIANTS } from "../../lib/sidebarMode";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function SidebarModeSwitch() {
  const sidebarVariant = useSettings((settings) => settings.sidebarVariant);
  const { updateSettings } = useUpdateSettings();

  return (
    <div
      aria-label="Sidebar mode switch"
      className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/70 p-0.5"
      role="group"
    >
      {SIDEBAR_VARIANTS.map(({ icon: Icon, label, shortLabel, value }) => {
        const isActive = value === sidebarVariant;

        return (
          <Button
            key={value}
            aria-label={label}
            aria-pressed={isActive}
            className={cn(
              "h-6 gap-1 rounded-sm px-1.5 text-[11px] font-medium sm:h-6",
              isActive
                ? "border-border bg-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => updateSettings({ sidebarVariant: value })}
            size="xs"
            title={label}
            variant="ghost"
          >
            <Icon className="size-3.5" />
            <span>{shortLabel}</span>
          </Button>
        );
      })}
    </div>
  );
}
