import { autoAnimate } from "@formkit/auto-animate";
import {
  BellIcon,
  BotIcon,
  ChevronRightIcon,
  HardHatIcon,
  LightbulbIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { vortexAppsListQueryOptions } from "~/lib/vortexAppsReactQuery";
import { SidebarBrandHeader } from "../sidebar/SidebarBrandHeader";
import type { SidebarThreadStatus } from "../sidebar/SidebarThreadRow";
import { Badge } from "../ui/badge";
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type PreviewWorkerRuntimeAuditStatus,
  type PreviewWorkerRuntimeFixtureId,
  type PreviewWorkerRuntimeSnapshot,
  resolvePreviewWorkerRuntimeSnapshot,
} from "./workerRuntimePreview";

type PreviewStatus = "working" | "attention" | "ready";
type PreviewNotificationSeverity = "critical" | "warning" | "info";
type PreviewWakeState = "active" | "queued" | "waiting" | "waking";

type PreviewWorker = {
  appTargetId: string;
  fallbackAppLabel: string;
  id: string;
  runtimeFixtureId?: PreviewWorkerRuntimeFixtureId | null;
  wakeState?: PreviewWakeState;
  status: PreviewStatus;
};

type PreviewOrchestrator = {
  id: string;
  label: string;
  projectName: string;
  status: PreviewStatus;
  workers: readonly PreviewWorker[];
};

type PreviewProgram = {
  id: string;
  title: string;
  status: PreviewStatus;
  orchestrator: PreviewOrchestrator;
};

type PreviewExecutiveNotification = {
  id: string;
  kindLabel: string;
  programTitle: string;
  relativeTime: string;
  severity: PreviewNotificationSeverity;
  sourceLabel: string;
  summary: string;
};

type PreviewExecutive = {
  id: string;
  name: string;
  notifications: readonly PreviewExecutiveNotification[];
  role: string;
  programs: readonly PreviewProgram[];
};

type ExecutiveNotificationSummary = {
  criticalCount: number;
  highestSeverity: PreviewNotificationSeverity | null;
  infoCount: number;
  totalCount: number;
  warningCount: number;
};

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

const VX_SIDEBAR_CHIP_CLASSNAME =
  "h-2.5 shrink-0 px-1 text-[7px] font-medium leading-none text-muted-foreground/80 lowercase";
const VX_SIDEBAR_STATUS_CHIP_CLASSNAME =
  "h-3 shrink-0 px-1 text-[6px] font-medium leading-none text-muted-foreground/80 lowercase border-0";
const VX_SIDEBAR_ORCHESTRATOR_CHIP_CLASSNAME = `${VX_SIDEBAR_CHIP_CLASSNAME} bg-secondary/80`;
const VX_SIDEBAR_WORKER_LIST_CLASSNAME = "space-y-0.5";
const VX_SIDEBAR_WORKER_ROW_CLASSNAME = "relative flex items-center gap-1 px-1.5 py-1";
const VX_SIDEBAR_WORKER_REPO_CHIP_CLASSNAME = `${VX_SIDEBAR_STATUS_CHIP_CLASSNAME} min-w-0 bg-secondary/80`;
const VX_SIDEBAR_WORKER_STATE_CHIP_CLASSNAME = VX_SIDEBAR_STATUS_CHIP_CLASSNAME;
const VX_WORKER_RUNTIME_PANEL_CHIP_CLASSNAME =
  "h-5 shrink-0 px-1.5 text-[10px] font-medium leading-none border-0";

