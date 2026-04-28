import {
  type ClientOrchestrationCommand,
  type OrchestrationProgramNotificationKind,
  type OrchestratorWakeOutcome,
  type ProgramId,
  type ProjectId,
  ProgramNotificationId,
  ThreadId,
  type ThreadId as ThreadIdType,
  TurnId,
} from "@t3tools/contracts";
import {
  CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS,
  CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS,
} from "@t3tools/shared/ctoAttention";

import { newCommandId, randomUUID } from "~/lib/utils";
import type { Program, Project, Thread } from "../../types";
import { getSidebarProgramNotificationKindLabel } from "../Sidebar.logic";

export type DevThreadRole = "executive" | "orchestrator" | "worker" | "thread";

export interface DevProgramNotificationSection {
  readonly id: string;
  readonly label: string;
  readonly kinds: readonly OrchestrationProgramNotificationKind[];
}

export interface DevProgramTarget {
  readonly programId: Program["id"];
  readonly programTitle: Program["title"];
  readonly executiveProjectId: Program["executiveProjectId"];
  readonly executiveThreadId: Program["executiveThreadId"];
  readonly orchestratorThreadId: ThreadIdType | null;
  readonly orchestratorProjectId: ProjectId | null;
  readonly roles: readonly DevThreadRole[];
}

export interface DevOrchestratorTarget {
  readonly orchestratorThreadId: ThreadIdType;
  readonly orchestratorProjectId: ProjectId;
  readonly programId: ProgramId | null;
  readonly programTitle: Program["title"] | null;
}

export interface DevOrchestrationTargets {
  readonly programTargets: readonly DevProgramTarget[];
  readonly orchestratorTargets: readonly DevOrchestratorTarget[];
}

export const DEV_PROGRAM_NOTIFICATION_KIND_SECTIONS: readonly DevProgramNotificationSection[] = [
  {
    id: "actionable",
    label: "Notify Executive",
    kinds: CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS,
  },
  {
    id: "milestones",
    label: "Milestones",
    kinds: ["milestone_completed", "closeout_ready"],
  },
  {
    id: "status",
    label: "Status Feed",
    kinds: CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS,
  },
] as const;

export const DEV_ORCHESTRATOR_WAKE_OPTIONS: ReadonlyArray<{
  readonly outcome: OrchestratorWakeOutcome;
  readonly label: string;
}> = [
  { outcome: "completed", label: "Completed" },
  { outcome: "interrupted", label: "Interrupted" },
  { outcome: "failed", label: "Failed" },
] as const;

const DEV_NOTIFICATION_SEVERITY_BY_KIND = {
  decision_required: "warning",
  blocked: "critical",
  milestone_completed: "info",
  closeout_ready: "info",
  risk_escalated: "critical",
  founder_update_required: "warning",
  final_review_ready: "info",
  program_completed: "info",
  worker_started: "info",
  worker_progress: "info",
  worker_completed: "info",
  routine_status: "info",
  test_retry: "warning",
  implementation_progress: "info",
  status_update: "info",
} as const satisfies Record<OrchestrationProgramNotificationKind, "info" | "warning" | "critical">;

function addRole(roles: Set<DevThreadRole>, role: DevThreadRole, enabled: boolean) {
  if (enabled) {
    roles.add(role);
  }
}

function resolveSourceRole(target: DevProgramTarget, sourceThread: Thread): DevThreadRole {
  if (sourceThread.id === target.executiveThreadId) {
    return "executive";
  }
  if (target.orchestratorThreadId !== null && sourceThread.id === target.orchestratorThreadId) {
    return "orchestrator";
  }
  if (sourceThread.spawnRole === "worker") {
    return "worker";
  }
  return "thread";
}

