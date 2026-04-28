import { autoAnimate } from "@formkit/auto-animate";
import { BotIcon, ChevronRightIcon, HardHatIcon, NetworkIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../ui/sidebar";

type PreviewStatus = "working" | "attention" | "ready";

type PreviewWorker = {
  id: string;
  title: string;
  status: PreviewStatus;
};

type PreviewOrchestrator = {
  id: string;
  projectName: string;
  modelLabel: string;
  sessionTitle: string;
  status: PreviewStatus;
  labels: readonly string[];
  wakeSummary?: string;
  workers: readonly PreviewWorker[];
};

type PreviewProgram = {
  id: string;
  title: string;
  status: PreviewStatus;
  orchestrator: PreviewOrchestrator;
};

type PreviewExecutive = {
  id: string;
  name: string;
  role: string;
  programs: readonly PreviewProgram[];
};

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

const PREVIEW_EXECUTIVE: PreviewExecutive = {
  id: "exec-cto",
  name: "CTO",
  role: "Executive",
  programs: [
    {
      id: "program-api-redesign",
      title: "API redesign",
      status: "working",
      orchestrator: {
        id: "orch-jasper",
        projectName: "Jasper",
        modelLabel: "codex",
        sessionTitle: "Current session",
        status: "working",
        labels: ["api-redesign", "active"],
        wakeSummary: "1 waiting",
        workers: [
          {
            id: "worker-schema",
            title: "Schema migration",
            status: "working",
          },
          {
            id: "worker-transport",
            title: "Transport cleanup",
            status: "ready",
          },
        ],
      },
    },
    {
      id: "program-ui-observability",
      title: "UI observability",
      status: "attention",
      orchestrator: {
        id: "orch-athena",
        projectName: "Athena",
        modelLabel: "claude",
        sessionTitle: "Current session",
        status: "attention",
        labels: ["observability", "decision"],
        wakeSummary: "decision required",
        workers: [
          {
            id: "worker-notify",
            title: "Notification lineage",
            status: "attention",
          },
        ],
      },
    },
    {
      id: "program-web-foundations",
      title: "Web foundations",
      status: "ready",
      orchestrator: {
        id: "orch-mercury",
        projectName: "Mercury",
        modelLabel: "codex",
        sessionTitle: "Current session",
        status: "ready",
        labels: ["web", "queued"],
        workers: [],
      },
    },
  ],
};

const DEFAULT_OPEN_PROGRAM_IDS = new Set<string>([
  "program-api-redesign",
  "program-ui-observability",
]);

const DEFAULT_OPEN_ORCHESTRATOR_IDS = new Set<string>(["orch-jasper"]);

function statusClasses(status: PreviewStatus) {
  switch (status) {
    case "working":
      return {
        badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        icon: "text-sky-600 dark:text-sky-300",
        label: "Working",
      };
    case "attention":
      return {
        badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        icon: "text-amber-600 dark:text-amber-300",
        label: "Attention",
      };
    case "ready":
      return {
        badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        icon: "text-emerald-600 dark:text-emerald-300",
        label: "Ready",
      };
  }
}

function PreviewStatusBadge({ status }: { status: PreviewStatus }) {
  const resolved = statusClasses(status);

  return (
    <Badge
      variant="outline"
      className={cn("h-3.5 shrink-0 px-1 text-[8px] leading-none", resolved.badge)}
    >
      {resolved.label}
    </Badge>
  );
}

function PreviewStatusProgramIcon({ status }: { status: PreviewStatus }) {
  const resolved = statusClasses(status);
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", resolved.icon)}
    >
      <NetworkIcon className="size-3" />
    </span>
  );
}

function PreviewStatusTooltip({ icon, status }: { icon: React.ReactNode; status: PreviewStatus }) {
  const resolved = statusClasses(status);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={resolved.label}
            className="inline-flex size-4 shrink-0 items-center justify-center"
          >
            {icon}
          </span>
        }
      />
      <TooltipPopup side="top">{resolved.label}</TooltipPopup>
    </Tooltip>
  );
}

function toggleItem(current: ReadonlySet<string>, itemId: string) {
  const next = new Set(current);
  if (next.has(itemId)) {
    next.delete(itemId);
  } else {
    next.add(itemId);
  }
  return next;
}

