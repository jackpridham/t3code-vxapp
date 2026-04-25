import type { OrchestratorWakeItem } from "@t3tools/contracts";
import { BellRingIcon, FlaskConicalIcon, ListTodoIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { readNativeApi } from "~/nativeApi";
import type { Program, ProgramNotification, Project, Thread } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { getSidebarProgramNotificationKindLabel } from "../Sidebar.logic";
import {
  buildDevProgramNotificationCommand,
  buildDevWakeUpsertCommand,
  DEV_ORCHESTRATOR_WAKE_OPTIONS,
  DEV_PROGRAM_NOTIFICATION_KIND_SECTIONS,
  resolveDevOrchestratorTargets,
  resolveDevProgramTargets,
} from "./devOrchestrationMenu";

function formatWakeStateLabel(state: OrchestratorWakeItem["state"]): string {
  switch (state) {
    case "pending":
      return "pending";
    case "delivering":
      return "delivering";
    case "delivered":
      return "delivered";
    case "consumed":
      return "consumed";
    case "dropped":
      return "dropped";
  }
}

function formatTargetRoles(target: ReturnType<typeof resolveDevProgramTargets>[number]): string {
  return target.roles.join(", ");
}

export function DevOrchestrationMenu({
  activeThread,
  activeProject,
  programs,
  threads,
  programNotifications,
  orchestratorWakeItems,
}: {
  activeThread: Thread | undefined;
  activeProject: Project | undefined;
  programs: readonly Program[];
  threads: readonly Thread[];
  programNotifications: readonly ProgramNotification[];
  orchestratorWakeItems: readonly OrchestratorWakeItem[];
}) {
  const [isSending, setIsSending] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const programTargets = useMemo(
    () =>
      resolveDevProgramTargets({
        thread: activeThread,
        project: activeProject,
        programs,
        threads,
      }),
    [activeProject, activeThread, programs, threads],
  );
  const orchestratorTargets = useMemo(
    () =>
      resolveDevOrchestratorTargets({
        thread: activeThread,
        project: activeProject,
        threads,
        programTargets,
      }),
    [activeProject, activeThread, programTargets, threads],
  );

  const relevantProgramIds = useMemo(
    () => new Set(programTargets.map((target) => target.programId)),
    [programTargets],
  );
  const relevantOrchestratorThreadIds = useMemo(
    () => new Set(orchestratorTargets.map((target) => target.orchestratorThreadId)),
    [orchestratorTargets],
  );
  const relevantNotifications = useMemo(
    () =>
      programNotifications
        .filter((notification) => relevantProgramIds.has(notification.programId))
        .toSorted(
          (left, right) =>
            right.queuedAt.localeCompare(left.queuedAt) ||
            right.notificationId.localeCompare(left.notificationId),
        )
        .slice(0, 6),
    [programNotifications, relevantProgramIds],
  );
  const relevantWakeItems = useMemo(
    () =>
      orchestratorWakeItems
        .filter((wakeItem) => relevantOrchestratorThreadIds.has(wakeItem.orchestratorThreadId))
        .toSorted(
          (left, right) =>
            right.queuedAt.localeCompare(left.queuedAt) || right.wakeId.localeCompare(left.wakeId),
        )
        .slice(0, 6),
    [orchestratorWakeItems, relevantOrchestratorThreadIds],
  );

  if (!import.meta.env.DEV || !activeThread) {
    return null;
  }
  if (programTargets.length === 0 && orchestratorTargets.length === 0) {
    return null;
  }

  const api = readNativeApi();

  const runCommand = async (
    description: string,
    command: Parameters<NonNullable<typeof api>["orchestration"]["dispatchCommand"]>[0],
  ) => {
    if (!api) {
      const message = "Native API unavailable.";
      setLastError(message);
      toastManager.add({
        type: "error",
        title: "Dev notification failed",
        description: message,
      });
      return;
    }

    setIsSending(true);
    setLastError(null);
    try {
      await api.orchestration.dispatchCommand(command);
      setLastAction(description);
      toastManager.add({
        type: "success",
        title: "Dev orchestration command sent",
        description,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLastError(message);
      toastManager.add({
        type: "error",
        title: "Dev notification failed",
        description: message,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-b border-dashed border-amber-500/35 bg-amber-500/5 px-3 py-2 sm:px-5">
      <div
        className="mx-auto w-full max-w-3xl rounded-lg border border-amber-500/25 bg-background/80 p-3"
        data-testid="chat-dev-orchestration-menu"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <FlaskConicalIcon className="size-4 text-amber-700 dark:text-amber-300" />
              <span className="text-xs font-semibold text-foreground">
                Dev orchestration notifications
              </span>
              {activeProject?.kind ? (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {activeProject.kind}
                </Badge>
              ) : null}
              <Badge variant="outline" className="h-5 text-[10px]">
                {programTargets.length} program {programTargets.length === 1 ? "target" : "targets"}
              </Badge>
              <Badge variant="outline" className="h-5 text-[10px]">
                {orchestratorTargets.length} wake{" "}
                {orchestratorTargets.length === 1 ? "target" : "targets"}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Uses real orchestration commands. This panel is only shown in dev builds.
            </p>
          </div>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isSending || !api}
                  aria-label="Open dev orchestration menu"
                />
              }
            >
              {isSending ? "Sending..." : "Dev Notify"}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuGroupLabel>Context</MenuGroupLabel>
              <MenuItem disabled>
                {activeProject?.kind ?? "project"} thread: {activeThread.title}
              </MenuItem>
              <MenuItem disabled>Thread ID: {activeThread.id}</MenuItem>
              <MenuItem disabled>Project ID: {activeThread.projectId}</MenuItem>
              {programTargets.length > 0 ? <MenuSeparator /> : null}
              {programTargets.length > 0 ? (
                <>
                  <MenuGroupLabel>Notify Executive</MenuGroupLabel>
                  {programTargets.map((target) => (
                    <MenuSub key={`program:${target.programId}`}>
                      <MenuSubTrigger>
                        {target.programTitle}
                        <span className="ml-2 text-muted-foreground text-xs">
                          {target.programId}
                        </span>
                      </MenuSubTrigger>
                      <MenuSubPopup>
                        <MenuGroupLabel>{target.programTitle}</MenuGroupLabel>
                        <MenuItem disabled>Program ID: {target.programId}</MenuItem>
                        <MenuItem disabled>Executive: {target.executiveThreadId}</MenuItem>
                        <MenuItem disabled>
                          Orchestrator: {target.orchestratorThreadId ?? "none"}
                        </MenuItem>
                        {DEV_PROGRAM_NOTIFICATION_KIND_SECTIONS.map((section) => (
                          <div key={`${target.programId}:${section.id}`}>
                            <MenuSeparator />
                            <MenuGroupLabel>{section.label}</MenuGroupLabel>
                            {section.kinds.map((kind) => (
                              <MenuItem
                                key={`${target.programId}:${kind}`}
                                disabled={isSending || !api}
                                onClick={() =>
                                  void runCommand(
                                    `Sent ${getSidebarProgramNotificationKindLabel(kind)} to ${target.programTitle}.`,
                                    buildDevProgramNotificationCommand({
                                      target,
                                      sourceThread: activeThread,
                                      kind,
                                    }),
                                  )
                                }
                              >
                                {getSidebarProgramNotificationKindLabel(kind)}
                              </MenuItem>
                            ))}
                          </div>
                        ))}
                      </MenuSubPopup>
                    </MenuSub>
                  ))}
                </>
              ) : null}
              {programTargets.length > 0 && orchestratorTargets.length > 0 ? (
                <MenuSeparator />
              ) : null}
              {orchestratorTargets.length > 0 ? (
                <>
                  <MenuGroupLabel>Notify Orchestrator</MenuGroupLabel>
                  {orchestratorTargets.map((target) => (
                    <MenuSub key={`wake:${target.orchestratorThreadId}`}>
                      <MenuSubTrigger>
                        {target.programTitle ?? target.orchestratorThreadId}
                      </MenuSubTrigger>
                      <MenuSubPopup>
                        <MenuGroupLabel>
                          {target.programTitle ?? "Manual wake target"}
                        </MenuGroupLabel>
                        <MenuItem disabled>Orchestrator: {target.orchestratorThreadId}</MenuItem>
                        <MenuItem disabled>Project: {target.orchestratorProjectId}</MenuItem>
                        {target.programId ? (
                          <MenuItem disabled>Program: {target.programId}</MenuItem>
                        ) : null}
                        <MenuSeparator />
                        <MenuGroupLabel>Wake outcome</MenuGroupLabel>
                        {DEV_ORCHESTRATOR_WAKE_OPTIONS.map((option) => (
                          <MenuItem
                            key={`${target.orchestratorThreadId}:${option.outcome}`}
                            disabled={isSending || !api}
                            onClick={() =>
                              void runCommand(
                                `Sent ${option.label.toLowerCase()} wake to ${
                                  target.programTitle ?? target.orchestratorThreadId
                                }.`,
                                buildDevWakeUpsertCommand({
                                  target,
                                  sourceThread: activeThread,
                                  outcome: option.outcome,
                                }),
                              )
                            }
                          >
                            {option.label}
                          </MenuItem>
                        ))}
                      </MenuSubPopup>
                    </MenuSub>
                  ))}
                </>
              ) : null}
            </MenuPopup>
          </Menu>
        </div>

        <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground">
          {programTargets.map((target) => (
            <div
              key={`target:${target.programId}`}
              className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-foreground">
                <span className="font-medium">{target.programTitle}</span>
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                  {target.programId}
                </code>
                <span className="text-[10px] text-muted-foreground">
                  roles: {formatTargetRoles(target)}
                </span>
              </div>
              <div className="mt-1 space-y-0.5 font-mono text-[10px]">
                <div>executive: {target.executiveThreadId}</div>
                <div>executive project: {target.executiveProjectId}</div>
                <div>orchestrator: {target.orchestratorThreadId ?? "none"}</div>
                <div>orchestrator project: {target.orchestratorProjectId ?? "none"}</div>
              </div>
            </div>
          ))}
        </div>

        {lastAction ? (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/8 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
            Last action: {lastAction}
          </div>
        ) : null}
        {lastError ? (
          <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/8 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            Last error: {lastError}
          </div>
        ) : null}

        {(relevantNotifications.length > 0 || relevantWakeItems.length > 0) && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-2">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <BellRingIcon className="size-3.5" />
                Relevant program notifications
              </div>
              {relevantNotifications.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No matching notifications yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {relevantNotifications.map((notification) => (
                    <div
                      key={notification.notificationId}
                      className="rounded border border-border/60 bg-background/60 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground">
                        <span className="font-medium">
                          {getSidebarProgramNotificationKindLabel(notification.kind)}
                        </span>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          {notification.severity}
                        </Badge>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          {notification.state}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {notification.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-2">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ListTodoIcon className="size-3.5" />
                Relevant wake items
              </div>
              {relevantWakeItems.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No matching wake items yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {relevantWakeItems.map((wakeItem) => (
                    <div
                      key={wakeItem.wakeId}
                      className="rounded border border-border/60 bg-background/60 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground">
                        <span className="font-medium">{wakeItem.outcome}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          {formatWakeStateLabel(wakeItem.state)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {wakeItem.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
