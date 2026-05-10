import { autoAnimate } from "@formkit/auto-animate";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { type OrchestrationThreadSummary, type ThreadId } from "@t3tools/contracts";
import {
  BellIcon,
  BotIcon,
  ChevronRightIcon,
  HardHatIcon,
  InfoIcon,
  LightbulbIcon,
  ListTodoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { useThreadActions } from "~/hooks/useThreadActions";
import { agentsVxappSidebarGraphQueryOptions } from "~/lib/agentsVxappSidebarReactQuery";
import { orchestrationSessionThreadsQueryOptions } from "~/lib/orchestrationReactQuery";
import { resolveNoThreadRouteTarget, resolveThreadRouteTarget } from "~/lib/sidebarWindow";
import { cn, newCommandId } from "~/lib/utils";
import {
  workerRuntimeRepoQueryOptions,
  workerRuntimeSnapshotQueryOptions,
} from "~/lib/workerRuntimeReactQuery";
import { readNativeApi } from "~/nativeApi";
import { derivePendingApprovals, derivePendingUserInputs } from "~/session-logic";
import { useStore } from "~/store";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { useUiStateStore } from "~/uiStateStore";
import {
  buildCopyThreadIdErrorDescription,
  getSidebarCtoAttentionKindLabel,
  getSidebarProgramNotificationKindLabel,
  resolveThreadStatusPill,
} from "../Sidebar.logic";
import { SidebarBrandHeader } from "../sidebar/SidebarBrandHeader";
import { ThreadStatusLabel } from "../sidebar/SidebarThreadRow";
import { Badge } from "../ui/badge";
import { DialogCloseButton } from "../ui/dialog-close-button";
import {
  Popover,
  PopoverClose,
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
import { toastManager } from "../ui/toast";
import {
  buildOrchestrationSidebarModel,
  resolveSidebarRootThreadIds,
  type SidebarNotificationItem,
  type SidebarWorkerRuntimeState,
} from "./orchestrationSidebarModel";
import { ProgramInfoDialog } from "./ProgramInfoDialog";
import { ProgramTodosDialog } from "./ProgramTodosDialog";
import { deriveWorkerRuntimeDialogState } from "./workerRuntimeDialogState";

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

const CHIP_CLASSNAME =
  "h-4 shrink-0 px-1 text-[8px] font-medium leading-none text-muted-foreground/80";

function severityOrder(severity: SidebarNotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
  }
}

function notificationSeverityClasses(severity: SidebarNotificationItem["severity"]) {
  switch (severity) {
    case "critical":
      return {
        badge: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
        icon: "text-red-600 dark:text-red-300",
        surface: "border-red-500/20 bg-red-500/5",
      };
    case "warning":
      return {
        badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        icon: "text-amber-600 dark:text-amber-300",
        surface: "border-amber-500/20 bg-amber-500/5",
      };
    case "info":
      return {
        badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        icon: "text-sky-600 dark:text-sky-300",
        surface: "border-sky-500/20 bg-sky-500/5",
      };
  }
}

function notificationBellClasses(notifications: readonly SidebarNotificationItem[]) {
  const highestSeverity = notifications
    .map((notification) => notification.severity)
    .toSorted((left, right) => severityOrder(left) - severityOrder(right))[0];
  if (highestSeverity === "critical") {
    return {
      badge: "bg-red-500 text-white dark:bg-red-400 dark:text-red-950",
      button:
        "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-400/10 dark:hover:text-red-200",
    };
  }
  if (highestSeverity === "warning") {
    return {
      badge: "bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
      button:
        "text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-400/10 dark:hover:text-amber-200",
    };
  }
  if (highestSeverity === "info") {
    return {
      badge: "bg-sky-500 text-white dark:bg-sky-400 dark:text-sky-950",
      button:
        "text-sky-600 hover:bg-sky-500/10 hover:text-sky-700 dark:text-sky-300 dark:hover:bg-sky-400/10 dark:hover:text-sky-200",
    };
  }
  return {
    badge: "bg-muted text-muted-foreground",
    button: "text-muted-foreground hover:bg-accent hover:text-foreground",
  };
}

function formatProgramStatus(status: string) {
  switch (status) {
    case "active":
      return { label: "Active", tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" };
    case "founder_review_ready":
      return { label: "Review", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" };
    case "closeout_in_progress":
      return { label: "Closeout", tone: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" };
    case "completed":
      return { label: "Done", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" };
    default:
      return {
        label: status.replaceAll("_", " "),
        tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
      };
  }
}

function WakeBadge({ state }: { state: "pending" | "delivering" | null }) {
  if (state === null) {
    return null;
  }
  const className =
    state === "delivering"
      ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
      : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
  return <Badge className={cn(CHIP_CLASSNAME, "border-0", className)}>{state}</Badge>;
}

function RuntimeSourceBadge({
  label,
  status,
}: {
  label: string;
  status: "loaded" | "missing" | "invalid-json" | "schema-error";
}) {
  const className =
    status === "loaded"
      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
      : status === "missing"
        ? "bg-muted text-muted-foreground"
        : status === "invalid-json"
          ? "bg-red-500/12 text-red-700 dark:text-red-300"
          : "bg-amber-500/12 text-amber-700 dark:text-amber-300";
  return (
    <Badge className={cn("h-5 border-0 px-1.5 text-[10px] font-medium", className)}>{label}</Badge>
  );
}

function workerRuntimeStateBadgeClasses(state: SidebarWorkerRuntimeState) {
  switch (state) {
    case "inspectable":
      return {
        badge: "text-muted-foreground/80",
        label: "runtime",
        title: "Worker runtime can be inspected.",
      };
    case "pending-worktree":
      return {
        badge: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        label: "pending",
        title: "Worker runtime is pending worktree creation.",
      };
    case "transient":
      return {
        badge: "border-muted bg-muted text-muted-foreground",
        label: "transient",
        title: "Transient worker row without a prepared runtime bundle.",
      };
    case "stale-lineage":
      return {
        badge: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        label: "stale",
        title: "Fallback lineage row is unavailable in the current T3 projection.",
      };
  }
}

function WorkerRuntimePopover({
  runtimeState,
  runtimeStateMessage,
  threadId,
  worktreePath,
  workerLabel,
}: {
  runtimeState: SidebarWorkerRuntimeState;
  runtimeStateMessage: string | null;
  threadId: ThreadId | null;
  worktreePath: string | null;
  workerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const runtimeLookupEnabled = open && runtimeState === "inspectable";
  const runtimeQuery = useQuery(
    workerRuntimeSnapshotQueryOptions({
      threadId: runtimeLookupEnabled ? threadId : null,
      worktreePath: runtimeLookupEnabled ? worktreePath : null,
    }),
  );

  const content = useMemo(() => {
    return deriveWorkerRuntimeDialogState({
      data: runtimeQuery.data,
      error: runtimeQuery.error instanceof Error ? runtimeQuery.error : null,
      isError: runtimeQuery.isError,
      isLoading: runtimeQuery.isLoading,
      unavailableHint:
        runtimeState === "inspectable"
          ? null
          : {
              kind: runtimeState,
              message: runtimeStateMessage,
            },
      threadId,
    });
  }, [
    runtimeQuery.data,
    runtimeQuery.error,
    runtimeQuery.isError,
    runtimeQuery.isLoading,
    runtimeState,
    runtimeStateMessage,
    threadId,
  ]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Open runtime details for ${workerLabel}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
          />
        }
      >
        <LightbulbIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" sideOffset={10} className="[--popup-width:22rem]">
        <div className="space-y-3">
          <PopoverHeaderWithClose
            badge={
              <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                {content.mode}
              </Badge>
            }
            description="Live worker runtime contract details loaded on demand."
            icon={<HardHatIcon className="size-4" />}
            title={`${workerLabel} runtime`}
          />

          {content.mode !== "ready" || !runtimeQuery.data ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 px-3 py-4">
              <p className="text-xs font-medium text-foreground/90">{content.mode}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                {content.message}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                <RuntimeSourceBadge
                  label="context-plan"
                  status={runtimeQuery.data.sourceFiles.contextPlan.status}
                />
                <RuntimeSourceBadge
                  label="dispatch"
                  status={runtimeQuery.data.sourceFiles.dispatchContract.status}
                />
                <RuntimeSourceBadge
                  label="packs"
                  status={runtimeQuery.data.sourceFiles.installedPacks.status}
                />
                <RuntimeSourceBadge
                  label="audit"
                  status={runtimeQuery.data.sourceFiles.instructionStackAudit.status}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Repo
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtimeQuery.data.summary.repo ?? "unknown"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Task
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtimeQuery.data.summary.taskClass ?? "unknown"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Context
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtimeQuery.data.summary.contextMode ?? "unknown"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Closeout
                  </p>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {runtimeQuery.data.summary.closeoutAuthority ?? "unknown"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Selected Packs
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    {runtimeQuery.data.summary.selectedPacks.length}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {runtimeQuery.data.summary.selectedPacks.length > 0 ? (
                    runtimeQuery.data.summary.selectedPacks.slice(0, 6).map((pack) => (
                      <Badge
                        key={pack}
                        variant="outline"
                        className="h-5 px-1.5 text-[10px] font-medium leading-none text-muted-foreground/80"
                      >
                        {pack}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground/70">No packs selected.</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function WorkerRepoBadge({
  runtimeState,
  runtimeStateMessage,
  threadId,
  worktreePath,
}: {
  runtimeState: SidebarWorkerRuntimeState;
  runtimeStateMessage: string | null;
  threadId: ThreadId;
  worktreePath: string | null;
}) {
  const runtimeStateBadge = workerRuntimeStateBadgeClasses(runtimeState);
  const repoQuery = useQuery(
    workerRuntimeRepoQueryOptions({
      threadId: runtimeState === "inspectable" ? threadId : null,
      worktreePath: runtimeState === "inspectable" ? worktreePath : null,
    }),
  );
  const label =
    runtimeState === "inspectable"
      ? (repoQuery.data ??
        (repoQuery.isLoading ? "loading" : repoQuery.isError ? "error" : "unknown"))
      : runtimeStateBadge.label;
  const title =
    runtimeState === "inspectable"
      ? (repoQuery.data ??
        (repoQuery.isLoading
          ? "Loading worker runtime repo."
          : repoQuery.isError
            ? repoQuery.error instanceof Error
              ? repoQuery.error.message
              : "Worker runtime repo could not be loaded."
            : "Worker runtime loaded, but no authoritative repo was declared."))
      : (runtimeStateMessage ?? runtimeStateBadge.title);

  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        "h-4 max-w-24 shrink-0 px-1 text-[8px]",
        runtimeState === "inspectable" ? "text-muted-foreground/80" : runtimeStateBadge.badge,
      )}
    >
      <span className="truncate">{label}</span>
    </Badge>
  );
}

function PopoverHeaderWithClose(props: {
  badge?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground/80">
        {props.icon}
      </span>
      <div className="min-w-0 flex-1">
        <PopoverTitle className="text-sm font-medium">{props.title}</PopoverTitle>
        <PopoverDescription className="mt-0.5 text-xs leading-relaxed">
          {props.description}
        </PopoverDescription>
      </div>
      {props.badge ? <div className="shrink-0">{props.badge}</div> : null}
      <PopoverClose
        render={<DialogCloseButton className="size-6 shrink-0 text-muted-foreground/70" />}
      />
    </div>
  );
}

function ExecutiveNotificationsPopover({
  notifications,
}: {
  notifications: readonly SidebarNotificationItem[];
}) {
  const bellClasses = notificationBellClasses(notifications);
  const attention = notifications.filter((notification) => notification.section === "attention");
  const updates = notifications.filter((notification) => notification.section === "program-update");

  return (
    <Popover>
      <PopoverTrigger
        render={
          <SidebarMenuAction
            type="button"
            aria-label="Open executive notifications"
            className={cn("right-1 top-1 size-6 cursor-pointer rounded-md", bellClasses.button)}
            onClick={(event) => {
              event.stopPropagation();
            }}
          />
        }
      >
        <span className="relative inline-flex size-4 items-center justify-center">
          <BellIcon className="size-3.5" />
          {notifications.length > 0 ? (
            <span
              className={cn(
                "absolute left-full top-0 inline-flex h-3 min-w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-0.5 text-[7px] font-semibold leading-none shadow-sm",
                bellClasses.badge,
              )}
            >
              {notifications.length > 9 ? "9+" : notifications.length}
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="right" align="start" sideOffset={10} className="[--popup-width:22rem]">
        <div className="space-y-3">
          <PopoverHeaderWithClose
            description="CTO attention first, then program updates for this executive."
            icon={
              attention.length > 0 ? (
                <TriangleAlertIcon className="size-4" />
              ) : (
                <BellIcon className="size-4" />
              )
            }
            title="Executive notifications"
          />

          {[
            { items: attention, label: "CTO Attention" },
            { items: updates, label: "Program Updates" },
          ].map(({ items, label }) => (
            <div key={label} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  {label}
                </p>
                <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                  {items.length}
                </Badge>
              </div>
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 px-3 py-3 text-[11px] text-muted-foreground/70">
                  No items.
                </div>
              ) : (
                <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                  {items.map((notification) => {
                    const classes = notificationSeverityClasses(notification.severity);
                    const kindLabel =
                      notification.section === "attention"
                        ? getSidebarCtoAttentionKindLabel(notification.kind as never)
                        : getSidebarProgramNotificationKindLabel(notification.kind as never);

                    return (
                      <div
                        key={notification.id}
                        className={cn("rounded-lg border px-2.5 py-2", classes.surface)}
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn("h-4 px-1 text-[9px]", classes.badge)}
                          >
                            {notification.severity}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] text-muted-foreground/80"
                          >
                            {kindLabel}
                          </Badge>
                          <span className="ml-auto text-[10px] text-muted-foreground/60">
                            {notification.queuedAt
                              ? formatRelativeTimeLabel(notification.queuedAt)
                              : "now"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                          {notification.summary}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
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

function mergeItems(current: ReadonlySet<string>, itemIds: Iterable<string>) {
  let next: Set<string> | null = null;
  for (const itemId of itemIds) {
    if (current.has(itemId) || next?.has(itemId)) {
      continue;
    }
    if (next === null) {
      next = new Set(current);
    }
    next.add(itemId);
  }
  return next ?? current;
}

function resolveAutoExpandedSidebarItems(input: {
  executives: ReturnType<typeof buildOrchestrationSidebarModel>["executives"];
  routeThreadId: ThreadId | null;
}) {
  const openProgramIds = new Set<string>();
  const openOrchestratorIds = new Set<string>();
  if (!input.routeThreadId) {
    return { openOrchestratorIds, openProgramIds };
  }

  for (const executive of input.executives) {
    for (const program of executive.programs) {
      const workerRouteActive =
        program.orchestrator?.workers.some((worker) => worker.id === input.routeThreadId) ?? false;
      if (
        input.routeThreadId === program.executiveThreadId ||
        input.routeThreadId === program.orchestrator?.id ||
        workerRouteActive
      ) {
        openProgramIds.add(program.id);
      }
      if (workerRouteActive && program.orchestrator?.id) {
        openOrchestratorIds.add(program.orchestrator.id);
      }
    }
  }

  return { openOrchestratorIds, openProgramIds };
}

export default function VxOrchestrationSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? (params.threadId as ThreadId) : null),
  });
  const sqliteGraphQuery = useQuery(agentsVxappSidebarGraphQueryOptions());
  const projects = useStore((store) => store.projects);
  const programs = useStore((store) => store.programs ?? []);
  const threads = useStore((store) => store.threads);
  const programNotifications = useStore((store) => store.programNotifications ?? []);
  const ctoAttentionItems = useStore((store) => store.ctoAttentionItems ?? []);
  const wakeItems = useStore((store) => store.orchestratorWakeItems);
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const selectedThreadIds = useThreadSelectionStore((store) => store.selectedThreadIds);
  const toggleThread = useThreadSelectionStore((store) => store.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((store) => store.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((store) => store.clearSelection);
  const setAnchor = useThreadSelectionStore((store) => store.setAnchor);
  const { archiveThread, deleteThread } = useThreadActions();
  const [openProgramIds, setOpenProgramIds] = useState<ReadonlySet<string>>(new Set());
  const [openOrchestratorIds, setOpenOrchestratorIds] = useState<ReadonlySet<string>>(new Set());
  const [programTodosDialog, setProgramTodosDialog] = useState<{
    programId: string;
    programTitle: string;
  } | null>(null);
  const [programInfoDialogProgramId, setProgramInfoDialogProgramId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const animatedListsRef = useRef(new WeakSet<HTMLElement>());
  const attachAnimatedListRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedListsRef.current.add(node);
  }, []);

  const rootThreadIds = useMemo(
    () =>
      resolveSidebarRootThreadIds({
        programs,
        sqliteGraph: sqliteGraphQuery.data ?? null,
      }),
    [programs, sqliteGraphQuery.data],
  );
  const sessionQueries = useQueries({
    queries: rootThreadIds.map((rootThreadId) =>
      orchestrationSessionThreadsQueryOptions({
        includeArchived: true,
        rootThreadId,
      }),
    ),
  });
  const sessionWorkerThreadsByRootId = useMemo(() => {
    const next = new Map<string, readonly OrchestrationThreadSummary[]>();
    rootThreadIds.forEach((rootThreadId, index) => {
      const query = sessionQueries[index];
      next.set(
        rootThreadId,
        (query?.data ?? []).filter(
          (thread: OrchestrationThreadSummary) => thread.id !== rootThreadId,
        ),
      );
    });
    return next;
  }, [rootThreadIds, sessionQueries]);

  const model = useMemo(
    () =>
      buildOrchestrationSidebarModel({
        ctoAttentionItems,
        programNotifications,
        programs,
        projects,
        sessionWorkerThreadsByRootId,
        sqliteGraph: sqliteGraphQuery.data ?? null,
        threads,
        wakeItems,
      }),
    [
      ctoAttentionItems,
      programNotifications,
      programs,
      projects,
      sessionWorkerThreadsByRootId,
      sqliteGraphQuery.data,
      threads,
      wakeItems,
    ],
  );

  const orderedWorkerThreadIds = useMemo(
    () =>
      model.executives.flatMap((executive) =>
        executive.programs.flatMap(
          (program) => program.orchestrator?.workers.map((worker) => worker.id) ?? [],
        ),
      ),
    [model.executives],
  );
  const staleMirrorDescription = useMemo(() => {
    if (!model.diagnostics.staleMirror) {
      return null;
    }
    const parts: string[] = [];
    if (model.diagnostics.divergentProgramIds.length > 0) {
      parts.push(`${model.diagnostics.divergentProgramIds.length} divergent programs`);
    }
    if (model.diagnostics.missingProjectIds.length > 0) {
      parts.push(`${model.diagnostics.missingProjectIds.length} projects`);
    }
    if (model.diagnostics.missingProgramIds.length > 0) {
      parts.push(`${model.diagnostics.missingProgramIds.length} programs`);
    }
    if (model.diagnostics.missingThreadIds.length > 0) {
      parts.push(`${model.diagnostics.missingThreadIds.length} threads`);
    }
    const suffix = parts.length > 0 ? parts.join(", ") : "referenced rows";
    return `Dev DB mirror is stale: ${suffix} from agents-vxapp SQLite disagree with local T3 state. Rerun python3 scripts/seed-dev-db.py.`;
  }, [model.diagnostics]);

  useEffect(() => {
    const nextAutoOpenState = resolveAutoExpandedSidebarItems({
      executives: model.executives,
      routeThreadId,
    });
    if (nextAutoOpenState.openProgramIds.size > 0) {
      setOpenProgramIds((current) => mergeItems(current, nextAutoOpenState.openProgramIds));
    }
    if (nextAutoOpenState.openOrchestratorIds.size > 0) {
      setOpenOrchestratorIds((current) =>
        mergeItems(current, nextAutoOpenState.openOrchestratorIds),
      );
    }
  }, [model.executives, routeThreadId]);

  useEffect(() => {
    if (renamingThreadId && renamingInputRef.current) {
      renamingInputRef.current.focus();
      renamingInputRef.current.select();
    }
  }, [renamingThreadId]);

  const navigateToThread = useCallback(
    async (threadId: ThreadId) => {
      await navigate(resolveThreadRouteTarget(location.pathname, threadId));
    },
    [location.pathname, navigate],
  );
  const navigateToNoThread = useCallback(async () => {
    await navigate(resolveNoThreadRouteTarget(location.pathname));
  }, [location.pathname, navigate]);

  const handleProgramToggle = useCallback(
    async (program: (typeof model.executives)[number]["programs"][number]) => {
      const isOpen = openProgramIds.has(program.id);
      if (
        isOpen &&
        routeThreadId &&
        (routeThreadId === program.executiveThreadId ||
          routeThreadId === program.orchestrator?.id ||
          program.orchestrator?.workers.some((worker) => worker.id === routeThreadId))
      ) {
        await navigateToNoThread();
      }
      setOpenProgramIds((current) => toggleItem(current, program.id));
    },
    [navigateToNoThread, openProgramIds, routeThreadId],
  );

  const handleOrchestratorToggle = useCallback(
    async (program: (typeof model.executives)[number]["programs"][number]) => {
      if (!program.orchestrator?.id) {
        return;
      }
      const orchestratorId = program.orchestrator.id;
      const isOpen = openOrchestratorIds.has(orchestratorId);
      if (
        isOpen &&
        routeThreadId &&
        (routeThreadId === orchestratorId ||
          program.orchestrator.workers.some((worker) => worker.id === routeThreadId))
      ) {
        await navigateToNoThread();
      }
      setOpenOrchestratorIds((current) => toggleItem(current, orchestratorId));
    },
    [navigateToNoThread, openOrchestratorIds, routeThreadId],
  );

  const handleOrchestratorNavigate = useCallback(
    async (program: (typeof model.executives)[number]["programs"][number]) => {
      if (!program.orchestrator?.id) {
        return;
      }
      await navigateToThread(program.orchestrator.id as ThreadId);
    },
    [navigateToThread],
  );

  const commitRename = useCallback(async () => {
    if (!renamingThreadId) {
      return;
    }
    const trimmed = renamingTitle.trim();
    const original = threads.find((thread) => thread.id === renamingThreadId)?.title ?? "";
    if (!trimmed || trimmed === original) {
      setRenamingThreadId(null);
      return;
    }
    const api = readNativeApi();
    if (!api) {
      setRenamingThreadId(null);
      return;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: renamingThreadId,
        title: trimmed,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to rename thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
    setRenamingThreadId(null);
  }, [renamingThreadId, renamingTitle, threads]);

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: (ctx) => {
      toastManager.add({ type: "success", title: "Thread ID copied", description: ctx.threadId });
    },
    onError: (error, ctx) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: buildCopyThreadIdErrorDescription({
          threadId: ctx.threadId,
          errorMessage: error instanceof Error ? error.message : "An error occurred.",
        }),
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path?: string }>({
    onCopy: (ctx) => {
      toastManager.add({ type: "success", title: "Path copied", description: ctx.path });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const handleWorkerContextMenu = useCallback(
    async (threadId: ThreadId) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) {
        return;
      }
      const clicked = await api.contextMenu.show([
        { id: "rename", label: "Rename thread" },
        { id: "archive", label: "Archive thread" },
        { id: "mark-unread", label: "Mark unread" },
        { id: "copy-path", label: "Copy Path" },
        { id: "copy-thread-id", label: "Copy Thread ID" },
        { id: "delete", label: "Delete", destructive: true },
      ]);

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        return;
      }
      if (clicked === "archive") {
        if (settings.confirmThreadArchive) {
          const confirmed = await api.dialogs.confirm(`Archive thread "${thread.title}"?`);
          if (!confirmed) {
            return;
          }
        }
        await archiveThread(threadId);
        return;
      }
      if (clicked === "mark-unread") {
        markThreadUnread(threadId, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
        if (!thread.worktreePath) {
          toastManager.add({
            type: "warning",
            title: "Path unavailable",
            description: "This worker does not have a worktree path to copy.",
          });
          return;
        }
        copyPathToClipboard(thread.worktreePath, { path: thread.worktreePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(threadId, { threadId });
        return;
      }
      if (clicked === "delete") {
        await deleteThread(threadId);
      }
    },
    [
      archiveThread,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      settings.confirmThreadArchive,
      threads,
    ],
  );

  const isStandaloneWindow = mode === "standalone";

  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={isStandaloneWindow} />
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2" data-testid="vx-orchestration-sidebar">
          {staleMirrorDescription ? (
            <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                <div>
                  <p className="font-medium">Stale dev mirror</p>
                  <p className="mt-0.5 text-amber-700/90 dark:text-amber-200/80">
                    {staleMirrorDescription}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <SidebarMenu>
            {model.executives.map((executive) => (
              <SidebarMenuItem key={executive.id} className="rounded-md">
                <SidebarMenuButton
                  size="sm"
                  className={cn(
                    "h-auto min-h-7 gap-2 px-2 py-1.5 pr-9",
                    executive.threadId ? "cursor-pointer" : "",
                  )}
                  render={executive.threadId ? <button type="button" /> : <div />}
                  isActive={routeThreadId === executive.threadId}
                  onClick={
                    executive.threadId
                      ? () => {
                          void navigateToThread(executive.threadId as ThreadId);
                        }
                      : undefined
                  }
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-500 dark:text-fuchsia-300">
                    <BotIcon className="size-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground/90">
                        {executive.label}
                      </span>
                      <Badge variant="outline" className={CHIP_CLASSNAME}>
                        Executive
                      </Badge>
                    </div>
                  </div>
                </SidebarMenuButton>
                <ExecutiveNotificationsPopover notifications={executive.notifications} />

                <SidebarMenuSub ref={attachAnimatedListRef} className="mx-1 mt-1 gap-1 px-1.5">
                  {executive.programs.map((program) => {
                    const programOpen = openProgramIds.has(program.id);
                    const orchestratorOpen = program.orchestrator?.id
                      ? openOrchestratorIds.has(program.orchestrator.id)
                      : false;
                    const status = formatProgramStatus(program.status);

                    return (
                      <SidebarMenuSubItem key={program.id} className="w-full">
                        <div className="flex items-start gap-1 rounded-lg">
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            size="sm"
                            className="h-auto min-h-7 flex-1 cursor-pointer items-start px-2 py-1.5"
                            onClick={() => {
                              void handleProgramToggle(program);
                            }}
                          >
                            <ChevronRightIcon
                              className={cn(
                                "mt-0.5 size-3 shrink-0 text-muted-foreground/70 transition-transform",
                                programOpen ? "rotate-90" : "",
                              )}
                            />
                            <div className="min-w-0 flex-1 text-left">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-[11px] font-medium text-foreground/90">
                                  {program.title}
                                </span>
                                <Badge className={cn(CHIP_CLASSNAME, "border-0", status.tone)}>
                                  {status.label}
                                </Badge>
                                {program.attentionCount > 0 ? (
                                  <Badge className="h-4 border-0 bg-red-500/12 px-1 text-[8px] text-red-700 dark:text-red-300">
                                    {program.attentionCount} attention
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </SidebarMenuSubButton>
                          <button
                            type="button"
                            aria-label={`Open Program info for ${program.title}`}
                            className="mr-1 mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              setProgramInfoDialogProgramId(program.id);
                            }}
                          >
                            <InfoIcon className="size-3.5" />
                          </button>
                        </div>

                        {programOpen ? (
                          <div
                            ref={attachAnimatedListRef}
                            className="ml-3 border-l border-border/50 pl-2"
                          >
                            {program.orchestrator ? (
                              <div className="relative">
                                <span
                                  aria-hidden="true"
                                  className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                />
                                <div
                                  className={cn(
                                    "flex items-start gap-1 rounded-lg hover:bg-accent/40",
                                    routeThreadId === program.orchestrator.id ? "bg-accent/60" : "",
                                  )}
                                >
                                  <button
                                    type="button"
                                    aria-label={
                                      orchestratorOpen
                                        ? `Collapse workers for ${program.orchestrator.title}`
                                        : `Expand workers for ${program.orchestrator.title}`
                                    }
                                    className="ml-1 mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                                    onClick={() => {
                                      void handleOrchestratorToggle(program);
                                    }}
                                  >
                                    <ChevronRightIcon
                                      className={cn(
                                        "size-3 shrink-0 transition-transform",
                                        orchestratorOpen ? "rotate-90" : "",
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg py-1.5 pr-2 text-left"
                                    onClick={() => {
                                      void handleOrchestratorNavigate(program);
                                    }}
                                  >
                                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
                                      <BotIcon className="size-3" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate text-[11px] font-medium text-foreground/90">
                                          {program.orchestrator.title}
                                        </span>
                                        <Badge variant="outline" className={CHIP_CLASSNAME}>
                                          {program.orchestrator.workerCount} workers
                                        </Badge>
                                      </div>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Open TODOs for ${program.title}`}
                                    className="mr-1 mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setProgramTodosDialog({
                                        programId: program.id,
                                        programTitle: program.title,
                                      });
                                    }}
                                  >
                                    <ListTodoIcon className="size-3.5" />
                                  </button>
                                </div>

                                {orchestratorOpen ? (
                                  <div
                                    ref={attachAnimatedListRef}
                                    className="ml-3 border-l border-border/50 pl-2"
                                  >
                                    {program.orchestrator.workers.length > 0 ? (
                                      <div ref={attachAnimatedListRef} className="space-y-0.5">
                                        {program.orchestrator.workers.map((worker) => {
                                          const thread = worker.thread;
                                          const isActive = routeThreadId === worker.id;
                                          const isSelected = selectedThreadIds.has(
                                            worker.id as ThreadId,
                                          );
                                          const lastVisitedAt =
                                            threadLastVisitedAtById[worker.id] ?? undefined;
                                          const threadStatus =
                                            thread === null
                                              ? null
                                              : resolveThreadStatusPill({
                                                  thread: {
                                                    ...thread,
                                                    lastVisitedAt,
                                                  },
                                                  hasPendingApprovals:
                                                    derivePendingApprovals(thread.activities)
                                                      .length > 0,
                                                  hasPendingUserInput:
                                                    derivePendingUserInputs(thread.activities)
                                                      .length > 0,
                                                });

                                          return (
                                            <div
                                              key={worker.id}
                                              className={cn(
                                                "relative flex items-center gap-1 rounded-md px-1.5 py-1 text-left",
                                                isActive || isSelected
                                                  ? "bg-accent/60"
                                                  : "hover:bg-accent/40",
                                              )}
                                              onContextMenu={(event) => {
                                                event.preventDefault();
                                                if (thread) {
                                                  void handleWorkerContextMenu(thread.id);
                                                }
                                              }}
                                            >
                                              <span
                                                aria-hidden="true"
                                                className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                              />
                                              <button
                                                type="button"
                                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                                                onClick={(event) => {
                                                  if (!thread) {
                                                    return;
                                                  }
                                                  if (event.shiftKey) {
                                                    rangeSelectTo(
                                                      thread.id,
                                                      orderedWorkerThreadIds as ThreadId[],
                                                    );
                                                    return;
                                                  }
                                                  if (event.metaKey || event.ctrlKey) {
                                                    toggleThread(thread.id);
                                                    return;
                                                  }
                                                  clearSelection();
                                                  setAnchor(thread.id);
                                                  void navigateToThread(thread.id);
                                                }}
                                              >
                                                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-amber-500/12 text-amber-600 dark:text-amber-300">
                                                  <HardHatIcon className="size-3" />
                                                </span>
                                                {threadStatus ? (
                                                  <ThreadStatusLabel
                                                    status={threadStatus}
                                                    compact
                                                  />
                                                ) : null}
                                                <WorkerRepoBadge
                                                  runtimeState={worker.runtimeState}
                                                  runtimeStateMessage={worker.runtimeStateMessage}
                                                  threadId={worker.id as ThreadId}
                                                  worktreePath={worker.worktreePathHint}
                                                />
                                                <WakeBadge state={worker.wakeState} />
                                                {renamingThreadId === worker.id && thread ? (
                                                  <input
                                                    ref={renamingInputRef}
                                                    value={renamingTitle}
                                                    onChange={(event) => {
                                                      setRenamingTitle(event.target.value);
                                                    }}
                                                    onBlur={() => {
                                                      void commitRename();
                                                    }}
                                                    onKeyDown={(event) => {
                                                      if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        void commitRename();
                                                      }
                                                      if (event.key === "Escape") {
                                                        setRenamingThreadId(null);
                                                      }
                                                    }}
                                                    className="min-w-0 flex-1 rounded-sm border border-input bg-background px-1 py-0.5 text-xs outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                                                  />
                                                ) : (
                                                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
                                                    {worker.title}
                                                  </span>
                                                )}
                                              </button>
                                              <WorkerRuntimePopover
                                                runtimeState={worker.runtimeState}
                                                runtimeStateMessage={worker.runtimeStateMessage}
                                                threadId={worker.id as ThreadId}
                                                worktreePath={worker.worktreePathHint}
                                                workerLabel={worker.title}
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
                            ) : (
                              <div className="relative px-2 py-1.5 text-[10px] text-muted-foreground/70">
                                <span
                                  aria-hidden="true"
                                  className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                />
                                No active orchestrator thread
                              </div>
                            )}
                          </div>
                        ) : null}
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      {programTodosDialog ? (
        <ProgramTodosDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setProgramTodosDialog(null);
            }
          }}
          programId={programTodosDialog.programId}
          programTitle={programTodosDialog.programTitle}
        />
      ) : null}
      {programInfoDialogProgramId ? (
        <ProgramInfoDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setProgramInfoDialogProgramId(null);
            }
          }}
          programId={programInfoDialogProgramId}
        />
      ) : null}
    </>
  );
}
