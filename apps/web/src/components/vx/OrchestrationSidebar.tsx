import { autoAnimate } from "@formkit/auto-animate";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  type AgentRuntimeAgentKind,
  type OrchestrationThreadSummary,
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { useThreadActions } from "~/hooks/useThreadActions";
import { agentsVxappControlPlaneSnapshotQueryOptions } from "~/lib/agentsVxappControlPlaneReactQuery";
import { agentsVxappSidebarGraphQueryOptions } from "~/lib/agentsVxappSidebarReactQuery";
import { agentRuntimeSnapshotQueryOptions } from "~/lib/agentRuntimeReactQuery";
import { orchestrationSessionThreadsQueryOptions } from "~/lib/orchestrationReactQuery";
import { resolveNoThreadRouteTarget, resolveThreadRouteTarget } from "~/lib/sidebarWindow";
import { cn, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { derivePendingApprovals, derivePendingUserInputs } from "~/session-logic";
import { useStore } from "~/store";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useThreadSelectionStore } from "~/threadSelectionStore";
import { useUiStateStore } from "~/uiStateStore";
import type { Thread } from "~/types";
import { buildCopyThreadIdErrorDescription, resolveThreadStatusPill } from "../Sidebar.logic";
import { SidebarBrandHeader } from "../sidebar/SidebarBrandHeader";
import { ThreadStatusLabel, type SidebarThreadStatus } from "../sidebar/SidebarThreadRow";
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
  type SidebarAgentRuntimeState,
  type SidebarNotificationItem,
  type SidebarProgramLaneNode,
  type SidebarProgramNode,
} from "./orchestrationSidebarModel";
import { ProgramInfoDialog } from "./ProgramInfoDialog";
import { ProgramTodosDialog } from "./ProgramTodosDialog";
import { deriveAgentRuntimeDialogState } from "./agentRuntimeDialogState";

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

const CHIP_CLASSNAME =
  "h-4 shrink-0 border border-border/70 bg-background/70 px-1 text-[8px] font-medium leading-none text-foreground/80";

function WakeBadge({ state }: { state: "pending" | "delivering" | null }) {
  if (state === null) {
    return null;
  }
  return <Badge className={CHIP_CLASSNAME}>{state}</Badge>;
}

function RuntimeSourceBadge({ label }: { label: string; status: string }) {
  return (
    <Badge className="h-5 border border-border/70 bg-background/70 px-1.5 text-[10px] font-medium">
      {label}
    </Badge>
  );
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

function RuntimeValueCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</p>
      <p className="mt-1 text-xs font-medium text-foreground/90">{value ?? "unknown"}</p>
    </div>
  );
}

function RuntimeBadgeList({ emptyLabel, items }: { emptyLabel: string; items: readonly string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.length > 0 ? (
        items.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-medium leading-none text-muted-foreground/80"
          >
            {item}
          </Badge>
        ))
      ) : (
        <span className="text-[11px] text-muted-foreground/70">{emptyLabel}</span>
      )}
    </div>
  );
}