const PREVIEW_EXECUTIVE: PreviewExecutive = {
  id: "exec-cto",
  name: "CTOv2",
  notifications: [
    {
      id: "exec-notification-closeout-approval",
      kindLabel: "approval",
      programTitle: "stores external closeout dependency cleanup",
      relativeTime: "2m",
      severity: "critical",
      sourceLabel: "Jasper / agents",
      summary: "Worker approval is blocking the external dependency closeout lane.",
    },
    {
      id: "exec-notification-runtime-gate-drift",
      kindLabel: "drift",
      programTitle: "preserved lane runtime gate drift repair",
      relativeTime: "7m",
      severity: "warning",
      sourceLabel: "Jasper / scripts",
      summary: "Runtime gate expectations drifted from the preserved lane baseline again.",
    },
    {
      id: "exec-notification-managed-target-handoff",
      kindLabel: "handoff",
      programTitle: "stores-vxapp managed target enablement",
      relativeTime: "11m",
      severity: "info",
      sourceLabel: "Jasper / t3",
      summary: "Managed target enablement is ready for executive review and next-lane assignment.",
    },
    {
      id: "exec-notification-slave-shared-repo",
      kindLabel: "unblock",
      programTitle: "Slave site CRUD shared repo unblock",
      relativeTime: "18m",
      severity: "warning",
      sourceLabel: "Jasper / vue",
      summary: "Shared repo integration is waiting on a frontend-side decision before merge.",
    },
  ],
  role: "Executive",
  programs: [
    {
      id: "program-stores-closeout-dependency-cleanup",
      title: "stores external closeout dependency cleanup",
      status: "working",
      orchestrator: {
        id: "orch-jasper-stores-closeout",
        label: "closeout",
        projectName: "Jasper",
        status: "working",
        workers: [
          {
            appTargetId: "scripts",
            fallbackAppLabel: "scripts",
            id: "worker-stores-closeout-scripts",
            runtimeFixtureId: "stores-managed-target-scripts-c1",
            status: "working",
            wakeState: "waking",
          },
          {
            appTargetId: "agents",
            fallbackAppLabel: "agents",
            id: "worker-stores-closeout-agents",
            runtimeFixtureId: "stores-managed-target-agents-i1",
            status: "attention",
            wakeState: "queued",
          },
          {
            appTargetId: "t3",
            fallbackAppLabel: "t3",
            id: "worker-stores-closeout-t3",
            runtimeFixtureId: null,
            status: "ready",
          },
        ],
      },
    },
    {
      id: "program-preserved-lane-runtime-gate-drift-repair",
      title: "preserved lane runtime gate drift repair",
      status: "attention",
      orchestrator: {
        id: "orch-jasper-runtime-gate-drift",
        label: "runtime",
        projectName: "Jasper",
        status: "attention",
        workers: [
          {
            appTargetId: "scripts",
            fallbackAppLabel: "scripts",
            id: "worker-runtime-gate-scripts",
            runtimeFixtureId: "stores-managed-target-scripts-i1",
            status: "working",
            wakeState: "waking",
          },
          {
            appTargetId: "agents",
            fallbackAppLabel: "agents",
            id: "worker-runtime-gate-agents",
            runtimeFixtureId: "stores-managed-target-agents-c1",
            status: "attention",
            wakeState: "queued",
          },
        ],
      },
    },
    {
      id: "program-stores-gate-generated-output-alignment",
      title: "stores-vxapp gate and generated-output alignment",
      status: "working",
      orchestrator: {
        id: "orch-jasper-stores-generated-output",
        label: "alignment",
        projectName: "Jasper",
        status: "working",
        workers: [
          {
            appTargetId: "scripts",
            fallbackAppLabel: "scripts",
            id: "worker-generated-output-scripts",
            runtimeFixtureId: "stores-managed-target-scripts-probe",
            status: "working",
            wakeState: "waking",
          },
          {
            appTargetId: "agents",
            fallbackAppLabel: "agents",
            id: "worker-generated-output-agents",
            runtimeFixtureId: "stores-managed-target-agents-c1",
            status: "ready",
          },
          {
            appTargetId: "t3",
            fallbackAppLabel: "t3",
            id: "worker-generated-output-t3",
            runtimeFixtureId: null,
            status: "ready",
          },
        ],
      },
    },
    {
      id: "program-stores-managed-target-enablement",
      title: "stores-vxapp managed target enablement",
      status: "attention",
      orchestrator: {
        id: "orch-jasper-managed-target-enablement",
        label: "enablement",
        projectName: "Jasper",
        status: "attention",
        workers: [
          {
            appTargetId: "scripts",
            fallbackAppLabel: "scripts",
            id: "worker-managed-target-scripts",
            runtimeFixtureId: "stores-managed-target-scripts-c1",
            status: "working",
            wakeState: "waking",
          },
          {
            appTargetId: "agents",
            fallbackAppLabel: "agents",
            id: "worker-managed-target-agents",
            runtimeFixtureId: "stores-managed-target-agents-c1",
            status: "attention",
            wakeState: "queued",
          },
          {
            appTargetId: "t3",
            fallbackAppLabel: "t3",
            id: "worker-managed-target-t3",
            runtimeFixtureId: null,
            status: "ready",
          },
        ],
      },
    },
    {
      id: "program-slave-site-crud-shared-repo-unblock",
      title: "Slave site CRUD shared repo unblock",
      status: "working",
      orchestrator: {
        id: "orch-jasper-slave-shared-repo-unblock",
        label: "unblock",
        projectName: "Jasper",
        status: "working",
        workers: [
          {
            appTargetId: "slave",
            fallbackAppLabel: "slave",
            id: "worker-slave-shared-repo-slave",
            runtimeFixtureId: "partymore-slave-mobile-runtime-booking-followthrough-a1",
            status: "working",
            wakeState: "waking",
          },
          {
            appTargetId: "vue",
            fallbackAppLabel: "vue",
            id: "worker-slave-shared-repo-vue",
            runtimeFixtureId: "partymore-vue-order-create-admin-parity-r2",
            status: "attention",
            wakeState: "queued",
          },
          {
            appTargetId: "api",
            fallbackAppLabel: "api",
            id: "worker-slave-shared-repo-api",
            runtimeFixtureId: "api-services-ledger-hardening-r1",
            status: "ready",
          },
        ],
      },
    },
    {
      id: "program-slave-site-crud-foundation-repair",
      title: "Slave site CRUD foundation repair",
      status: "ready",
      orchestrator: {
        id: "orch-jasper-slave-foundation-repair",
        label: "foundation",
        projectName: "Jasper",
        status: "ready",
        workers: [
          {
            appTargetId: "slave",
            fallbackAppLabel: "slave",
            id: "worker-slave-foundation-slave",
            runtimeFixtureId: "partymore-slave-mobile-runtime-booking-followthrough-a1",
            status: "ready",
          },
          {
            appTargetId: "vue",
            fallbackAppLabel: "vue",
            id: "worker-slave-foundation-vue",
            runtimeFixtureId: "slave-site-crud-foundation-vue-i1",
            status: "ready",
          },
        ],
      },
    },
  ],
};

