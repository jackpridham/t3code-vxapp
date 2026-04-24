import type {
  OrchestrationProject,
  OrchestrationThread,
  StartupThreadTarget,
} from "@t3tools/contracts";

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

export function resolveStartupBootstrapSelection(input: {
  bootstrapProjectId: BootstrapProjectSummary["id"];
  projects: readonly BootstrapProjectSummary[];
  threads: readonly BootstrapThreadSummary[];
  startupThreadTarget: StartupThreadTarget;
}): {
  projectId: BootstrapProjectSummary["id"];
  threadId: BootstrapThreadSummary["id"];
} | null {
  const activeProjects = input.projects.filter((project) => project.deletedAt === null);
  const bootstrapProject =
    activeProjects.find((project) => project.id === input.bootstrapProjectId) ?? null;
  if (!bootstrapProject) {
    return null;
  }

  const targetProject = resolveTargetProject({
    bootstrapProject,
    projects: activeProjects,
    startupThreadTarget: input.startupThreadTarget,
  });
  if (!targetProject) {
    return null;
  }

  const threadId = resolveProjectThreadId({
    project: targetProject,
    threads: input.threads,
  });
  if (!threadId) {
    return null;
  }

  return {
    projectId: targetProject.id,
    threadId,
  };
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

    const archivedCurrentSessionThread = projectThreads.find(
      (thread) => thread.id === input.project.currentSessionRootThreadId,
    );
    if (archivedCurrentSessionThread) {
      return archivedCurrentSessionThread.id;
    }
  }

  const activeThread = projectThreads.find((thread) => thread.archivedAt === null);
  return activeThread?.id ?? projectThreads[0]?.id ?? null;
}