function AgentRuntimeInlineBadges({
  agentKind,
  runtimeState,
  runtimeStateMessage,
  threadId,
}: {
  agentKind: AgentRuntimeAgentKind;
  runtimeState: SidebarAgentRuntimeState;
  runtimeStateMessage: string | null;
  threadId: ThreadId | null;
}) {
  const runtimeQuery = useQuery(
    agentRuntimeSnapshotQueryOptions({
      agentKind,
      threadId: runtimeState === "inspectable" ? threadId : null,
    }),
  );

  if (runtimeState !== "inspectable") {
    return <RuntimeStateBadge state={runtimeState} message={runtimeStateMessage} />;
  }

  if (runtimeQuery.isLoading) {
    return (
      <Badge variant="outline" className="h-4 shrink-0 px-1 text-[8px] text-muted-foreground/80">
        loading
      </Badge>
    );
  }

  if (runtimeQuery.isError || !runtimeQuery.data) {
    return (
      <Badge
        variant="outline"
        className="h-4 shrink-0 border-red-500/25 bg-red-500/10 px-1 text-[8px] text-red-700 dark:text-red-300"
      >
        runtime error
      </Badge>
    );
  }

  const snapshot = runtimeQuery.data;
  const generatedAge = formatGeneratedAge(snapshot.summary.generatedAt);

  if (agentKind === "worker") {
    return (
      <>
        {snapshot.summary.repo ? (
          <Badge
            variant="outline"
            className="h-4 max-w-24 shrink-0 px-1 text-[8px] text-muted-foreground/80"
            title={snapshot.summary.repo}
          >
            <span className="truncate">{snapshot.summary.repo}</span>
          </Badge>
        ) : null}
        {snapshot.workerDetails ? (
          <Badge className={CHIP_CLASSNAME}>audit {snapshot.workerDetails.auditStatus}</Badge>
        ) : null}
        {snapshot.workerDetails?.validationProfile ? (
          <Badge variant="outline" className={CHIP_CLASSNAME}>
            {snapshot.workerDetails.validationProfile}
          </Badge>
        ) : null}
      </>
    );
  }

  return (
    <>
      {snapshot.summary.profile ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {snapshot.summary.profile}
        </Badge>
      ) : null}
      {generatedAge ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {generatedAge}
        </Badge>
      ) : null}
      {snapshot.summary.packCount > 0 ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {snapshot.summary.packCount} packs
        </Badge>
      ) : null}
      {snapshot.summary.skillCount > 0 ? (
        <Badge variant="outline" className={CHIP_CLASSNAME}>
          {snapshot.summary.skillCount} skills
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
  threadLabel,
  titleLabel,
  triggerClassName,
}: {
  agentKind: AgentRuntimeAgentKind;
  runtimeState: SidebarAgentRuntimeState;
  runtimeStateMessage: string | null;
  threadId: ThreadId | null;
  threadLabel: string;
  titleLabel: string;
  triggerClassName?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const runtimeLookupEnabled = open && runtimeState === "inspectable";
  const runtimeQuery = useQuery(
    agentRuntimeSnapshotQueryOptions({
      agentKind,
      threadId: runtimeLookupEnabled ? threadId : null,
    }),
  );

  const content = useMemo(() => {
    return deriveAgentRuntimeDialogState({
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
                {runtimeQuery.data.sourceFiles.map((sourceFile) => (
                  <RuntimeSourceBadge
                    key={sourceFile.key}
                    label={sourceFile.label}
                    status={sourceFile.status}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <RuntimeValueCard label="Repo" value={runtimeQuery.data.summary.repo} />
                <RuntimeValueCard
                  label={runtimeQuery.data.runtimeKind === "worker-contract" ? "Task" : "Role"}
                  value={
                    runtimeQuery.data.runtimeKind === "worker-contract"
                      ? runtimeQuery.data.summary.taskClass
                      : runtimeQuery.data.summary.role
                  }
                />
                <RuntimeValueCard
                  label={
                    runtimeQuery.data.runtimeKind === "worker-contract" ? "Context" : "Profile"
                  }
                  value={
                    runtimeQuery.data.runtimeKind === "worker-contract"
                      ? runtimeQuery.data.summary.contextMode
                      : runtimeQuery.data.summary.profile
                  }
                />
                <RuntimeValueCard
                  label={
                    runtimeQuery.data.runtimeKind === "worker-contract" ? "Closeout" : "Generated"
                  }
                  value={
                    runtimeQuery.data.runtimeKind === "worker-contract"
                      ? runtimeQuery.data.summary.closeoutAuthority
                      : runtimeQuery.data.summary.generatedAt
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <RuntimeValueCard label="Workspace" value={runtimeQuery.data.workspaceRoot} />
                <RuntimeValueCard label="Runtime dir" value={runtimeQuery.data.runtimeDir} />
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Resolution
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    {runtimeQuery.data.workspaceResolution.kind}
                  </Badge>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                  {runtimeQuery.data.workspaceResolution.detail ??
                    "No workspace resolution detail."}
                </p>
              </div>

              <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    Source Files
                  </p>
                  <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                    {runtimeQuery.data.sourceFiles.length}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1.5">
                  {runtimeQuery.data.sourceFiles.map((sourceFile) => (
                    <div
                      key={sourceFile.key}
                      className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RuntimeSourceBadge label={sourceFile.label} status={sourceFile.status} />
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] text-muted-foreground/80"
                        >
                          {sourceFile.status}
                        </Badge>
                        <span className="truncate text-[11px] font-medium text-foreground/90">
                          {sourceFile.fileName}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground/70">
                        {sourceFile.absolutePath}
                      </p>
                      {sourceFile.detail ? (
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                          {sourceFile.detail}
                        </p>
                      ) : null}
                    </div>
                  ))}
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
                <RuntimeBadgeList
                  emptyLabel="No packs selected."
                  items={runtimeQuery.data.summary.selectedPacks}
                />
              </div>

              {runtimeQuery.data.runtimeKind === "role-runtime" ? (
                <>
                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Installed Skills
                      </p>
                      <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                        {runtimeQuery.data.summary.installedSkills.length}
                      </Badge>
                    </div>
                    <RuntimeBadgeList
                      emptyLabel="No runtime skills declared."
                      items={runtimeQuery.data.summary.installedSkills}
                    />
                  </div>
                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Role Runtime
                      </p>
                      {runtimeQuery.data.summary.generatedAt ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] text-muted-foreground/80"
                        >
                          {formatGeneratedAge(runtimeQuery.data.summary.generatedAt)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
                      {runtimeQuery.data.roleDetails?.selectionReason ??
                        "No profile selection rationale was recorded."}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <RuntimeValueCard
                      label="Validation"
                      value={runtimeQuery.data.workerDetails?.validationProfile ?? null}
                    />
                    <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Audit
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge className="h-5 border border-border/70 bg-background/70 px-1.5 text-[10px] font-medium">
                          {runtimeQuery.data.workerDetails?.auditStatus ?? "missing"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] text-muted-foreground/80"
                        >
                          {runtimeQuery.data.workerDetails?.packAuditIssueCount ?? 0} pack issues
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Capabilities
                      </p>
                      {runtimeQuery.data.workerDetails?.packAuditStatus ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px] text-muted-foreground/80"
                        >
                          {runtimeQuery.data.workerDetails.packAuditStatus}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          Allowed
                        </p>
                        <RuntimeBadgeList
                          emptyLabel="No explicit allowed capabilities."
                          items={runtimeQuery.data.workerDetails?.allowedCapabilities ?? []}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          Forbidden
                        </p>
                        <RuntimeBadgeList
                          emptyLabel="No explicit forbidden capabilities."
                          items={runtimeQuery.data.workerDetails?.forbiddenCapabilities ?? []}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          Warnings
                        </p>
                        <RuntimeBadgeList
                          emptyLabel="No runtime warnings."
                          items={runtimeQuery.data.workerDetails?.warnings ?? []}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          Conflicts
                        </p>
                        <RuntimeBadgeList
                          emptyLabel="No declared conflicts."
                          items={runtimeQuery.data.workerDetails?.conflicts ?? []}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Pack Inventory
                      </p>
                      <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                        {runtimeQuery.data.workerDetails?.packs.length ?? 0}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {(runtimeQuery.data.workerDetails?.packs ?? []).length > 0 ? (
                        (runtimeQuery.data.workerDetails?.packs ?? []).map((pack) => (
                          <div
                            key={pack.id}
                            className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-medium text-foreground/90">
                                {pack.name ?? pack.slug}
                              </span>
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[9px] text-muted-foreground/80"
                              >
                                {pack.id}
                              </Badge>
                              {pack.scope ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[9px] text-muted-foreground/80"
                                >
                                  {pack.scope}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-[10px] text-muted-foreground/70">
                              {pack.repo ?? "No repo"} · {pack.link}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-muted-foreground/70">
                          No installed packs were recorded.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                        Audit Findings
                      </p>
                      <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
                        {runtimeQuery.data.workerDetails?.auditFindings.length ?? 0}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {(runtimeQuery.data.workerDetails?.auditFindings ?? []).length > 0 ? (
                        (runtimeQuery.data.workerDetails?.auditFindings ?? []).map((finding) => (
                          <div
                            key={`${finding.code ?? "finding"}:${finding.kind ?? "kind"}:${finding.detail ?? "detail"}`}
                            className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              {finding.severity ? (
                                <Badge
                                  className={cn(
                                    "h-5 border-0 px-1.5 text-[10px] font-medium",
                                    finding.severity === "error"
                                      ? "bg-red-500/12 text-red-700 dark:text-red-300"
                                      : finding.severity === "warning"
                                        ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                                        : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {finding.severity}
                                </Badge>
                              ) : null}
                              {finding.code ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[9px] text-muted-foreground/80"
                                >
                                  {finding.code}
                                </Badge>
                              ) : null}
                              {finding.kind ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[9px] text-muted-foreground/80"
                                >
                                  {finding.kind}
                                </Badge>
                              ) : null}
                            </div>
                            {finding.detail ? (
                              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                                {finding.detail}
                              </p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-muted-foreground/70">
                          No audit findings were recorded.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
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
  status,
}: {
  activityAt: string | null;
  status: SidebarThreadStatus | null;
}) {
  if (!status && !activityAt) {
    return null;
  }

  const showsLiveRuntime = status?.label === "Working" || status?.label === "Connecting";
  const activityLabel = activityAt
    ? `${showsLiveRuntime ? "updated" : "last active"} ${formatRelativeTimeLabel(activityAt)}`
    : null;

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
      {status ? <ThreadStatusLabel status={status} compact /> : null}
      {status ? (
        <span className="truncate">{showsLiveRuntime ? `${status.label} now` : status.label}</span>
      ) : null}
      {activityLabel ? <span className="truncate">{activityLabel}</span> : null}
    </div>
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
  const navigate = useNavigate();
  const location = useLocation();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? (params.threadId as ThreadId) : null),
  });
  const controlPlaneQuery = useQuery(agentsVxappControlPlaneSnapshotQueryOptions());
  const sqliteGraphQuery = useQuery(agentsVxappSidebarGraphQueryOptions());
  const programs = useStore((store) => store.programs ?? []);
  const projects = useStore((store) => store.projects);
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
  const [openLaneIds, setOpenLaneIds] = useState<ReadonlySet<string>>(new Set());
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
      }),
    [programs],
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
        currentTodos: controlPlaneQuery.data?.currentTodos ?? [],
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
      controlPlaneQuery.data?.currentTodos,
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

  useEffect(() => {
    const nextAutoOpenState = resolveAutoExpandedSidebarItems({
      executives: model.executives,
      routeThreadId,
    });
    if (nextAutoOpenState.openProgramIds.size > 0) {
      setOpenProgramIds((current) => mergeItems(current, nextAutoOpenState.openProgramIds));
    }
    if (nextAutoOpenState.openLaneIds.size > 0) {
      setOpenLaneIds((current) => mergeItems(current, nextAutoOpenState.openLaneIds));
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
      const programLanes = getProgramLanes(program);
      if (
        isOpen &&
        routeThreadId &&
        (routeThreadId === program.executiveThreadId ||
          programLanes.some(
            (lane) =>
              routeThreadId === lane.id ||
              lane.workers.some((worker) => worker.id === routeThreadId),
          ))
      ) {
        await navigateToNoThread();
      }
      setOpenProgramIds((current) => toggleItem(current, program.id));
    },
    [navigateToNoThread, openProgramIds, routeThreadId],
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
        routeThreadId &&
        (routeThreadId === laneId || lane.workers.some((worker) => worker.id === routeThreadId))
      ) {
        await navigateToNoThread();
      }
      setOpenLaneIds((current) => toggleItem(current, laneId));
    },
    [navigateToNoThread, openLaneIds, routeThreadId],
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

  const renderWorkerRow = (worker: SidebarProgramLaneNode["workers"][number]) => {
    const thread = worker.thread;
    const workerThreadId = worker.id as ThreadId;
    const isActive = routeThreadId === worker.id;
    const isSelected = selectedThreadIds.has(workerThreadId);
    const threadStatus = resolveSidebarThreadStatus({
      archivedAt: worker.archivedAt,
      fallbackThreadLink: worker.fallbackThreadLink,
      isHistorical: worker.isHistorical,
      lastVisitedAt: threadLastVisitedAtById[worker.id] ?? undefined,
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
            runtimeState={worker.runtimeState}
            runtimeStateMessage={worker.runtimeStateMessage}
            threadId={workerThreadId}
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
          threadId={workerThreadId}
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
    const laneStatus = resolveSidebarThreadStatus({
      archivedAt: lane.archivedAt,
      fallbackThreadLink: lane.fallbackThreadLink,
      isHistorical: lane.isHistorical,
      lastVisitedAt: lane.id ? (threadLastVisitedAtById[lane.id] ?? undefined) : undefined,
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
            "flex items-start gap-1 rounded-lg hover:bg-accent/40",
            routeThreadId === lane.id ? "bg-accent/60" : "",
          )}
        >
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
                  threadId={lane.id as ThreadId | null}
                />
              </div>
              <SidebarThreadActivityMeta activityAt={lane.activityAt} status={laneStatus} />
            </div>
          </button>
          <div className="mr-1 mt-1 flex shrink-0 items-center gap-1">
            <AgentRuntimePopover
              agentKind="orchestrator"
              runtimeState={lane.runtimeState}
              runtimeStateMessage={lane.runtimeStateMessage}
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
            {model.executives.map((executive) => {
              const executiveStatus = resolveSidebarThreadStatus({
                fallbackThreadLink: executive.fallbackThreadLink,
                lastVisitedAt: executive.threadId
                  ? (threadLastVisitedAtById[executive.threadId] ?? undefined)
                  : undefined,
                thread: executive.thread,
              });

              return (
                <SidebarMenuItem key={executive.id} className="rounded-md">
                  <SidebarMenuButton
                    size="sm"
                    className={cn(
                      "h-auto min-h-7 gap-2 px-2 py-1.5 pr-16",
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
                        <AgentRuntimeInlineBadges
                          agentKind="executive"
                          runtimeState={executive.runtimeState}
                          runtimeStateMessage={executive.runtimeStateMessage}
                          threadId={executive.threadId as ThreadId | null}
                        />
                      </div>
                      <SidebarThreadActivityMeta
                        activityAt={executive.activityAt}
                        status={executiveStatus}
                      />
                    </div>
                  </SidebarMenuButton>
                  {executive.threadId !== null || executive.fallbackThreadLink !== null ? (
                    <AgentRuntimePopover
                      agentKind="executive"
                      runtimeState={executive.runtimeState}
                      runtimeStateMessage={executive.runtimeStateMessage}
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