const DEFAULT_OPEN_PROGRAM_IDS = new Set<string>([
  "program-stores-closeout-dependency-cleanup",
  "program-preserved-lane-runtime-gate-drift-repair",
  "program-stores-managed-target-enablement",
  "program-slave-site-crud-shared-repo-unblock",
]);

const DEFAULT_OPEN_ORCHESTRATOR_IDS = new Set<string>([
  "orch-jasper-stores-closeout",
  "orch-jasper-managed-target-enablement",
  "orch-jasper-slave-shared-repo-unblock",
]);

function statusClasses(status: PreviewStatus) {
  switch (status) {
    case "working":
      return {
        icon: "text-sky-600 dark:text-sky-300",
        label: "Working",
      };
    case "attention":
      return {
        icon: "text-amber-600 dark:text-amber-300",
        label: "Attention",
      };
    case "ready":
      return {
        icon: "text-emerald-600 dark:text-emerald-300",
        label: "Ready",
      };
  }
}

function severityOrder(severity: PreviewNotificationSeverity) {
  switch (severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
  }
}

function buildExecutiveNotificationSummary(
  notifications: readonly PreviewExecutiveNotification[],
): ExecutiveNotificationSummary {
  return notifications.reduce<ExecutiveNotificationSummary>(
    (summary, notification) => {
      if (notification.severity === "critical") {
        summary.criticalCount += 1;
      } else if (notification.severity === "warning") {
        summary.warningCount += 1;
      } else {
        summary.infoCount += 1;
      }
      summary.totalCount += 1;

      if (
        summary.highestSeverity === null ||
        severityOrder(notification.severity) < severityOrder(summary.highestSeverity)
      ) {
        summary.highestSeverity = notification.severity;
      }

      return summary;
    },
    {
      criticalCount: 0,
      highestSeverity: null,
      infoCount: 0,
      totalCount: 0,
      warningCount: 0,
    },
  );
}

