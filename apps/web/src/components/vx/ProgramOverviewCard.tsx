import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";

export type ProgramOverviewCardProps = {
  action?: ReactNode;
  className?: string;
  currentTodoId: string | null;
  description: string | null;
  executiveLabel: string | null;
  orchestratorLabel: string | null;
  scopeSummary: string | null;
  status: string | null;
  title: string;
  totalTodoCount: number;
  verdict: string | null;
};

export function formatProgramStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function programStatusTone(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "blocked":
      return "bg-red-500/12 text-red-700 dark:text-red-300";
    case "awaiting_founder":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
    case "awaiting_external":
      return "bg-orange-500/12 text-orange-700 dark:text-orange-300";
    case "closeout_in_progress":
      return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
    case "founder_review_ready":
      return "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300";
    case "completed":
      return "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function ProgramOverviewCard({
  action,
  className,
  currentTodoId,
  description,
  executiveLabel,
  orchestratorLabel,
  scopeSummary,
  status,
  title,
  totalTodoCount,
  verdict,
}: ProgramOverviewCardProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {status ? (
              <Badge className={cn("h-5 border-0 px-1.5 text-[10px]", programStatusTone(status))}>
                {formatProgramStatusLabel(status)}
              </Badge>
            ) : null}
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {totalTodoCount} total TODO{totalTodoCount === 1 ? "" : "s"}
            </Badge>
            {verdict ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                closeout {verdict}
              </Badge>
            ) : null}
          </div>
          <CardDescription className="mt-2 leading-relaxed">
            {description || "No summary recorded for this Program."}
          </CardDescription>
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardPanel className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Executive
          </div>
          <div className="mt-2">{executiveLabel ?? "Not assigned"}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Orchestrator
          </div>
          <div className="mt-2">{orchestratorLabel ?? "No orchestrator"}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Scope summary
          </div>
          <div className="mt-2">{scopeSummary ?? "No Program scope available"}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Current TODO
          </div>
          <div className="mt-2">{currentTodoId ?? "None selected"}</div>
        </div>
      </CardPanel>
    </Card>
  );
}
