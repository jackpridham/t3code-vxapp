import type { Project, Thread } from "../types";

export interface OrchestrationSessionRoot {
  rootThreadId: Thread["id"];
  rootProjectId: Thread["projectId"];
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface OrchestrationModeSessionCatalogEntry extends OrchestrationSessionRoot {
  memberThreadIds: Thread["id"][];
  workerThreadCount: number;
}

export interface OrchestrationModeThreadMember {
  threadId: Thread["id"];
  rootThreadId: Thread["id"];
  projectId: Thread["projectId"];
}

export interface OrchestrationModeProjectBucket {
  canonicalProjectId: Project["id"];
  canonicalProjectName: string;
}

export interface OrchestrationModeRowBadge {
  key: string;
  label: string;
}

export interface OrchestrationModeRowDescriptor {
  threadId: Thread["id"];
  accessibleTitle: string;
  visibleBadges: OrchestrationModeRowBadge[];
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function trimLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function pathStartsWith(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPrefix = normalizePath(prefix);
  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}/`) ||
    normalizedPath.startsWith(`${normalizedPrefix}\\`)
  );
}

function collectUniqueLabels(
  labels: readonly string[] | null | undefined,
  maxLabels: number,
): string[] {
  const resolvedLabels: string[] = [];
  const seenLabels = new Set<string>();

  for (const label of labels ?? []) {
    const trimmedLabel = trimLabel(label);
    if (trimmedLabel === null || seenLabels.has(trimmedLabel)) {
      continue;
    }
    seenLabels.add(trimmedLabel);
    resolvedLabels.push(trimmedLabel);
    if (resolvedLabels.length >= maxLabels) {
      break;
    }
  }

  return resolvedLabels;
}

function createBadge(label: string): OrchestrationModeRowBadge {
  return {
    key: label,
    label,
  };
}

function collectFallbackRootIds(
  threadsById: ReadonlyMap<Thread["id"], Pick<Thread, "id" | "spawnRole">>,
  threads: readonly Pick<Thread, "spawnedBy" | "orchestratorThreadId" | "parentThreadId">[],
): Set<Thread["id"]> {
  const rootIds = new Set<Thread["id"]>();

  for (const thread of threads) {
    for (const candidateId of [thread.spawnedBy, thread.orchestratorThreadId]) {
      if (!candidateId) {
        continue;
      }
      const candidateThread = threadsById.get(candidateId as Thread["id"]);
      if (!candidateThread || candidateThread.spawnRole === "worker") {
        continue;
      }
      rootIds.add(candidateThread.id);
    }
  }

  if (rootIds.size > 0) {
    return rootIds;
  }

  for (const thread of threads) {
    if (!thread.parentThreadId) {
      continue;
    }
    const candidateThread = threadsById.get(thread.parentThreadId as Thread["id"]);
    if (!candidateThread || candidateThread.spawnRole === "worker") {
      continue;
    }
    rootIds.add(candidateThread.id);
  }

  return rootIds;
}

export function collectSessionThreadIds(input: {
  rootThreadId: Thread["id"];
  threads: readonly Pick<
    Thread,
    | "id"
    | "projectId"
    | "spawnRole"
    | "spawnedBy"
    | "parentThreadId"
    | "orchestratorThreadId"
    | "workflowId"
  >[];
}): ReadonlySet<Thread["id"]> {
  const includedThreadIds = new Set<Thread["id"]>([input.rootThreadId]);
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const rootThread = threadsById.get(input.rootThreadId);
  const rootWorkflowId = rootThread?.workflowId;

  let changed = true;
  while (changed) {
    changed = false;

    for (const thread of input.threads) {
      if (includedThreadIds.has(thread.id)) {
        continue;
      }

      const hasDirectRootLink =
        thread.spawnedBy === input.rootThreadId ||
        thread.orchestratorThreadId === input.rootThreadId;
      const hasParentLink =
        thread.parentThreadId !== undefined &&
        includedThreadIds.has(thread.parentThreadId as Thread["id"]);
      const hasWorkflowFallback =
        isNonEmptyString(rootWorkflowId) &&
        thread.workflowId === rootWorkflowId &&
        thread.spawnRole !== "orchestrator";

      if (hasDirectRootLink || hasParentLink || hasWorkflowFallback) {
        includedThreadIds.add(thread.id);
        changed = true;
      }
    }
  }

  return includedThreadIds;
}

export function buildOrchestrationSessionCatalog(input: {
  threads: readonly Pick<
    Thread,
    | "id"
    | "projectId"
    | "title"
    | "createdAt"
    | "updatedAt"
    | "archivedAt"
    | "session"
    | "spawnRole"
    | "spawnedBy"
    | "parentThreadId"
    | "orchestratorThreadId"
    | "workflowId"
  >[];
}): OrchestrationModeSessionCatalogEntry[] {
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const explicitRootIds = input.threads
    .filter((thread) => thread.spawnRole === "orchestrator")
    .map((thread) => thread.id);
  const fallbackRootIds = collectFallbackRootIds(threadsById, input.threads);
  const rootIds = new Set<Thread["id"]>([...explicitRootIds, ...fallbackRootIds]);

  return [...rootIds]
    .flatMap((rootThreadId) => {
      const rootThread = threadsById.get(rootThreadId);
      if (!rootThread) {
        return [];
      }

      const memberThreadIds = [
        ...collectSessionThreadIds({ rootThreadId, threads: input.threads }),
      ];
      return [
        {
          rootThreadId,
          rootProjectId: rootThread.projectId,
          title: rootThread.title,
          createdAt: rootThread.createdAt,
          updatedAt: rootThread.updatedAt ?? rootThread.createdAt,
          archivedAt: rootThread.archivedAt,
          memberThreadIds,
          workerThreadCount: memberThreadIds.filter((threadId) => threadId !== rootThreadId).length,
        } satisfies OrchestrationModeSessionCatalogEntry,
      ];
    })
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt),
    );
}

export function collapseThreadToCanonicalProject(input: {
  thread: Pick<Thread, "projectId" | "worktreePath" | "orchestratorProjectId">;
  projects: readonly Pick<Project, "id" | "name" | "cwd" | "kind">[];
}): OrchestrationModeProjectBucket {
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const directProject = projectById.get(input.thread.projectId);
  if (directProject) {
    return {
      canonicalProjectId: directProject.id,
      canonicalProjectName: directProject.name,
    };
  }

  const orchestratorProject = input.thread.orchestratorProjectId
    ? projectById.get(input.thread.orchestratorProjectId as Project["id"])
    : undefined;
  const canFallbackToOrchestratorProject =
    orchestratorProject !== undefined &&
    isNonEmptyString(input.thread.worktreePath) &&
    pathStartsWith(input.thread.worktreePath, orchestratorProject.cwd);

  if (canFallbackToOrchestratorProject && orchestratorProject) {
    return {
      canonicalProjectId: orchestratorProject.id,
      canonicalProjectName: orchestratorProject.name,
    };
  }

  return {
    canonicalProjectId: input.thread.projectId,
    canonicalProjectName: input.thread.projectId,
  };
}

export function buildOrchestrationModeRowDescriptor(input: {
  thread: Pick<Thread, "id" | "title" | "labels" | "spawnRole" | "modelSelection">;
}): OrchestrationModeRowDescriptor {
  const visibleBadges = collectUniqueLabels(input.thread.labels, 3).map(createBadge);
  const hasRoleBadge = input.thread.spawnRole
    ? visibleBadges.some((badge) => badge.label === input.thread.spawnRole)
    : false;
  const hasModelBadge = visibleBadges.some(
    (badge) =>
      badge.label === input.thread.modelSelection.model ||
      badge.label === `model:${input.thread.modelSelection.model}`,
  );

  if (input.thread.spawnRole && !hasRoleBadge && visibleBadges.length === 0) {
    visibleBadges.push(createBadge(input.thread.spawnRole));
  }

  if (!hasModelBadge) {
    visibleBadges.push(createBadge(input.thread.modelSelection.model));
  }

  if (visibleBadges.length === 0) {
    visibleBadges.push(createBadge("thread"));
  }

  return {
    threadId: input.thread.id,
    accessibleTitle: input.thread.title,
    visibleBadges,
  };
}
