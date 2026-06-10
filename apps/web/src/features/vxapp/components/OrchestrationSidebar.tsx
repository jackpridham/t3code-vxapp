import { autoAnimate } from "@formkit/auto-animate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  type AgentRuntimeAgentKind,
  type ServerGetAgentRuntimeSnapshotResult,
  type ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  type ServerGetWorkerRuntimeSnapshotResult,
  type ThreadId,
} from "@t3tools/contracts";
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
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { useThreadActions } from "~/hooks/useThreadActions";
import { agentRuntimeSnapshotQueryOptions } from "~/features/vxapp/agentRuntimeReactQuery";
import { resolveNoThreadRouteTarget, resolveThreadRouteTarget } from "~/lib/sidebarWindow";
import { cn, newCommandId } from "~/lib/utils";
import { workerRuntimeSnapshotQueryOptions } from "~/features/vxapp/workerRuntimeReactQuery";
import { readNativeApi } from "~/nativeApi";
import { derivePendingApprovals, derivePendingUserInputs } from "~/session-logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { useUiStateStore } from "~/uiStateStore";
import type { Thread } from "~/types";
import {
  buildCopyThreadIdErrorDescription,
  resolveThreadStatusPill,
} from "~/components/Sidebar.logic";
import { SidebarBrandHeader } from "~/components/sidebar/SidebarBrandHeader";
import { ThreadStatusLabel, type SidebarThreadStatus } from "~/components/sidebar/SidebarThreadRow";
import { Badge } from "~/components/ui/badge";
import { DialogCloseButton } from "~/components/ui/dialog-close-button";
import {
  Popover,
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
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
} from "~/components/ui/sidebar";
import { toastManager } from "~/components/ui/toast";
import {
  buildOrchestrationSidebarModel,
  type SidebarAgentRuntimeState,
  type SidebarNotificationItem,
  type SidebarProgramLaneNode,
  type SidebarProgramNode,
} from "./orchestrationSidebarModel";
import { ProgramInfoDialog } from "./ProgramInfoDialog";
import { ProgramTodosDialog } from "./ProgramTodosDialog";
import { AgentRuntimeDetailsPanel } from "./AgentRuntimeDetailsPanel";
import { deriveAgentRuntimeDialogState } from "./agentRuntimeDialogState";
import { useOrchestrationSidebarData } from "./orchestrationSidebarData";
import { deriveWorkerRuntimeDialogState } from "./workerRuntimeDialogState";
import { WorkerRuntimeDetailsPanel } from "./WorkerRuntimeDetailsPanel";
import { VortexErrorBanner } from "./VortexErrorBanner";

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

const CHIP_CLASSNAME =
  "h-4 shrink-0 border border-border/70 bg-background/70 px-1 text-[8px] font-medium leading-none text-foreground/80";

export function OrchestrationSidebarShell({
  children,
  mode = "app",
}: PropsWithChildren<{ mode?: "app" | "standalone" }>) {
  return (
    <>
      <SidebarBrandHeader isElectron={isElectron} isStandaloneWindow={mode === "standalone"} />
      {children}
    </>
  );
}

function WakeBadge({ state }: { state: "pending" | "delivering" | null }) {
  if (state === null) {
    return null;
  }
  return <Badge className={CHIP_CLASSNAME}>{state}</Badge>;
}

function formatGeneratedAge(value: string | null) {
  return value ? formatRelativeTimeLabel(value) : null;
}