function notificationBellClasses(summary: ExecutiveNotificationSummary) {
  if (summary.highestSeverity === "critical") {
    return {
      badge: "bg-red-500 text-white dark:bg-red-400 dark:text-red-950",
      button:
        "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-400/10 dark:hover:text-red-200",
      ring: "ring-1 ring-red-500/20 dark:ring-red-400/20",
    };
  }
  if (summary.highestSeverity === "warning") {
    return {
      badge: "bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
      button:
        "text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-400/10 dark:hover:text-amber-200",
      ring: "ring-1 ring-amber-500/20 dark:ring-amber-400/20",
    };
  }
  if (summary.highestSeverity === "info") {
    return {
      badge: "bg-sky-500 text-white dark:bg-sky-400 dark:text-sky-950",
      button:
        "text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 dark:text-sky-300 dark:hover:bg-sky-400/10 dark:hover:text-sky-200",
      ring: "ring-1 ring-sky-500/20 dark:ring-sky-400/20",
    };
  }
  return {
    badge: "bg-muted text-muted-foreground",
    button:
      "text-muted-foreground/80 hover:bg-accent hover:text-foreground dark:text-muted-foreground/80",
    ring: "ring-1 ring-border/70",
  };
}

function notificationSeverityClasses(severity: PreviewNotificationSeverity) {
  switch (severity) {
    case "critical":
      return {
        badge: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
        dot: "bg-red-500 dark:bg-red-300",
        icon: "text-red-600 dark:text-red-300",
        surface: "border-red-500/20 bg-red-500/5",
      };
    case "warning":
      return {
        badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        dot: "bg-amber-500 dark:bg-amber-300",
        icon: "text-amber-600 dark:text-amber-300",
        surface: "border-amber-500/20 bg-amber-500/5",
      };
    case "info":
      return {
        badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        dot: "bg-sky-500 dark:bg-sky-300",
        icon: "text-sky-600 dark:text-sky-300",
        surface: "border-sky-500/20 bg-sky-500/5",
      };
  }
}

function runtimeAuditBadgeClasses(status: PreviewWorkerRuntimeAuditStatus) {
  switch (status) {
    case "clean":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "warning":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
    case "error":
      return "bg-red-500/12 text-red-700 dark:text-red-300";
    case "missing":
      return "bg-muted text-muted-foreground";
  }
}

function runtimeSourceFileBadgeClasses(
  status: PreviewWorkerRuntimeSnapshot["sourceFiles"]["contextPlan"]["status"],
) {
  switch (status) {
    case "loaded":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "missing":
      return "bg-muted text-muted-foreground";
    case "invalid-json":
      return "bg-red-500/12 text-red-700 dark:text-red-300";
    case "schema-error":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
  }
}

function runtimeFindingSeverityClasses(severity: string | null) {
  switch (severity) {
    case "error":
    case "critical":
      return "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-300";
    case "warning":
      return "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300";
    default:
      return "border-border/70 bg-secondary/20 text-foreground/85";
  }
}

function formatRuntimeListLabel(value: string) {
  const segments = value.split(":");
  return segments[segments.length - 1] ?? value;
}

function wakeBadgeClasses(state: PreviewWakeState) {
  switch (state) {
    case "active":
      return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
    case "waking":
      return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
    case "queued":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "waiting":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
  }
}

function WakeBadge({
  className,
  count,
  state,
}: {
  className?: string;
  count?: number;
  state: PreviewWakeState;
}) {
  return (
    <Badge className={cn(VX_SIDEBAR_STATUS_CHIP_CLASSNAME, wakeBadgeClasses(state), className)}>
      {count === undefined ? state : `${count} ${state}`}
    </Badge>
  );
}