export function resolveDevProgramTargets(input: {
  readonly thread: Thread | undefined;
  readonly project: Project | undefined;
  readonly programs: readonly Program[];
  readonly threads: readonly Thread[];
}): DevProgramTarget[] {
  const thread = input.thread;
  if (!thread) {
    return [];
  }

  const threadById = new Map(input.threads.map((entry) => [entry.id, entry] as const));
  const matchedPrograms = new Map<Program["id"], Program>();

  const addProgramIfPresent = (programId: string | undefined) => {
    if (!programId) {
      return;
    }
    const program = input.programs.find((entry) => entry.id === programId);
    if (program) {
      matchedPrograms.set(program.id, program);
    }
  };

  addProgramIfPresent(thread.programId);

  for (const program of input.programs) {
    if (program.executiveThreadId === thread.id) {
      matchedPrograms.set(program.id, program);
      continue;
    }
    if (program.currentOrchestratorThreadId === thread.id) {
      matchedPrograms.set(program.id, program);
      continue;
    }
    if (thread.executiveThreadId && program.executiveThreadId === thread.executiveThreadId) {
      matchedPrograms.set(program.id, program);
      continue;
    }
    if (
      thread.orchestratorThreadId &&
      program.currentOrchestratorThreadId === thread.orchestratorThreadId
    ) {
      matchedPrograms.set(program.id, program);
    }
  }

  return [...matchedPrograms.values()]
    .map((program) => {
      const roles = new Set<DevThreadRole>();
      addRole(
        roles,
        "executive",
        program.executiveThreadId === thread.id ||
          thread.executiveThreadId === thread.id ||
          input.project?.kind === "executive",
      );
      addRole(
        roles,
        "orchestrator",
        program.currentOrchestratorThreadId === thread.id ||
          thread.orchestratorThreadId === thread.id ||
          input.project?.kind === "orchestrator" ||
          thread.spawnRole === "orchestrator",
      );
      addRole(roles, "worker", thread.spawnRole === "worker");
      if (roles.size === 0) {
        roles.add("thread");
      }

      const orchestratorThreadId =
        program.currentOrchestratorThreadId ??
        (thread.orchestratorThreadId as ThreadIdType | undefined) ??
        (roles.has("orchestrator") ? thread.id : null);
      const normalizedOrchestratorThreadId = orchestratorThreadId as ThreadIdType | null;
      const orchestratorProjectId =
        normalizedOrchestratorThreadId === null
          ? null
          : (threadById.get(normalizedOrchestratorThreadId)?.projectId ??
            (normalizedOrchestratorThreadId === thread.id ? thread.projectId : null));

      return {
        programId: program.id,
        programTitle: program.title,
        executiveProjectId: program.executiveProjectId,
        executiveThreadId: program.executiveThreadId,
        orchestratorThreadId: normalizedOrchestratorThreadId,
        orchestratorProjectId,
        roles: [...roles].toSorted() as DevThreadRole[],
      } satisfies DevProgramTarget;
    })
    .toSorted(
      (left, right) =>
        left.programTitle.localeCompare(right.programTitle) ||
        left.programId.localeCompare(right.programId),
    );
}

export function resolveDevOrchestratorTargets(input: {
  readonly thread: Thread | undefined;
  readonly project: Project | undefined;
  readonly threads: readonly Thread[];
  readonly programTargets: readonly DevProgramTarget[];
}): DevOrchestratorTarget[] {
  const thread = input.thread;
  if (!thread) {
    return [];
  }

  const threadById = new Map(input.threads.map((entry) => [entry.id, entry] as const));
  const targetsById = new Map<Thread["id"], DevOrchestratorTarget>();

  const upsertTarget = (target: DevOrchestratorTarget) => {
    const existing = targetsById.get(target.orchestratorThreadId);
    if (!existing) {
      targetsById.set(target.orchestratorThreadId, target);
      return;
    }
    targetsById.set(target.orchestratorThreadId, {
      orchestratorThreadId: target.orchestratorThreadId,
      orchestratorProjectId: target.orchestratorProjectId,
      programId: existing.programId ?? target.programId,
      programTitle: existing.programTitle ?? target.programTitle,
    });
  };

  for (const target of input.programTargets) {
    if (target.orchestratorThreadId && target.orchestratorProjectId) {
      upsertTarget({
        orchestratorThreadId: target.orchestratorThreadId,
        orchestratorProjectId: target.orchestratorProjectId,
        programId: target.programId,
        programTitle: target.programTitle,
      });
    }
  }

  const threadLinkedOrchestratorProjectId =
    thread.orchestratorThreadId !== undefined
      ? (((thread.orchestratorProjectId as ProjectId | undefined) ??
          threadById.get(thread.orchestratorThreadId as ThreadIdType)?.projectId ??
          (thread.orchestratorThreadId === thread.id
            ? thread.projectId
            : null)) as ProjectId | null)
      : null;
  if (thread.orchestratorThreadId && threadLinkedOrchestratorProjectId) {
    upsertTarget({
      orchestratorThreadId: thread.orchestratorThreadId as ThreadIdType,
      orchestratorProjectId: threadLinkedOrchestratorProjectId,
      programId: (thread.programId as ProgramId | undefined) ?? null,
      programTitle:
        input.programTargets.find((target) => target.programId === thread.programId)
          ?.programTitle ?? null,
    });
  }

  if (input.project?.kind === "orchestrator" || thread.spawnRole === "orchestrator") {
    upsertTarget({
      orchestratorThreadId: thread.id,
      orchestratorProjectId: thread.projectId,
      programId: (thread.programId as ProgramId | undefined) ?? null,
      programTitle:
        input.programTargets.find((target) => target.programId === thread.programId)
          ?.programTitle ?? null,
    });
  }

  return [...targetsById.values()].toSorted(
    (left, right) =>
      String(left.programTitle ?? "").localeCompare(String(right.programTitle ?? "")) ||
      left.orchestratorThreadId.localeCompare(right.orchestratorThreadId),
  );
}

