import type {
  OrchestrationProgram,
  OrchestrationProject,
  OrchestrationThread,
  StartupThreadTarget,
} from "@t3tools/contracts";

export const STARTUP_AUTHORITY_DISAGREEMENT_HINT =
  "Refresh agents-vxapp owner authority and rerun T3Code startup; do not use local bootstrap root as active CTO authority.";

const ACTIVE_PROGRAM_STATUSES = new Set(["active", "in_progress", "running", "open"]);

export interface StartupAuthorityDiagnostic {
  readonly activeOwnerThreadId: OrchestrationThread["id"];
  readonly localBootstrapThreadId: OrchestrationThread["id"] | null;
  readonly authoritySource: "agents-vxapp-owner";
  readonly startupContract: "external-role-authority-snapshot";
  readonly hint: typeof STARTUP_AUTHORITY_DISAGREEMENT_HINT;
}

export interface StartupBootstrapSelection {
  readonly projectId: BootstrapProjectSummary["id"];
  readonly threadId: BootstrapThreadSummary["id"];
  readonly authoritySource: "agents-vxapp-owner";
  readonly startupContract: "external-role-authority-snapshot";
  readonly diagnostic?: StartupAuthorityDiagnostic;
}

type BootstrapProjectSummary = Pick<
  OrchestrationProject,
  | "currentSessionRootThreadId"
  | "deletedAt"
  | "id"
  | "kind"
  | "sidebarParentProjectId"
  | "updatedAt"
>;

type BootstrapThreadSummary = Pick<
  OrchestrationThread,
  "archivedAt" | "deletedAt" | "id" | "projectId"
>;

type BootstrapProgramSummary = Pick<
  OrchestrationProgram,
  | "completedAt"
  | "currentOrchestratorThreadId"
  | "deletedAt"
  | "executiveThreadId"
  | "status"
  | "updatedAt"
>;

export function resolveStartupBootstrapSelection(input: {
  bootstrapProjectId: BootstrapProjectSummary["id"];
  projects: readonly BootstrapProjectSummary[];
  threads: readonly BootstrapThreadSummary[];
  startupThreadTarget: StartupThreadTarget;
}): {
  projectId: BootstrapProjectSummary["id"];
  threadId: BootstrapThreadSummary["id"];
} | null {
  const result = resolveStartupBootstrapSelectionDetail(input)?.selection ?? null;
  return result ? { projectId: result.projectId, threadId: result.threadId } : null;
}

export function resolveStartupBootstrapSelectionDetail(input: {
  bootstrapProjectId: BootstrapProjectSummary["id"];
  programs?: readonly BootstrapProgramSummary[] | undefined;
  projects: readonly BootstrapProjectSummary[];
  threads: readonly BootstrapThreadSummary[];
  startupThreadTarget: StartupThreadTarget;
}): {
  readonly selection: StartupBootstrapSelection;
} | null {
  const activeProjects = input.projects.filter((project) => project.deletedAt === null);
  const bootstrapProject =
    activeProjects.find((project) => project.id === input.bootstrapProjectId) ?? null;
  const targetProject = bootstrapProject
    ? resolveTargetProject({
        bootstrapProject,
        projects: activeProjects,
        startupThreadTarget: input.startupThreadTarget,
      })
    : null;
  const localBootstrapThreadId = targetProject
    ? resolveProjectThreadId({
        project: targetProject,
        threads: input.threads,
      })
    : null;
  const ownerThreadId = resolveOwnerThreadId({
    programs: input.programs ?? [],
    startupThreadTarget: input.startupThreadTarget,
  });
  if (ownerThreadId) {
    const ownerThread = input.threads.find(
      (thread) =>
        thread.id === ownerThreadId && thread.archivedAt === null && thread.deletedAt === null,
    );
    if (ownerThread) {
      const diagnostic =
        localBootstrapThreadId && localBootstrapThreadId !== ownerThread.id
          ? makeOwnerDisagreementDiagnostic({
              activeOwnerThreadId: ownerThread.id,
              localBootstrapThreadId,
              startupContract: "external-role-authority-snapshot",
            })
          : undefined;
      return {
        selection: {
          projectId: ownerThread.projectId,
          threadId: ownerThread.id,
          authoritySource: "agents-vxapp-owner",
          startupContract: "external-role-authority-snapshot",
          ...(diagnostic ? { diagnostic } : {}),
        },
      };
    }
    return null;
  }

  return null;
}