export function SidebarOrchestrationPreview() {
  const [openProgramIds, setOpenProgramIds] =
    useState<ReadonlySet<string>>(DEFAULT_OPEN_PROGRAM_IDS);
  const [openOrchestratorIds, setOpenOrchestratorIds] = useState<ReadonlySet<string>>(
    DEFAULT_OPEN_ORCHESTRATOR_IDS,
  );
  const animatedListsRef = useRef(new WeakSet<HTMLElement>());
  const attachAnimatedListRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedListsRef.current.add(node);
  }, []);

  return (
    <SidebarGroup className="px-2 py-2" data-testid="sidebar-orchestration-preview">
      <div>
        <SidebarMenu>
          <SidebarMenuItem className="rounded-md">
            <SidebarMenuButton
              size="sm"
              className="h-auto min-h-7 gap-2 px-2 py-1.5"
              render={<button type="button" />}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                <BotIcon className="size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[11px] font-medium text-foreground/90">
                    {PREVIEW_EXECUTIVE.name}
                  </span>
                  <Badge
                    variant="outline"
                    className="h-3.5 shrink-0 border-emerald-500/25 bg-emerald-500/8 px-1 text-[8px] leading-none text-emerald-700 dark:text-emerald-300"
                  >
                    {PREVIEW_EXECUTIVE.role}
                  </Badge>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarMenuSub ref={attachAnimatedListRef} className="mx-1 mt-1 gap-1 px-1.5">
          {PREVIEW_EXECUTIVE.programs.map((program) => {
            const programOpen = openProgramIds.has(program.id);
            const orchestratorOpen = openOrchestratorIds.has(program.orchestrator.id);

            return (
              <SidebarMenuSubItem key={program.id} className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  size="sm"
                  className="h-auto min-h-7 w-full items-start px-2 py-1.5"
                  onClick={() => {
                    setOpenProgramIds((current) => toggleItem(current, program.id));
                  }}
                >
                  <ChevronRightIcon
                    className={cn(
                      "mt-0.5 size-3 shrink-0 text-muted-foreground/70 transition-transform",
                      programOpen ? "rotate-90" : "",
                    )}
                  />
                  <PreviewStatusTooltip
                    status={program.status}
                    icon={<PreviewStatusProgramIcon status={program.status} />}
                  />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground/90">
                        {program.title}
                      </span>
                    </div>
                  </div>
                </SidebarMenuSubButton>

                {programOpen ? (
                  <div ref={attachAnimatedListRef} className="ml-3 border-l border-border/50 pl-2">
                    <div className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute top-3 left-0 h-px w-2 -translate-x-full bg-border/60"
                      />
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent/40"
                        onClick={() => {
                          setOpenOrchestratorIds((current) =>
                            toggleItem(current, program.orchestrator.id),
                          );
                        }}
                      >
                        <ChevronRightIcon
                          className={cn(
                            "mt-0.5 size-3 shrink-0 text-muted-foreground/70 transition-transform",
                            orchestratorOpen ? "rotate-90" : "",
                          )}
                        />
                        <PreviewStatusTooltip
                          status={program.orchestrator.status}
                          icon={
                            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
                              <BotIcon className="size-3" />
                            </span>
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[11px] font-medium text-foreground/90">
                              {program.orchestrator.projectName}
                            </span>
                            <Badge
                              variant="outline"
                              className="h-4 min-w-0 max-w-20 shrink-0 px-1 text-[9px] font-medium leading-none text-muted-foreground/80 lowercase"
                            >
                              <span className="truncate">{program.orchestrator.modelLabel}</span>
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="truncate text-[10px] text-muted-foreground/75">
                              {program.orchestrator.sessionTitle}
                            </span>
                            {program.orchestrator.wakeSummary ? (
                              <Badge className="h-3.5 shrink-0 border-0 bg-amber-500/12 px-1 text-[8px] font-medium leading-none text-amber-700 dark:text-amber-300">
                                {program.orchestrator.wakeSummary}
                              </Badge>
                            ) : null}
                            {program.orchestrator.labels.map((label) => (
                              <Badge
                                key={label}
                                variant="outline"
                                title={label}
                                className="h-4 min-w-0 max-w-20 shrink-0 px-1 text-[9px] font-medium leading-none text-muted-foreground/80 lowercase"
                              >
                                <span className="truncate">{label}</span>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </button>

                      {orchestratorOpen ? (
                        <div
                          ref={attachAnimatedListRef}
                          className="ml-3 border-l border-border/50 pl-2"
                        >
                          {program.orchestrator.workers.length > 0 ? (
                            <div ref={attachAnimatedListRef} className="space-y-1">
                              {program.orchestrator.workers.map((worker) => (
                                <div
                                  key={worker.id}
                                  className="relative flex items-start gap-2 px-2 py-1.5"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="absolute top-3 left-0 h-px w-2 -translate-x-full bg-border/60"
                                  />
                                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-300">
                                    <HardHatIcon className="size-3" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <span className="truncate text-[10px] font-medium text-foreground/85">
                                        {worker.title}
                                      </span>
                                      <PreviewStatusBadge status={worker.status} />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="relative px-2 py-1.5 text-[10px] text-muted-foreground/70">
                              <span
                                aria-hidden="true"
                                className="absolute top-3 left-0 h-px w-2 -translate-x-full bg-border/60"
                              />
                              No workers
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      </div>
    </SidebarGroup>
  );
}
