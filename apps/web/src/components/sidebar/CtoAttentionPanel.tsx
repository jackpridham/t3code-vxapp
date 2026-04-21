import { TriangleAlertIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { getSidebarCtoAttentionKindLabel, type SidebarCtoAttentionGroup } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { SidebarGroup } from "../ui/sidebar";

function severityClassName(
  severity: SidebarCtoAttentionGroup["attentionItems"][number]["severity"],
) {
  switch (severity) {
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
}

export function CtoAttentionPanel({ groups }: { groups: readonly SidebarCtoAttentionGroup[] }) {
  const totalCount = groups.reduce((count, group) => count + group.attentionItems.length, 0);

  if (totalCount === 0) {
    return null;
  }

  return (
    <SidebarGroup className="px-2 py-2" data-testid="cto-attention-panel">
      <div className="mb-1 flex items-center gap-1.5 pl-2 pr-1.5">
        <TriangleAlertIcon className="size-3.5 text-amber-600/85 dark:text-amber-300/80" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          CTO Attention
        </span>
        <Badge className="h-4 shrink-0 border-0 bg-amber-500/12 px-1.5 text-[9px] font-medium leading-none text-amber-700 dark:text-amber-300">
          {totalCount}
        </Badge>
      </div>
      <div className="space-y-1">
        {groups.map((group) => (
          <div
            key={group.programId}
            className="rounded-md border border-border/70 bg-secondary/30 px-2 py-1.5"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/85">
                {group.programTitle}
              </span>
              {group.criticalCount > 0 ? (
                <Badge className="h-4 shrink-0 border-0 bg-red-500/12 px-1 text-[9px] font-medium leading-none text-red-600 dark:text-red-300">
                  {group.criticalCount} critical
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 space-y-1">
              {group.attentionItems.map((attentionItem) => (
                <div
                  key={attentionItem.attentionId}
                  className="min-w-0 rounded-md border border-border/60 bg-background/35 px-1.5 py-1"
                  title={attentionItem.summary}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-4 shrink-0 px-1 text-[9px] font-medium leading-none",
                        severityClassName(attentionItem.severity),
                      )}
                    >
                      {getSidebarCtoAttentionKindLabel(attentionItem.kind)}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/90">
                      {attentionItem.summary}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SidebarGroup>
  );
}