function agentRuntimeStateBadgeClasses(state: SidebarAgentRuntimeState) {
  switch (state) {
    case "inspectable":
      return {
        badge: "text-muted-foreground/80",
        label: "runtime",
        title: "Agent runtime can be inspected.",
      };
    case "degraded":
      return {
        badge: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        label: "degraded",
        title: "Agent runtime is partially available.",
      };
    case "unavailable":
      return {
        badge: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
        label: "unavailable",
        title: "Agent runtime is unavailable.",
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

function RuntimeStateBadge({
  state,
  message,
}: {
  state: SidebarAgentRuntimeState;
  message: string | null;
}) {
  const badge = agentRuntimeStateBadgeClasses(state);
  return (
    <Badge
      variant="outline"
      title={message ?? badge.title}
      className={cn("h-4 shrink-0 px-1 text-[8px]", badge.badge)}
    >
      {badge.label}
    </Badge>
  );
}

function AgentRuntimeInlineBadges({
  agentKind,
  fallbackLabel,
  runtimeState,
  runtimeStateMessage,
  snapshotOverride,
  threadId,
  workspace,
}: {
  agentKind: AgentRuntimeAgentKind;
  fallbackLabel?: string | null;
  runtimeState: SidebarAgentRuntimeState;
  runtimeStateMessage: string | null;
  snapshotOverride?:
    | ServerGetAgentRuntimeSnapshotResult
    | ServerGetWorkerRuntimeSnapshotResult
    | null;
  threadId: ThreadId | null;
  workspace?: string | null;
}) {
  const queryClient = useQueryClient();

  if (runtimeState !== "inspectable") {
    return <RuntimeStateBadge state={runtimeState} message={runtimeStateMessage} />;
  }

  const runtimeOptions =
    agentKind === "worker"
      ? workerRuntimeSnapshotQueryOptions({
          threadId,
          workspace: workspace ?? null,
        })
      : agentRuntimeSnapshotQueryOptions({
          agentKind,
          threadId,
        });
  const snapshot = queryClient.getQueryData(runtimeOptions.queryKey) as
    | ServerGetAgentRuntimeSnapshotResult
    | ServerGetWorkerRuntimeSnapshotResult
    | undefined;
  const resolvedSnapshot = snapshotOverride ?? snapshot;
  if (!resolvedSnapshot) {
    if (agentKind === "worker" && fallbackLabel) {
      return (
        <Badge
          variant="outline"
          className="h-4 max-w-24 shrink-0 px-1 text-[8px] text-muted-foreground/80"
          title={fallbackLabel}
        >
          <span className="truncate">{fallbackLabel}</span>
        </Badge>
      );
    }
    return <RuntimeStateBadge state={runtimeState} message={runtimeStateMessage} />;
  }

  if (resolvedSnapshot.availability !== "inspectable") {
    return (
      <RuntimeStateBadge
        state={resolvedSnapshot.availability}
        message={resolvedSnapshot.reasonCode ?? runtimeStateMessage}
      />
    );
  }

  if (agentKind === "worker") {
    const workerSnapshot = resolvedSnapshot as ServerGetWorkerRuntimeSnapshotResult;
    const workerRepo =
      workerSnapshot.contextPlan?.repo?.trim() ||
      workerSnapshot.dispatchContract?.repo?.trim() ||
      workerSnapshot.installedPacks?.repo?.trim() ||
      workerSnapshot.audit.repo?.trim() ||
      null;
    const validationProfile =
      workerSnapshot.contextPlan?.validationProfile?.trim() ||
      workerSnapshot.dispatchContract?.validationProfile?.trim() ||
      null;
    return (
      <>
        {workerRepo ? (
          <Badge
            variant="outline"
            className="h-4 max-w-24 shrink-0 px-1 text-[8px] text-muted-foreground/80"
            title={workerRepo}
          >
            <span className="truncate">{workerRepo}</span>
          </Badge>
        ) : null}
        <Badge className={CHIP_CLASSNAME}>audit {workerSnapshot.audit.status}</Badge>
        {validationProfile ? (
          <Badge variant="outline" className={CHIP_CLASSNAME}>
            {validationProfile}
          </Badge>
        ) : null}
      </>
    );
  }

  const agentSnapshot = resolvedSnapshot as ServerGetAgentRuntimeSnapshotResult;
  const generatedAge = formatGeneratedAge(agentSnapshot.summary.generatedAt);

  return (
    <>
      {agentSnapshot.summary.profile ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {agentSnapshot.summary.profile}
        </Badge>
      ) : null}
      {generatedAge ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {generatedAge}
        </Badge>
      ) : null}
      {agentSnapshot.summary.packCount > 0 ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {agentSnapshot.summary.packCount} packs
        </Badge>
      ) : null}
      {agentSnapshot.summary.skillCount > 0 ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {agentSnapshot.summary.skillCount} skills
        </Badge>
      ) : null}
    </>
  );
}