function resolvePreviewWorkerThreadStatus(status: PreviewStatus): SidebarThreadStatus {
  switch (status) {
    case "working":
      return {
        colorClass: "text-sky-600 dark:text-sky-300/80",
        dotClass: "bg-sky-500 dark:bg-sky-300/80",
        label: "Working",
        pulse: true,
      };
    case "attention":
      return {
        colorClass: "text-amber-600 dark:text-amber-300/90",
        dotClass: "bg-amber-500 dark:bg-amber-300/90",
        label: "Pending Approval",
        pulse: false,
      };
    case "ready":
      return {
        colorClass: "text-emerald-600 dark:text-emerald-300/90",
        dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
        label: "Completed",
        pulse: false,
      };
  }
}

function workerIconClasses(status: PreviewStatus) {
  const resolved = resolvePreviewWorkerThreadStatus(status);
  return cn(
    "inline-flex size-4 shrink-0 items-center justify-center rounded-md",
    status === "working"
      ? "bg-sky-500/10 text-sky-600 dark:text-sky-300"
      : status === "attention"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    resolved.pulse ? "animate-pulse" : status === "attention" ? "animate-pulse" : "",
  );
}

function PreviewStatusTooltip({ icon, status }: { icon: ReactNode; status: PreviewStatus }) {
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

function ExecutiveNotificationsPopover({
  notifications,
}: {
  notifications: readonly PreviewExecutiveNotification[];
}) {
  const summary = useMemo(() => buildExecutiveNotificationSummary(notifications), [notifications]);
  const bellClasses = notificationBellClasses(summary);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <SidebarMenuAction
            type="button"
            aria-label={
              summary.totalCount > 0
                ? `Open executive notifications (${summary.totalCount})`
                : "Open executive notifications"
            }
            className={cn(
              "right-1 top-1 size-6 rounded-md",
              bellClasses.button,
              summary.totalCount > 0 ? bellClasses.ring : undefined,
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
          />
        }
      >
        <span className="relative inline-flex size-4 items-center justify-center">
          <BellIcon className="size-3.5" />
          {summary.totalCount > 0 ? (
            <span
              className={cn(
                "absolute left-full top-0 inline-flex h-3 min-w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-0.5 text-[7px] font-semibold leading-none shadow-sm",
                bellClasses.badge,
              )}
            >
              {summary.totalCount > 9 ? "9+" : summary.totalCount}
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" sideOffset={10} className="[--popup-width:22rem]">
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                summary.highestSeverity === "critical"
                  ? "bg-red-500/10 text-red-600 dark:text-red-300"
                  : summary.highestSeverity === "warning"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
                    : "bg-sky-500/10 text-sky-600 dark:text-sky-300",
              )}
            >
              {summary.highestSeverity === "critical" ? (
                <TriangleAlertIcon className="size-4" />
              ) : (
                <BellIcon className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <PopoverTitle className="text-sm font-medium">Executive notifications</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs leading-relaxed">
                Unified inbox for CTO attention and program updates without taking over the sidebar.
              </PopoverDescription>
            </div>
            <Badge className="h-5 shrink-0 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
              {summary.totalCount}
            </Badge>
          </div>

          {summary.totalCount > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {summary.criticalCount > 0 ? (
                  <Badge className="h-5 border-0 bg-red-500/12 px-1.5 text-[10px] font-medium leading-none text-red-600 dark:text-red-300">
                    {summary.criticalCount} critical
                  </Badge>
                ) : null}
                {summary.warningCount > 0 ? (
                  <Badge className="h-5 border-0 bg-amber-500/12 px-1.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-300">
                    {summary.warningCount} warning
                  </Badge>
                ) : null}
                {summary.infoCount > 0 ? (
                  <Badge className="h-5 border-0 bg-sky-500/12 px-1.5 text-[10px] font-medium leading-none text-sky-700 dark:text-sky-300">
                    {summary.infoCount} info
                  </Badge>
                ) : null}
              </div>

              <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {notifications.map((notification) => {
                  const severityClasses = notificationSeverityClasses(notification.severity);

                  return (
                    <div
                      key={notification.id}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 transition-colors hover:bg-accent/40",
                        severityClasses.surface,
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "mt-1 inline-flex size-2 shrink-0 rounded-full",
                            severityClasses.dot,
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-4 shrink-0 px-1 text-[9px] font-medium leading-none",
                                severityClasses.badge,
                              )}
                            >
                              {notification.severity}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="h-4 shrink-0 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                            >
                              {notification.kindLabel}
                            </Badge>
                            <Badge
                              variant="outline"
                              title={notification.programTitle}
                              className="h-4 min-w-0 max-w-40 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                            >
                              <span className="truncate">{notification.programTitle}</span>
                            </Badge>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                              {notification.relativeTime}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                            {notification.summary}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground/70">
                            {notification.sourceLabel}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground/85">No executive notifications</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                The CTO lane is clear. New executive attention items will appear here.
              </p>
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function WorkerRuntimePopover({
  runtime,
  workerLabel,
}: {
  runtime: PreviewWorkerRuntimeSnapshot | null;
  workerLabel: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Open runtime details for ${workerLabel}`}
          />
        }
      >
        <LightbulbIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" sideOffset={10} className="[--popup-width:22rem]">
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground/80">
              <HardHatIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <PopoverTitle className="text-sm font-medium">{workerLabel} runtime</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs leading-relaxed">
                Fixture-backed worker runtime contract summary for this mock sidebar.
              </PopoverDescription>
            </div>
            <Badge
              className={cn(
                VX_WORKER_RUNTIME_PANEL_CHIP_CLASSNAME,
                runtimeAuditBadgeClasses(runtime?.auditStatus ?? "missing"),
              )}
            >
              {runtime?.auditStatus ?? "missing"}
            </Badge>
          </div>

          {runtime ? (
            <>
              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Runtime Files
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    4 files
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.values(runtime.sourceFiles).map((sourceFile) => (
                    <Badge
                      key={sourceFile.fileName}
                      title={sourceFile.detail ?? sourceFile.fileName}
                      className={cn(
                        VX_WORKER_RUNTIME_PANEL_CHIP_CLASSNAME,
                        runtimeSourceFileBadgeClasses(sourceFile.status),
                      )}
                    >
                      {sourceFile.fileName.replace(".json", "")}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Repo
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">{runtime.repo}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Task Class
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">{runtime.taskClass}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Context
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtime.contextMode}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Closeout
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtime.closeoutAuthority}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Validation
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtime.validationProfile ?? "default"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Pack Audit
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge
                      className={cn(
                        VX_WORKER_RUNTIME_PANEL_CHIP_CLASSNAME,
                        runtimeAuditBadgeClasses(
                          runtime.packAuditIssueCount > 0 ? "warning" : "clean",
                        ),
                      )}
                    >
                      {runtime.packAuditStatus ?? "n/a"}
                    </Badge>
                    <span className="text-xs font-medium text-foreground/90">
                      {runtime.packAuditIssueCount} issue
                      {runtime.packAuditIssueCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>

              {runtime.warnings.length > 0 || runtime.conflicts.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-amber-700/75 dark:text-amber-300/80">
                        Warnings
                      </p>
                      <Badge className="h-5 border-0 bg-amber-500/12 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        {runtime.warnings.length}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {runtime.warnings.length > 0 ? (
                        runtime.warnings.map((warning) => (
                          <Badge
                            key={warning}
                            variant="outline"
                            className="h-5 border-amber-500/25 bg-transparent px-1.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-300"
                          >
                            {warning}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground/65">None</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-red-700/75 dark:text-red-300/80">
                        Conflicts
                      </p>
                      <Badge className="h-5 border-0 bg-red-500/12 px-1.5 text-[10px] font-medium text-red-700 dark:text-red-300">
                        {runtime.conflicts.length}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {runtime.conflicts.length > 0 ? (
                        runtime.conflicts.map((conflict) => (
                          <Badge
                            key={conflict}
                            variant="outline"
                            className="h-5 border-red-500/25 bg-transparent px-1.5 text-[10px] font-medium leading-none text-red-700 dark:text-red-300"
                          >
                            {conflict}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground/65">None</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Selected Packs
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    {runtime.packCount}
                  </Badge>
                </div>
                <div className="mt-2 flex gap-1 overflow-x-auto whitespace-nowrap pb-1">
                  {runtime.selectedPacks.slice(0, 4).map((pack) => (
                    <Badge
                      key={pack}
                      variant="outline"
                      title={pack}
                      className="h-5 shrink-0 px-1.5 text-[10px] font-medium leading-none text-muted-foreground/80 whitespace-nowrap"
                    >
                      <span>{formatRuntimeListLabel(pack)}</span>
                    </Badge>
                  ))}
                  {runtime.selectedPacks.length > 4 ? (
                    <Badge
                      variant="outline"
                      className="h-5 shrink-0 px-1.5 text-[10px] font-medium leading-none text-muted-foreground/70 whitespace-nowrap"
                    >
                      +{runtime.selectedPacks.length - 4} more
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Audit Findings
                  </p>
                  <Badge
                    className={cn(
                      VX_WORKER_RUNTIME_PANEL_CHIP_CLASSNAME,
                      runtimeAuditBadgeClasses(runtime.auditStatus),
                    )}
                  >
                    {runtime.auditFindings.length}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1">
                  {runtime.auditFindings.length > 0 ? (
                    runtime.auditFindings.slice(0, 3).map((finding) => (
                      <div
                        key={`${finding.code ?? "no-code"}:${finding.kind ?? "no-kind"}:${finding.detail ?? "no-detail"}`}
                        className={cn(
                          "rounded-md border px-2 py-1.5",
                          runtimeFindingSeverityClasses(finding.severity),
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] font-medium leading-none text-current"
                          >
                            {finding.severity ?? "info"}
                          </Badge>
                          <span className="truncate text-[11px] font-medium">
                            {finding.code ?? finding.kind ?? "runtime finding"}
                          </span>
                        </div>
                        {finding.detail ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-current/85">
                            {finding.detail}
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-muted-foreground/65">No audit findings.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-emerald-700/75 dark:text-emerald-300/80">
                      Allowed
                    </p>
                    <Badge className="h-5 border-0 bg-emerald-500/12 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      {runtime.allowedCapabilities.length}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {runtime.allowedCapabilities.map((capability) => (
                      <Badge
                        key={capability}
                        variant="outline"
                        className="h-5 border-emerald-500/25 bg-transparent px-1.5 text-[10px] font-medium leading-none text-emerald-700 dark:text-emerald-300"
                      >
                        {capability}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-red-700/75 dark:text-red-300/80">
                      Forbidden
                    </p>
                    <Badge className="h-5 border-0 bg-red-500/12 px-1.5 text-[10px] font-medium text-red-700 dark:text-red-300">
                      {runtime.forbiddenCapabilities.length}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {runtime.forbiddenCapabilities.map((capability) => (
                      <Badge
                        key={capability}
                        variant="outline"
                        className="h-5 border-red-500/25 bg-transparent px-1.5 text-[10px] font-medium leading-none text-red-700 dark:text-red-300"
                      >
                        {capability}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Installed Pack Profiles
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    {runtime.packs.length}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1">
                  {runtime.packs.slice(0, 3).map((pack) => (
                    <div
                      key={pack.id}
                      className="rounded-md border border-border/70 bg-background/40 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-foreground/90">
                          {pack.name ?? formatRuntimeListLabel(pack.slug)}
                        </span>
                        {pack.scope ? (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                          >
                            {pack.scope}
                          </Badge>
                        ) : null}
                        {pack.type ? (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] font-medium leading-none text-muted-foreground/80"
                          >
                            {pack.type}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                        {pack.version ? <span>v{pack.version}</span> : null}
                        {pack.mountMode ? <span>{pack.mountMode}</span> : null}
                        <span>{pack.grants.length} grants</span>
                        <span>{pack.forbids.length} forbids</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground/60">
                Source fixture: <span className="text-foreground/75">{runtime.sourceWorktree}</span>
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground/85">Runtime unavailable</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                No worker runtime fixture is mapped for this mock worker yet.
              </p>
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
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

export default function VxOrchestrationSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const appsQuery = useQuery(vortexAppsListQueryOptions());
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
  const appDisplayNameByTargetId = useMemo(
    () =>
      new Map(
        (appsQuery.data?.catalog.projects ?? []).map((project) => [
          project.target_id,
          project.display_name,
        ]),
      ),
    [appsQuery.data?.catalog.projects],
  );
  const isStandaloneWindow = mode === "standalone";

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={isStandaloneWindow} />
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2" data-testid="vx-orchestration-sidebar">
          <div>
            <SidebarMenu>
              <SidebarMenuItem className="rounded-md">
                <SidebarMenuButton
                  size="sm"
                  className="h-auto min-h-7 gap-2 px-2 py-1.5 pr-9"
                  render={<div />}
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-500 dark:text-fuchsia-300">
                    <BotIcon className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground/90">
                        {PREVIEW_EXECUTIVE.name}
                      </span>
                      <Badge variant="outline" className={VX_SIDEBAR_CHIP_CLASSNAME}>
                        {PREVIEW_EXECUTIVE.role}
                      </Badge>
                    </div>
                  </div>
                </SidebarMenuButton>
                <ExecutiveNotificationsPopover notifications={PREVIEW_EXECUTIVE.notifications} />
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
                      <div className="min-w-0 flex-1 text-left">
                        <span className="truncate text-[11px] font-medium text-foreground/90">
                          {program.title}
                        </span>
                      </div>
                    </SidebarMenuSubButton>

                    {programOpen ? (
                      <div
                        ref={attachAnimatedListRef}
                        className="ml-3 border-l border-border/50 pl-2"
                      >
                        <div className="relative">
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                          />
                          <button
                            type="button"
                            className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent/40"
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
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate text-[11px] font-medium text-foreground/90">
                                  {program.orchestrator.projectName}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(VX_SIDEBAR_ORCHESTRATOR_CHIP_CLASSNAME, "max-w-16")}
                                >
                                  <span className="truncate">{program.orchestrator.label}</span>
                                </Badge>
                              </div>
                            </div>
                          </button>

                          {orchestratorOpen ? (
                            <div
                              ref={attachAnimatedListRef}
                              className="ml-3 border-l border-border/50 pl-2"
                            >
                              {program.orchestrator.workers.length > 0 ? (
                                <div
                                  ref={attachAnimatedListRef}
                                  className={VX_SIDEBAR_WORKER_LIST_CLASSNAME}
                                >
                                  {program.orchestrator.workers.map((worker) => {
                                    const workerLabel =
                                      appDisplayNameByTargetId.get(worker.appTargetId) ??
                                      worker.fallbackAppLabel;
                                    const runtimeSnapshot = resolvePreviewWorkerRuntimeSnapshot(
                                      worker.runtimeFixtureId,
                                    );

                                    return (
                                      <div
                                        key={worker.id}
                                        className={VX_SIDEBAR_WORKER_ROW_CLASSNAME}
                                      >
                                        <span
                                          aria-hidden="true"
                                          className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                        />
                                        <PreviewStatusTooltip
                                          status={worker.status}
                                          icon={
                                            <span className={workerIconClasses(worker.status)}>
                                              <HardHatIcon className="size-3" />
                                            </span>
                                          }
                                        />
                                        <Badge
                                          variant="outline"
                                          title={workerLabel}
                                          className={cn(
                                            VX_SIDEBAR_WORKER_REPO_CHIP_CLASSNAME,
                                            "max-w-16",
                                          )}
                                        >
                                          <span className="truncate">
                                            {workerLabel.toLowerCase()}
                                          </span>
                                        </Badge>
                                        {worker.wakeState ? (
                                          <WakeBadge
                                            state={worker.wakeState}
                                            className={VX_SIDEBAR_WORKER_STATE_CHIP_CLASSNAME}
                                          />
                                        ) : null}
                                        <WorkerRuntimePopover
                                          workerLabel={workerLabel}
                                          runtime={runtimeSnapshot}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="relative px-2 py-1.5 text-[10px] text-muted-foreground/70">
                                  <span
                                    aria-hidden="true"
                                    className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
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
      </SidebarContent>
    </>
  );
}