export function resolveDevOrchestrationTargets(input: {
  readonly thread: Thread | undefined;
  readonly project: Project | undefined;
  readonly programs: readonly Program[];
  readonly threads: readonly Thread[];
}): DevOrchestrationTargets {
  const programTargets = resolveDevProgramTargets(input);
  return {
    programTargets,
    orchestratorTargets: resolveDevOrchestratorTargets({
      thread: input.thread,
      project: input.project,
      threads: input.threads,
      programTargets,
    }),
  };
}

export function buildDevProgramNotificationCommand(input: {
  readonly target: DevProgramTarget;
  readonly sourceThread: Thread;
  readonly kind: OrchestrationProgramNotificationKind;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { type: "program.notification.upsert" }> {
  const createdAt = input.now ?? new Date().toISOString();
  const label = getSidebarProgramNotificationKindLabel(input.kind);
  return {
    type: "program.notification.upsert",
    commandId: newCommandId(),
    notificationId: ProgramNotificationId.makeUnsafe(
      `dev-notification:${input.kind}:${randomUUID()}`,
    ),
    programId: input.target.programId,
    executiveProjectId: input.target.executiveProjectId,
    executiveThreadId: input.target.executiveThreadId,
    orchestratorThreadId: input.target.orchestratorThreadId,
    kind: input.kind,
    severity: DEV_NOTIFICATION_SEVERITY_BY_KIND[input.kind],
    summary: `[DEV] ${label} from ${input.sourceThread.title}`,
    evidence: {
      devMenu: true,
      sourceThreadId: input.sourceThread.id,
      sourceRole: resolveSourceRole(input.target, input.sourceThread),
      threadId: input.sourceThread.id,
      projectId: input.sourceThread.projectId,
      programId: input.target.programId,
      orchestratorThreadId: input.target.orchestratorThreadId,
      workflowId: input.sourceThread.workflowId ?? null,
    },
    queuedAt: createdAt,
    createdAt,
  };
}

export function buildDevWakeUpsertCommand(input: {
  readonly target: DevOrchestratorTarget;
  readonly sourceThread: Thread;
  readonly outcome: OrchestratorWakeOutcome;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { type: "thread.orchestrator-wake.upsert" }> {
  const createdAt = input.now ?? new Date().toISOString();
  const useSyntheticWorker = input.sourceThread.id === input.target.orchestratorThreadId;
  const workerThreadId = useSyntheticWorker
    ? ThreadId.makeUnsafe(`dev-worker:${randomUUID()}`)
    : input.sourceThread.id;
  return {
    type: "thread.orchestrator-wake.upsert",
    commandId: newCommandId(),
    threadId: input.target.orchestratorThreadId,
    wakeItem: {
      wakeId: `dev-wake:${input.target.orchestratorThreadId}:${input.outcome}:${randomUUID()}`,
      orchestratorThreadId: input.target.orchestratorThreadId,
      orchestratorProjectId: input.target.orchestratorProjectId,
      workerThreadId,
      workerProjectId: input.sourceThread.projectId,
      workerTurnId:
        input.sourceThread.latestTurn?.turnId ??
        TurnId.makeUnsafe(`dev-turn:${input.outcome}:${randomUUID()}`),
      workflowId: input.sourceThread.workflowId,
      workerTitleSnapshot: useSyntheticWorker
        ? `[DEV] ${input.sourceThread.title}`
        : input.sourceThread.title,
      outcome: input.outcome,
      summary: `[DEV] ${input.outcome} wake from ${input.sourceThread.title}`,
      queuedAt: createdAt,
      state: "pending",
      deliveredAt: null,
      consumedAt: null,
    },
    createdAt,
  };
}