function AgentRuntimePopover({
  agentKind,
  runtimeState,
  runtimeStateMessage,
  threadId,
  workspace,
  threadLabel,
  titleLabel,
  triggerClassName,
  snapshotOverride,
}: {
  agentKind: AgentRuntimeAgentKind;
  runtimeState: SidebarAgentRuntimeState;
  runtimeStateMessage: string | null;
  snapshotOverride?:
    | ServerGetAgentRuntimeSnapshotResult
    | ServerGetWorkerRuntimeSnapshotResult
    | null;
  threadId: ThreadId | null;
  workspace?: string | null;
  threadLabel: string;
  titleLabel: string;
  triggerClassName?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const runtimeLookupEnabled = open && runtimeState === "inspectable" && snapshotOverride == null;
  const workerRuntimeQuery = useQuery(
    workerRuntimeSnapshotQueryOptions({
      threadId: runtimeLookupEnabled && agentKind === "worker" ? threadId : null,
      workspace: runtimeLookupEnabled && agentKind === "worker" ? (workspace ?? null) : null,
    }),
  );
  const agentRuntimeQuery = useQuery(
    agentRuntimeSnapshotQueryOptions({
      agentKind,
      threadId: runtimeLookupEnabled && agentKind !== "worker" ? threadId : null,
    }),
  );

  const content = useMemo(() => {
    if (agentKind === "worker") {
      return deriveWorkerRuntimeDialogState({
        data:
          (snapshotOverride as ServerGetWorkerRuntimeSnapshotResult | null) ??
          workerRuntimeQuery.data,
        error: workerRuntimeQuery.error instanceof Error ? workerRuntimeQuery.error : null,
        isError: snapshotOverride == null && workerRuntimeQuery.isError,
        isLoading: snapshotOverride == null && workerRuntimeQuery.isLoading,
        unavailableHint:
          runtimeState === "inspectable"
            ? null
            : {
                kind: runtimeState,
                message: runtimeStateMessage,
              },
        threadId,
      });
    }
    return deriveAgentRuntimeDialogState({
      data:
        (snapshotOverride as ServerGetAgentRuntimeSnapshotResult | null) ?? agentRuntimeQuery.data,
      error: agentRuntimeQuery.error instanceof Error ? agentRuntimeQuery.error : null,
      isError: snapshotOverride == null && agentRuntimeQuery.isError,
      isLoading: snapshotOverride == null && agentRuntimeQuery.isLoading,
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
    agentKind,
    agentRuntimeQuery.data,
    agentRuntimeQuery.error,
    agentRuntimeQuery.isError,
    agentRuntimeQuery.isLoading,
    runtimeState,
    runtimeStateMessage,
    threadId,
    snapshotOverride,
    workerRuntimeQuery.data,
    workerRuntimeQuery.error,
    workerRuntimeQuery.isError,
    workerRuntimeQuery.isLoading,
  ]);

  const runtimeQuery = agentKind === "worker" ? workerRuntimeQuery : agentRuntimeQuery;
  const resolvedRuntimeData = snapshotOverride ?? runtimeQuery.data;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground",
              triggerClassName,
            )}
            aria-label={`Open runtime details for ${threadLabel}`}
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
            description="Live agent runtime contract details loaded on demand."
            icon={<HardHatIcon className="size-4" />}
            title={`${titleLabel} runtime`}
          />

          {content.mode !== "ready" || !resolvedRuntimeData ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 px-3 py-4">
              <p className="text-xs font-medium text-foreground/90">{content.mode}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                {content.message}
              </p>
            </div>
          ) : agentKind === "worker" ? (
            <WorkerRuntimeDetailsPanel
              snapshot={resolvedRuntimeData as ServerGetWorkerRuntimeSnapshotResult}
            />
          ) : (
            <AgentRuntimeDetailsPanel
              snapshot={resolvedRuntimeData as ServerGetAgentRuntimeSnapshotResult}
            />
          )}
        </div>
      </PopoverPopup>
    </Popover>
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
  const attention = notifications.filter((notification) => notification.section === "attention");
  const updates = notifications.filter((notification) => notification.section === "program-update");

  return (
    <Popover>
      <PopoverTrigger
        render={
          <SidebarMenuAction
            type="button"
            aria-label="Open executive notifications"
            className="right-1 top-1 size-6 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
                "bg-secondary text-foreground",
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
                    return (
                      <div
                        key={notification.id}
                        className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="h-4 border border-border/70 bg-background/70 px-1 text-[9px]"
                          >
                            {notification.severity}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] text-muted-foreground/80"
                          >
                            {notification.displayLabel ?? notification.kind}
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

function getProgramLanes(program: SidebarProgramNode): SidebarProgramLaneNode[] {
  return program.currentLane
    ? [program.currentLane, ...program.historicalLanes]
    : program.historicalLanes;
}

function resolveSidebarThreadStatus(input: {
  archivedAt?: string | null | undefined;
  fallbackThreadLink: SidebarProgramLaneNode["fallbackThreadLink"];
  isHistorical?: boolean | undefined;
  lastVisitedAt?: string | undefined;
  thread: Thread | null;
}): SidebarThreadStatus | null {
  const shouldSuppressLiveRuntime = input.isHistorical || input.archivedAt != null;

  if (input.thread) {
    const threadStatus = resolveThreadStatusPill({
      thread: {
        ...input.thread,
        lastVisitedAt: input.lastVisitedAt,
      },
      hasPendingApprovals: derivePendingApprovals(input.thread.activities).length > 0,
      hasPendingUserInput: derivePendingUserInputs(input.thread.activities).length > 0,
    });
    if (
      shouldSuppressLiveRuntime &&
      (threadStatus?.label === "Working" || threadStatus?.label === "Connecting")
    ) {
      return null;
    }
    return threadStatus;
  }

  if (!input.fallbackThreadLink) {
    return null;
  }

  const fallbackStatus = resolveThreadStatusPill({
    thread: {
      interactionMode: "default",
      latestTurn: input.fallbackThreadLink.latestTurn,
      lastVisitedAt: input.lastVisitedAt,
      proposedPlans: [],
      session: input.fallbackThreadLink.session,
    } as Parameters<typeof resolveThreadStatusPill>[0]["thread"],
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  });

  if (fallbackStatus?.label === "Completed") {
    return null;
  }

  if (
    shouldSuppressLiveRuntime &&
    (fallbackStatus?.label === "Working" || fallbackStatus?.label === "Connecting")
  ) {
    return null;
  }

  return fallbackStatus;
}

function SidebarThreadActivityMeta({
  activityAt,
  isActiveNow = false,
  status,
}: {
  activityAt: string | null;
  isActiveNow?: boolean;
  status: SidebarThreadStatus | null;
}) {
  if (!status && !activityAt && !isActiveNow) {
    return null;
  }

  const showsLiveRuntime = hasSidebarLiveRuntimeStatus(status, isActiveNow);
  const activityLabel = activityAt
    ? `${showsLiveRuntime ? "updated" : "last active"} ${formatRelativeTimeLabel(activityAt)}`
    : null;

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
      {status ? (
        <ThreadStatusLabel status={status} compact />
      ) : showsLiveRuntime ? (
        <span className="relative inline-flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500/60 dark:bg-sky-300/60" />
          <span className="relative inline-flex size-2 rounded-full bg-sky-500 dark:bg-sky-300" />
        </span>
      ) : null}
      {status ? (
        <span className="truncate">{showsLiveRuntime ? `${status.label} now` : status.label}</span>
      ) : showsLiveRuntime ? (
        <span className="truncate">Active now</span>
      ) : null}
      {activityLabel ? <span className="truncate">{activityLabel}</span> : null}
    </div>
  );
}

function hasSidebarLiveRuntimeStatus(status: SidebarThreadStatus | null, isActiveNow = false) {
  return isActiveNow || status?.label === "Working" || status?.label === "Connecting";
}

function SidebarActiveRuntimeRail({
  status,
  isActiveNow = false,
}: {
  status: SidebarThreadStatus | null;
  isActiveNow?: boolean;
}) {
  if (!hasSidebarLiveRuntimeStatus(status, isActiveNow)) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-sky-500/80 shadow-[0_0_10px_color-mix(in_srgb,var(--color-sky-500)_55%,transparent)] animate-pulse"
    />
  );
}

function resolveAutoExpandedSidebarItems(input: {
  executives: ReturnType<typeof buildOrchestrationSidebarModel>["executives"];
  routeThreadId: ThreadId | null;
}) {
  const openProgramIds = new Set<string>();
  const openLaneIds = new Set<string>();
  if (!input.routeThreadId) {
    return { openLaneIds, openProgramIds };
  }

  for (const executive of input.executives) {
    for (const program of executive.programs) {
      const programLanes = getProgramLanes(program);
      const activeLane = programLanes.find(
        (lane) =>
          input.routeThreadId === lane.id ||
          lane.workers.some((worker) => worker.id === input.routeThreadId),
      );
      if (input.routeThreadId === program.executiveThreadId || activeLane !== undefined) {
        openProgramIds.add(program.id);
      }
      if (activeLane?.id) {
        openLaneIds.add(activeLane.id);
      }
    }
  }

  return { openLaneIds, openProgramIds };
}

export default function VxOrchestrationSidebar({ mode = "app" }: { mode?: "app" | "standalone" }) {
  const settings = useSettings();
  const sidebarData = useOrchestrationSidebarData();
  const navigate = useNavigate();
  const location = useLocation();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? (params.threadId as ThreadId) : null),
  });
  const authoritySnapshot = sidebarData.authoritySnapshot;
  const authorityStatus = sidebarData.authorityStatus;
  const authorityError = sidebarData.authorityError;
  const refreshSidebarAuthority = sidebarData.refreshSidebarAuthority;
  const programs = useMemo(
    () => authoritySnapshot?.programs.map((card) => card.program) ?? [],
    [authoritySnapshot],
  );
  const programsPagination = authoritySnapshot?.pagination ?? null;
  const projects = sidebarData.projects;
  const threads = sidebarData.threads;
  const threadLastVisitedAtById = sidebarData.threadLastVisitedAtById;
  const threadVisitedAtById = threadLastVisitedAtById as Record<string, string | undefined>;
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const selectedThreadIds = useThreadSelectionStore((store) => store.selectedThreadIds);
  const toggleThread = useThreadSelectionStore((store) => store.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((store) => store.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((store) => store.clearSelection);
  const setAnchor = useThreadSelectionStore((store) => store.setAnchor);
  const { archiveThread, deleteThread } = useThreadActions();
  const [openProgramIds, setOpenProgramIds] = useState<ReadonlySet<string>>(new Set());
  const [openLaneIds, setOpenLaneIds] = useState<ReadonlySet<string>>(new Set());
  const [programTodosDialog, setProgramTodosDialog] = useState<{
    programId: string;
    programTitle: string;
  } | null>(null);
  const [programInfoDialogProgramId, setProgramInfoDialogProgramId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [demoSelectedThreadId, setDemoSelectedThreadId] = useState<ThreadId | null>(null);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const animatedListsRef = useRef(new WeakSet<HTMLElement>());
  const attachAnimatedListRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedListsRef.current.add(node);
  }, []);

  const model = useMemo(
    () =>
      buildOrchestrationSidebarModel({
        authoritySnapshot,
        ctoAttentionItems: [],
        currentTodos: authoritySnapshot?.currentTodos ?? [],
        programNotifications: [],
        programs,
        projects,
        sessionWorkerThreadsByRootId: new Map(),
        sqliteGraph: null,
        threads,
        wakeItems: [],
      }),
    [authoritySnapshot, programs, projects, threads],
  );
  const effectiveRouteThreadId =
    sidebarData.dataMode === "demo" ? demoSelectedThreadId : routeThreadId;

  const orderedWorkerThreadIds = useMemo(
    () =>
      model.executives.flatMap((executive) =>
        executive.programs.flatMap((program) =>
          getProgramLanes(program).flatMap((lane) => lane.workers.map((worker) => worker.id)),
        ),
      ),
    [model.executives],
  );
  const staleMirrorDescription = useMemo(() => {
    if (!import.meta.env.DEV || !model.diagnostics.staleMirror) {
      return null;
    }
    const parts: string[] = [];
    if (model.diagnostics.missingProjectIds.length > 0) {
      parts.push(`${model.diagnostics.missingProjectIds.length} projects`);
    }
    if (model.diagnostics.missingThreadIds.length > 0) {
      parts.push(`${model.diagnostics.missingThreadIds.length} threads`);
    }
    const suffix = parts.length > 0 ? parts.join(", ") : "referenced rows";
    return `Dev DB mirror is stale: ${suffix} from agents-vxapp SQLite disagree with local T3 state. Rerun python3 scripts/seed-dev-db.py.`;
  }, [model.diagnostics]);
  const authorityProgramCardById = useMemo(
    () =>
      new Map((authoritySnapshot?.programs ?? []).map((card) => [card.program.id, card] as const)),
    [authoritySnapshot],
  );
  const authorityTodosByProgramId = useMemo(() => {
    const next = new Map<
      string,
      ServerGetAgentsVxappSidebarAuthoritySnapshotResult["todos"][number][]
    >();
    for (const todo of authoritySnapshot?.todos ?? []) {
      if (!todo.programId) {
        continue;
      }
      const existing = [...(next.get(todo.programId) ?? [])];
      existing.push(todo);
      next.set(todo.programId, existing);
    }
    return next;
  }, [authoritySnapshot]);
  const getDemoProgramDialogData = useCallback(
    (programId: string) => ({
      currentTodoId:
        authoritySnapshot?.currentTodos.find((todo) => todo.programId === programId)?.todoId ??
        null,
      error: null,
      programCard:
        authorityProgramCardById.get(
          programId as ServerGetAgentsVxappSidebarAuthoritySnapshotResult["programs"][number]["program"]["id"],
        ) ?? null,
      status: authorityStatus,
      todoCount: authorityTodosByProgramId.get(programId)?.length ?? 0,
      todos: authorityTodosByProgramId.get(programId) ?? [],
    }),
    [authorityProgramCardById, authoritySnapshot, authorityStatus, authorityTodosByProgramId],
  );

  useEffect(() => {
    if (sidebarData.dataMode !== "demo" || demoSelectedThreadId !== null) {
      return;
    }
    const firstThreadId =
      model.executives[0]?.threadId ??
      model.executives[0]?.programs[0]?.executiveThreadId ??
      model.executives[0]?.programs[0]?.currentLane?.id ??
      model.executives[0]?.programs[0]?.currentLane?.workers[0]?.id ??
      null;
    setDemoSelectedThreadId(firstThreadId as ThreadId | null);
  }, [demoSelectedThreadId, model.executives, sidebarData.dataMode]);

  useEffect(() => {
    const nextAutoOpenState = resolveAutoExpandedSidebarItems({
      executives: model.executives,
      routeThreadId: effectiveRouteThreadId,
    });
    if (nextAutoOpenState.openProgramIds.size > 0) {
      setOpenProgramIds((current) => mergeItems(current, nextAutoOpenState.openProgramIds));
    }
    if (nextAutoOpenState.openLaneIds.size > 0) {
      setOpenLaneIds((current) => mergeItems(current, nextAutoOpenState.openLaneIds));
    }
  }, [effectiveRouteThreadId, model.executives]);

  useEffect(() => {
    if (renamingThreadId && renamingInputRef.current) {
      renamingInputRef.current.focus();
      renamingInputRef.current.select();
    }
  }, [renamingThreadId]);

  const navigateToThread = useCallback(
    async (threadId: ThreadId) => {
      if (sidebarData.dataMode === "demo") {
        setDemoSelectedThreadId(threadId);
        return;
      }
      await navigate(resolveThreadRouteTarget(location.pathname, threadId));
    },
    [location.pathname, navigate, sidebarData.dataMode],
  );
  const navigateToNoThread = useCallback(async () => {
    if (sidebarData.dataMode === "demo") {
      setDemoSelectedThreadId(null);
      return;
    }
    await navigate(resolveNoThreadRouteTarget(location.pathname));
  }, [location.pathname, navigate, sidebarData.dataMode]);

  const handleProgramToggle = useCallback(
    async (program: (typeof model.executives)[number]["programs"][number]) => {
      const isOpen = openProgramIds.has(program.id);
      const programLanes = getProgramLanes(program);
      if (
        isOpen &&
        effectiveRouteThreadId &&
        (effectiveRouteThreadId === program.executiveThreadId ||
          programLanes.some(
            (lane) =>
              effectiveRouteThreadId === lane.id ||
              lane.workers.some((worker) => worker.id === effectiveRouteThreadId),
          ))
      ) {
        await navigateToNoThread();
      }
      setOpenProgramIds((current) => toggleItem(current, program.id));
    },
    [effectiveRouteThreadId, navigateToNoThread, openProgramIds],
  );

  const handleLaneToggle = useCallback(
    async (lane: SidebarProgramLaneNode) => {
      if (!lane.id) {
        return;
      }
      const laneId = lane.id;
      const isOpen = openLaneIds.has(laneId);
      if (
        isOpen &&
        effectiveRouteThreadId &&
        (effectiveRouteThreadId === laneId ||
          lane.workers.some((worker) => worker.id === effectiveRouteThreadId))
      ) {
        await navigateToNoThread();
      }
      setOpenLaneIds((current) => toggleItem(current, laneId));
    },
    [effectiveRouteThreadId, navigateToNoThread, openLaneIds],
  );

  const handleLaneNavigate = useCallback(
    async (lane: SidebarProgramLaneNode) => {
      if (!lane.id) {
        return;
      }
      await navigateToThread(lane.id as ThreadId);
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
      if (sidebarData.isReadOnly) {
        toastManager.add({
          type: "info",
          title: "Demo mode is read-only",
          description: "Worker mutations are disabled while the sidebar is showing demo data.",
        });
        return;
      }
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
      sidebarData.isReadOnly,
      threads,
    ],
  );

  const renderWorkerRow = (worker: SidebarProgramLaneNode["workers"][number]) => {
    const thread = worker.thread;
    const workerThreadId = worker.id as ThreadId;
    const workerRuntimeSnapshot = sidebarData.getWorkerRuntimeSnapshot(worker.id);
    const isActive = effectiveRouteThreadId === worker.id;
    const isSelected = selectedThreadIds.has(workerThreadId);
    const threadStatus = resolveSidebarThreadStatus({
      archivedAt: worker.archivedAt,
      fallbackThreadLink: worker.fallbackThreadLink,
      isHistorical: worker.isHistorical,
      lastVisitedAt: threadVisitedAtById[worker.id] ?? undefined,
      thread,
    });

    return (
      <div
        key={worker.id}
        className={cn(
          "relative flex items-center gap-1 rounded-md px-1.5 py-1 text-left",
          isActive || isSelected ? "bg-accent/60" : "hover:bg-accent/40",
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
            if (event.shiftKey) {
              rangeSelectTo(workerThreadId, orderedWorkerThreadIds as ThreadId[]);
              return;
            }
            if (event.metaKey || event.ctrlKey) {
              toggleThread(workerThreadId);
              return;
            }
            clearSelection();
            setAnchor(workerThreadId);
            void navigateToThread(workerThreadId);
          }}
        >
          <span
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-md",
              worker.isHistorical
                ? "bg-muted text-muted-foreground"
                : "bg-amber-500/12 text-amber-600 dark:text-amber-300",
            )}
          >
            <HardHatIcon className="size-3" />
          </span>
          {threadStatus ? <ThreadStatusLabel status={threadStatus} compact /> : null}
          <AgentRuntimeInlineBadges
            agentKind="worker"
            fallbackLabel={worker.provenanceLabel}
            runtimeState={worker.runtimeState}
            runtimeStateMessage={worker.runtimeStateMessage}
            snapshotOverride={workerRuntimeSnapshot}
            threadId={workerThreadId}
            workspace={worker.worktreePathHint}
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
        <AgentRuntimePopover
          agentKind="worker"
          runtimeState={worker.runtimeState}
          runtimeStateMessage={worker.runtimeStateMessage}
          snapshotOverride={workerRuntimeSnapshot}
          threadId={workerThreadId}
          workspace={worker.worktreePathHint}
          threadLabel={worker.title}
          titleLabel={worker.title}
        />
      </div>
    );
  };

  const renderLane = (
    lane: SidebarProgramLaneNode,
    program: (typeof model.executives)[number]["programs"][number],
    showTodosAction: boolean,
  ) => {
    const laneOpen = lane.id ? openLaneIds.has(lane.id) : false;
    const laneRuntimeSnapshot = sidebarData.getAgentRuntimeSnapshot(
      "orchestrator",
      lane.id as string | null,
    );
    const laneStatus = resolveSidebarThreadStatus({
      archivedAt: lane.archivedAt,
      fallbackThreadLink: lane.fallbackThreadLink,
      isHistorical: lane.isHistorical,
      lastVisitedAt: lane.id ? (threadVisitedAtById[lane.id] ?? undefined) : undefined,
      thread: lane.thread,
    });

    return (
      <div key={lane.id ?? `${program.id}:${lane.title}`} className="relative">
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
        />
        <div
          className={cn(
            "relative isolate flex items-start gap-1 rounded-lg hover:bg-accent/40",
            effectiveRouteThreadId === lane.id ? "bg-accent/60" : "",
          )}
        >
          <SidebarActiveRuntimeRail status={laneStatus} isActiveNow={lane.isActiveNow} />
          <button
            type="button"
            aria-label={
              laneOpen ? `Collapse workers for ${lane.title}` : `Expand workers for ${lane.title}`
            }
            className="ml-1 mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              void handleLaneToggle(lane);
            }}
          >
            <ChevronRightIcon
              className={cn("size-3 shrink-0 transition-transform", laneOpen ? "rotate-90" : "")}
            />
          </button>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg py-1.5 pr-2 text-left"
            onClick={() => {
              void handleLaneNavigate(lane);
            }}
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
              <BotIcon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {laneStatus ? <ThreadStatusLabel status={laneStatus} compact /> : null}
                <span className="truncate text-[11px] font-medium text-foreground/90">
                  {lane.title}
                </span>
                <Badge variant="outline" className={CHIP_CLASSNAME}>
                  {lane.workerCount} workers
                </Badge>
                {lane.isHistorical ? (
                  <Badge variant="outline" className={CHIP_CLASSNAME}>
                    Historical
                  </Badge>
                ) : null}
                <AgentRuntimeInlineBadges
                  agentKind="orchestrator"
                  runtimeState={lane.runtimeState}
                  runtimeStateMessage={lane.runtimeStateMessage}
                  snapshotOverride={laneRuntimeSnapshot}
                  threadId={lane.id as ThreadId | null}
                />
              </div>
              <SidebarThreadActivityMeta
                activityAt={lane.activityAt}
                isActiveNow={lane.isActiveNow}
                status={laneStatus}
              />
            </div>
          </button>
          <div className="mr-1 mt-1 flex shrink-0 items-center gap-1">
            <AgentRuntimePopover
              agentKind="orchestrator"
              runtimeState={lane.runtimeState}
              runtimeStateMessage={lane.runtimeStateMessage}
              snapshotOverride={laneRuntimeSnapshot}
              threadId={lane.id as ThreadId | null}
              threadLabel={lane.title}
              titleLabel={lane.title}
            />
            {showTodosAction ? (
              <button
                type="button"
                aria-label={`Open TODOs for ${program.title}`}
                className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
            ) : null}
          </div>
        </div>

        {laneOpen ? (
          <div ref={attachAnimatedListRef} className="ml-3 border-l border-border/50 pl-2">
            {lane.workers.length > 0 ? (
              <div ref={attachAnimatedListRef} className="space-y-0.5">
                {lane.workers.map((worker) => renderWorkerRow(worker))}
              </div>
            ) : (
              <div className="relative px-2 py-1.5 text-[10px] text-muted-foreground/70">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                />
                {lane.isHistorical ? "No historical workers" : "No workers"}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const isStandaloneWindow = mode === "standalone";

  return (
    <OrchestrationSidebarShell mode={mode}>
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 py-2" data-testid="vx-orchestration-sidebar">
          {authorityStatus === "error" ? (
            <div className="mb-2">
              <VortexErrorBanner
                heading="Owner data unavailable"
                error={authorityError}
                fallbackMessage="Failed to load agents-vxapp authority state."
              />
            </div>
          ) : null}
          {authorityStatus === "loading" && authoritySnapshot === null ? (
            <div className="mb-2 rounded-lg border border-dashed border-border/70 bg-secondary/20 px-2.5 py-2 text-[11px] text-muted-foreground/80">
              Loading agents-vxapp authority state.
            </div>
          ) : null}
          {programsPagination ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2 text-[11px] text-muted-foreground/80">
              <span className="min-w-0 flex-1 truncate">
                Program page {programsPagination.page}: {programs.length} of{" "}
                {programsPagination.total}
              </span>
              {programsPagination.hasMore ? (
                <button
                  className="shrink-0 rounded border border-border/70 bg-background/70 px-1.5 py-0.5 font-medium text-foreground/80 hover:bg-accent"
                  type="button"
                  onClick={() =>
                    void refreshSidebarAuthority({
                      force: true,
                      limit: programsPagination.limit,
                      page: programsPagination.page + 1,
                    })
                  }
                >
                  Next
                </button>
              ) : null}
            </div>
          ) : null}
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
            {model.executives.map((executive) => {
              const executiveRuntimeSnapshot = sidebarData.getAgentRuntimeSnapshot(
                "executive",
                executive.threadId,
              );
              const executiveStatus = resolveSidebarThreadStatus({
                fallbackThreadLink: executive.fallbackThreadLink,
                lastVisitedAt: executive.threadId
                  ? (threadVisitedAtById[executive.threadId] ?? undefined)
                  : undefined,
                thread: executive.thread,
              });

              return (
                <SidebarMenuItem key={executive.id} className="rounded-md">
                  <SidebarMenuButton
                    size="sm"
                    data-testid={
                      executive.threadId ? `thread-row-${executive.threadId}` : undefined
                    }
                    className={cn(
                      "relative isolate h-auto min-h-7 gap-2 px-2 py-1.5 pr-16",
                      executive.threadId ? "cursor-pointer" : "",
                    )}
                    render={executive.threadId ? <button type="button" /> : <div />}
                    isActive={effectiveRouteThreadId === executive.threadId}
                    onClick={
                      executive.threadId
                        ? () => {
                            void navigateToThread(executive.threadId as ThreadId);
                          }
                        : undefined
                    }
                  >
                    <SidebarActiveRuntimeRail
                      status={executiveStatus}
                      isActiveNow={executive.isActiveNow}
                    />
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-500 dark:text-fuchsia-300">
                      <BotIcon className="size-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {executiveStatus ? (
                          <ThreadStatusLabel status={executiveStatus} compact />
                        ) : null}
                        <span className="truncate text-[11px] font-medium text-foreground/90">
                          {executive.label}
                        </span>
                        <Badge variant="outline" className={CHIP_CLASSNAME}>
                          Executive
                        </Badge>
                        <AgentRuntimeInlineBadges
                          agentKind="executive"
                          runtimeState={executive.runtimeState}
                          runtimeStateMessage={executive.runtimeStateMessage}
                          snapshotOverride={executiveRuntimeSnapshot}
                          threadId={executive.threadId as ThreadId | null}
                        />
                      </div>
                      <SidebarThreadActivityMeta
                        activityAt={executive.activityAt}
                        isActiveNow={executive.isActiveNow}
                        status={executiveStatus}
                      />
                    </div>
                  </SidebarMenuButton>
                  {executive.threadId !== null || executive.fallbackThreadLink !== null ? (
                    <AgentRuntimePopover
                      agentKind="executive"
                      runtimeState={executive.runtimeState}
                      runtimeStateMessage={executive.runtimeStateMessage}
                      snapshotOverride={executiveRuntimeSnapshot}
                      threadId={executive.threadId as ThreadId | null}
                      threadLabel={executive.label}
                      titleLabel={executive.label}
                      triggerClassName="absolute right-8 top-1 size-6"
                    />
                  ) : null}
                  <ExecutiveNotificationsPopover notifications={executive.notifications} />

                  <SidebarMenuSub ref={attachAnimatedListRef} className="mx-1 mt-1 gap-1 px-1.5">
                    {executive.programs.map((program) => {
                      const programOpen = openProgramIds.has(program.id);
                      const programLanes = getProgramLanes(program);
                      const baseStatusLabel =
                        program.baseStatus && program.baseStatus !== program.currentStatus
                          ? program.baseStatus
                          : null;
                      const watchLabel = program.watch?.classification
                        ? program.watch.classification
                        : null;
                      const missingCount = program.closeoutSummary.missingItems.length;

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
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                  <span className="truncate text-[11px] font-medium text-foreground/90">
                                    {program.displayHeading}
                                  </span>
                                  <Badge
                                    className={cn(CHIP_CLASSNAME, program.displayTone ?? undefined)}
                                  >
                                    {program.displayLabel ?? program.status}
                                  </Badge>
                                  {baseStatusLabel ? (
                                    <Badge variant="outline" className={CHIP_CLASSNAME}>
                                      base {baseStatusLabel}
                                    </Badge>
                                  ) : null}
                                  {program.attentionCount > 0 ? (
                                    <Badge className="h-4 border-0 bg-red-500/12 px-1 text-[8px] text-red-700 dark:text-red-300">
                                      {program.attentionCount} attention
                                    </Badge>
                                  ) : null}
                                  {program.currentTodo ? (
                                    <Badge
                                      variant="outline"
                                      title={program.currentTodo.todoId}
                                      className={CHIP_CLASSNAME}
                                    >
                                      todo {program.currentTodo.agent}
                                    </Badge>
                                  ) : null}
                                  {watchLabel ? (
                                    <Badge variant="outline" className={CHIP_CLASSNAME}>
                                      {watchLabel}
                                    </Badge>
                                  ) : null}
                                  {program.activeWorkerCount > 0 ? (
                                    <Badge variant="outline" className={CHIP_CLASSNAME}>
                                      {program.activeWorkerCount} workers
                                    </Badge>
                                  ) : null}
                                  {missingCount > 0 ? (
                                    <Badge variant="outline" className={CHIP_CLASSNAME}>
                                      {missingCount} gaps
                                    </Badge>
                                  ) : program.closeoutSummary.verdict ? (
                                    <Badge variant="outline" className={CHIP_CLASSNAME}>
                                      {program.closeoutSummary.verdict}
                                    </Badge>
                                  ) : null}
                                </div>
                                {program.statusDetail ? (
                                  <p className="mt-1 truncate text-[10px] leading-relaxed text-muted-foreground/75">
                                    {program.statusDetail}
                                  </p>
                                ) : null}
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                                  <Badge
                                    variant="outline"
                                    title={program.closeoutSummary.scopeSummary ?? undefined}
                                    className={CHIP_CLASSNAME}
                                  >
                                    scope
                                  </Badge>
                                </div>
                              </div>
                            </SidebarMenuSubButton>
                            <button
                              type="button"
                              aria-label={`Open TODOs for ${program.title}`}
                              className="mt-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                              {program.currentLane === null &&
                              program.historicalLanes.length === 0 ? (
                                <div className="relative">
                                  <span
                                    aria-hidden="true"
                                    className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                  />
                                  <div className="flex items-start gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-2 py-1.5">
                                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
                                      <BotIcon className="size-3" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        <span className="text-[11px] font-medium text-foreground/90">
                                          No active orchestrator lane
                                        </span>
                                        {program.historicalOrchestratorCount > 0 ? (
                                          <Badge variant="outline" className={CHIP_CLASSNAME}>
                                            {program.historicalOrchestratorCount} historical lanes
                                          </Badge>
                                        ) : null}
                                        {program.historicalWorkerCount > 0 ? (
                                          <Badge variant="outline" className={CHIP_CLASSNAME}>
                                            {program.historicalWorkerCount} historical workers
                                          </Badge>
                                        ) : null}
                                      </div>
                                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                                        {program.statusDetail ??
                                          (program.lastHistoricalLane
                                            ? `Most recent archived lane: ${program.lastHistoricalLane.title}.`
                                            : "This Program currently has no active lane and no recorded historical lineage.")}
                                      </p>
                                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                                        {program.lastHistoricalLane
                                          ? `Most recent archived lane: ${program.lastHistoricalLane.title}.`
                                          : "No historical orchestration lineage is recorded for this Program."}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      aria-label={`Open TODOs for ${program.title}`}
                                      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                                </div>
                              ) : (
                                <>
                                  {program.currentLane === null &&
                                  program.historicalLanes.length > 0 ? (
                                    <div className="relative mb-1">
                                      <span
                                        aria-hidden="true"
                                        className="absolute left-0 top-3 h-px w-2 -translate-x-full bg-border/60"
                                      />
                                      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border/60 bg-muted/20 px-2 py-1.5">
                                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
                                          <BotIcon className="size-3" />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                            <span className="text-[11px] font-medium text-foreground/90">
                                              No active orchestrator lane
                                            </span>
                                            <Badge variant="outline" className={CHIP_CLASSNAME}>
                                              {program.historicalOrchestratorCount} historical lanes
                                            </Badge>
                                            {program.historicalWorkerCount > 0 ? (
                                              <Badge variant="outline" className={CHIP_CLASSNAME}>
                                                {program.historicalWorkerCount} historical workers
                                              </Badge>
                                            ) : null}
                                          </div>
                                          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                                            {program.statusDetail ??
                                              "Historical orchestration remains browsable below."}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          aria-label={`Open TODOs for ${program.title}`}
                                          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                                    </div>
                                  ) : null}

                                  <div ref={attachAnimatedListRef} className="space-y-1">
                                    {programLanes.map((lane, laneIndex) =>
                                      renderLane(
                                        lane,
                                        program,
                                        laneIndex === 0 && program.currentLane !== null,
                                      ),
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      {programTodosDialog ? (
        <ProgramTodosDialog
          demoData={
            sidebarData.dataMode === "demo"
              ? getDemoProgramDialogData(programTodosDialog.programId)
              : null
          }
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
          demoData={
            sidebarData.dataMode === "demo"
              ? getDemoProgramDialogData(programInfoDialogProgramId)
              : null
          }
          open
          onOpenChange={(open) => {
            if (!open) {
              setProgramInfoDialogProgramId(null);
            }
          }}
          programId={programInfoDialogProgramId}
        />
      ) : null}
    </OrchestrationSidebarShell>
  );
}