function makeOwnerDisagreementDiagnostic(input: {
  activeOwnerThreadId: OrchestrationThread["id"];
  localBootstrapThreadId: OrchestrationThread["id"] | null;
  startupContract: StartupAuthorityDiagnostic["startupContract"];
}): StartupAuthorityDiagnostic {
  return {
    activeOwnerThreadId: input.activeOwnerThreadId,
    localBootstrapThreadId: input.localBootstrapThreadId,
    authoritySource: "agents-vxapp-owner",
    startupContract: input.startupContract,
    hint: STARTUP_AUTHORITY_DISAGREEMENT_HINT,
  };
}

function resolveOwnerThreadId(input: {
  programs: readonly BootstrapProgramSummary[];
  startupThreadTarget: StartupThreadTarget;
}): OrchestrationThread["id"] | null {
  const candidates = input.programs
    .filter((program) => program.deletedAt === null && program.completedAt === null)
    .filter((program) => ACTIVE_PROGRAM_STATUSES.has(String(program.status).toLowerCase()))
    .map((program) => {
      const threadId =
        input.startupThreadTarget === "orchestrator"
          ? program.currentOrchestratorThreadId
          : program.executiveThreadId;
      return { threadId, updatedAt: program.updatedAt };
    })
    .filter((candidate): candidate is { threadId: OrchestrationThread["id"]; updatedAt: string } =>
      Boolean(candidate.threadId),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return candidates[0]?.threadId ?? null;
}

function resolveTargetProject(input: {
  bootstrapProject: BootstrapProjectSummary;
  projects: readonly BootstrapProjectSummary[];
  startupThreadTarget: StartupThreadTarget;
}): BootstrapProjectSummary | null {
  if (input.bootstrapProject.kind === input.startupThreadTarget) {
    return input.bootstrapProject;
  }

  const linkedProject =
    input.projects.find(
      (project) =>
        project.kind === input.startupThreadTarget &&
        project.sidebarParentProjectId === input.bootstrapProject.id,
    ) ?? null;
  if (linkedProject) {
    return linkedProject;
  }

  const globalCandidates = input.projects.filter(
    (project) => project.kind === input.startupThreadTarget,
  );
  if (globalCandidates.length === 0) {
    return null;
  }

  return globalCandidates.toSorted(compareSpecialProjects)[0] ?? null;
}

function compareSpecialProjects(
  left: BootstrapProjectSummary,
  right: BootstrapProjectSummary,
): number {
  const leftHasCurrentSession = left.currentSessionRootThreadId ? 1 : 0;
  const rightHasCurrentSession = right.currentSessionRootThreadId ? 1 : 0;
  if (leftHasCurrentSession !== rightHasCurrentSession) {
    return rightHasCurrentSession - leftHasCurrentSession;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }

  return right.id.localeCompare(left.id);
}

function resolveProjectThreadId(input: {
  project: BootstrapProjectSummary;
  threads: readonly BootstrapThreadSummary[];
}): BootstrapThreadSummary["id"] | null {
  const projectThreads = input.threads.filter(
    (thread) => thread.projectId === input.project.id && thread.deletedAt === null,
  );
  if (projectThreads.length === 0) {
    return null;
  }

  if (input.project.currentSessionRootThreadId) {
    const currentSessionThread = projectThreads.find(
      (thread) =>
        thread.id === input.project.currentSessionRootThreadId && thread.archivedAt === null,
    );
    if (currentSessionThread) {
      return currentSessionThread.id;
    }
  }

  const activeThread = projectThreads.find((thread) => thread.archivedAt === null);
  return activeThread?.id ?? null;
}
