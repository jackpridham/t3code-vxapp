import type { GitResolveRepoIdentityResult } from "@t3tools/contracts";
import {
  DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER,
  DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER,
  DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE,
  type SidebarWorkerActivityFilter,
  type SidebarWorkerLineageFilter,
  type SidebarWorkerVisibilityScope,
} from "@t3tools/contracts/settings";
import type { Project, Thread } from "../types";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { getDisplayThreadLabelEntries } from "./threadLabels";
import { getWorkerLineageIssues } from "./workerLineage";

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

export interface OrchestrationModeConfiguredProjectBuckets {
  bucketProjectIdByProjectId: Map<Project["id"], Project["id"]>;
  visibleProjectIds: Set<Project["id"]>;
}

interface ProjectNameAlias {
  value: string;
  allowEmbeddedMatch: boolean;
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

type OrchestrationWorkerVisibilityMode = "selected-session" | "project-diagnostic";

type WorkerVisibilityThread = Pick<
  Thread,
  | "id"
  | "spawnRole"
  | "parentThreadId"
  | "spawnedBy"
  | "orchestratorProjectId"
  | "orchestratorThreadId"
  | "workflowId"
  | "session"
  | "latestTurn"
  | "error"
  | "activities"
>;

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveWorkerVisibilityMode(
  visibilityScope: SidebarWorkerVisibilityScope,
): OrchestrationWorkerVisibilityMode {
  return visibilityScope === "all_orchestrators" ? "project-diagnostic" : "selected-session";
}

function getWorkerLineageErrors(input: {
  thread: WorkerVisibilityThread;
  threads: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}) {
  return getWorkerLineageIssues({
    thread: input.thread,
    threads: input.threads,
    ...(input.projects ? { projects: input.projects } : {}),
  }).filter((issue) => issue.severity === "error");
}

function hasWorkerOrchestratorLineageError(input: {
  thread: WorkerVisibilityThread;
  threads: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}): boolean {
  return getWorkerLineageErrors(input).some(
    (issue) => issue.key === "missing-orchestrator-thread-id",
  );
}

function hasPendingWorkerAction(thread: Pick<Thread, "activities">): boolean {
  return (
    derivePendingApprovals(thread.activities).length > 0 ||
    derivePendingUserInputs(thread.activities).length > 0
  );
}

function isActiveWorker(thread: WorkerVisibilityThread): boolean {
  return (
    thread.session?.status === "running" ||
    thread.session?.status === "connecting" ||
    thread.latestTurn?.state === "running"
  );
}

function workerNeedsAttention(input: {
  thread: WorkerVisibilityThread;
  threads: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}): boolean {
  return (
    getWorkerLineageErrors(input).length > 0 ||
    isNonEmptyString(input.thread.error) ||
    input.thread.session?.status === "error" ||
    input.thread.latestTurn?.state === "error" ||
    input.thread.latestTurn?.state === "interrupted" ||
    hasPendingWorkerAction(input.thread)
  );
}

function matchesWorkerLineageFilter(input: {
  thread: WorkerVisibilityThread;
  threads: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
  lineageFilter: SidebarWorkerLineageFilter;
}): boolean {
  if (input.thread.spawnRole !== "worker") {
    return input.lineageFilter !== "only_invalid";
  }

  const hasLineageError = hasWorkerOrchestratorLineageError(input);

  if (input.lineageFilter === "hide_invalid") {
    return !hasLineageError;
  }
  if (input.lineageFilter === "only_invalid") {
    return hasLineageError;
  }
  return true;
}

function matchesWorkerActivityFilter(input: {
  thread: WorkerVisibilityThread;
  threads: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
  activityFilter: SidebarWorkerActivityFilter;
}): boolean {
  if (input.thread.spawnRole !== "worker") {
    return true;
  }

  if (input.activityFilter === "active") {
    return isActiveWorker(input.thread);
  }
  if (input.activityFilter === "needs_attention") {
    return workerNeedsAttention(input);
  }
  return true;
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

function createBadge(label: string): OrchestrationModeRowBadge {
  return {
    key: label,
    label,
  };
}

function hasRepoIdentity(
  value:
    | Pick<
        GitResolveRepoIdentityResult,
        "isRepo" | "commonGitDir" | "worktreeRoot" | "isMainWorktree"
      >
    | null
    | undefined,
): value is Pick<GitResolveRepoIdentityResult, "isRepo" | "worktreeRoot" | "isMainWorktree"> & {
  commonGitDir: string;
} {
  return value?.isRepo === true && isNonEmptyString(value.commonGitDir);
}

export function resolveConfiguredProjectBuckets(input: {
  projects: readonly Pick<Project, "id" | "name" | "cwd" | "sidebarParentProjectId">[];
  repoIdentityByProjectId: ReadonlyMap<
    Project["id"],
    | Pick<
        GitResolveRepoIdentityResult,
        "isRepo" | "commonGitDir" | "worktreeRoot" | "isMainWorktree"
      >
    | null
    | undefined
  >;
}): OrchestrationModeConfiguredProjectBuckets {
  const bucketProjectIdByProjectId = new Map<Project["id"], Project["id"]>();
  const visibleProjectIds = new Set<Project["id"]>();
  const projectsByCommonGitDir = new Map<string, Array<Pick<Project, "id" | "name" | "cwd">>>();

  for (const project of input.projects) {
    bucketProjectIdByProjectId.set(project.id, project.id);
    visibleProjectIds.add(project.id);

    const repoIdentity = input.repoIdentityByProjectId.get(project.id);
    if (!hasRepoIdentity(repoIdentity)) {
      continue;
    }

    const normalizedCommonGitDir = normalizePath(repoIdentity.commonGitDir);
    const family = projectsByCommonGitDir.get(normalizedCommonGitDir) ?? [];
    family.push(project);
    projectsByCommonGitDir.set(normalizedCommonGitDir, family);
  }

  for (const familyProjects of projectsByCommonGitDir.values()) {
    const bucketProject =
      familyProjects.find((project) => {
        const repoIdentity = input.repoIdentityByProjectId.get(project.id);
        if (!hasRepoIdentity(repoIdentity) || !repoIdentity.isMainWorktree) {
          return false;
        }
        const worktreeRoot = repoIdentity.worktreeRoot;
        if (!isNonEmptyString(worktreeRoot)) {
          return false;
        }
        return normalizePath(project.cwd) === normalizePath(worktreeRoot);
      }) ?? null;

    if (!bucketProject) {
      continue;
    }

    for (const project of familyProjects) {
      bucketProjectIdByProjectId.set(project.id, bucketProject.id);
      if (project.id !== bucketProject.id) {
        visibleProjectIds.delete(project.id);
      }
    }
  }

  for (const project of input.projects) {
    if (project.sidebarParentProjectId === undefined || project.sidebarParentProjectId === null) {
      continue;
    }

    if (project.sidebarParentProjectId === project.id) {
      bucketProjectIdByProjectId.set(project.id, project.id);
      visibleProjectIds.add(project.id);
      continue;
    }

    if (
      !input.projects.some(
        (candidateProject) => candidateProject.id === project.sidebarParentProjectId,
      )
    ) {
      continue;
    }

    bucketProjectIdByProjectId.set(project.id, project.sidebarParentProjectId);
    visibleProjectIds.delete(project.id);
  }

  const parentProjectAliases = input.projects
    .map((project) => ({
      projectId: project.id,
      aliases: buildProjectNameAliases(project.name),
    }))
    .filter((entry) => entry.aliases.length > 0)
    .toSorted((left, right) => {
      const leftLongestAlias = Math.max(...left.aliases.map((alias) => alias.value.length));
      const rightLongestAlias = Math.max(...right.aliases.map((alias) => alias.value.length));
      return rightLongestAlias - leftLongestAlias;
    });

  for (const project of input.projects) {
    if (project.sidebarParentProjectId !== undefined && project.sidebarParentProjectId !== null) {
      continue;
    }

    if ((bucketProjectIdByProjectId.get(project.id) ?? project.id) !== project.id) {
      continue;
    }

    const normalizedProjectName = normalizeProjectName(project.name);
    if (normalizedProjectName === null) {
      continue;
    }

    const matchedParent = parentProjectAliases.find(
      (candidate) =>
        candidate.projectId !== project.id &&
        candidate.aliases.some((alias) => projectNameMatchesAlias(normalizedProjectName, alias)),
    );
    if (!matchedParent) {
      continue;
    }

    bucketProjectIdByProjectId.set(project.id, matchedParent.projectId);
    visibleProjectIds.delete(project.id);
  }

  const vortexScriptsProject = input.projects.find(
    (project) =>
      normalizeProjectName(project.name) === "vortex-scripts" ||
      normalizeProjectName(getPathBasename(project.cwd)) === "vortex-scripts",
  );

  if (vortexScriptsProject) {
    for (const project of input.projects) {
      if (project.id === vortexScriptsProject.id) {
        continue;
      }

      if (project.sidebarParentProjectId !== undefined && project.sidebarParentProjectId !== null) {
        continue;
      }

      if ((bucketProjectIdByProjectId.get(project.id) ?? project.id) !== project.id) {
        continue;
      }

      if (!hasProjectNameToken(project, "scripts")) {
        continue;
      }

      bucketProjectIdByProjectId.set(project.id, vortexScriptsProject.id);
      visibleProjectIds.delete(project.id);
    }
  }

  return {
    bucketProjectIdByProjectId,
    visibleProjectIds,
  };
}

function getPathBasename(path: string): string {
  return (
    normalizePath(path)
      .split(/[/\\]+/)
      .at(-1) ?? path
  );
}

function normalizeProjectName(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function hasProjectNameToken(project: Pick<Project, "name" | "cwd">, token: string): boolean {
  const normalizedToken = token.toLowerCase();
  const values = [project.name, getPathBasename(project.cwd)];
  return values.some((value) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((part) => part === normalizedToken),
  );
}

function buildProjectNameAliases(name: string): ProjectNameAlias[] {
  const normalizedName = normalizeProjectName(name);
  if (normalizedName === null) {
    return [];
  }

  const aliases = new Map<string, ProjectNameAlias>();
  aliases.set(normalizedName, {
    value: normalizedName,
    allowEmbeddedMatch: false,
  });
  if (normalizedName.endsWith("-vxapp")) {
    const baseName = normalizedName.slice(0, "-vxapp".length * -1);
    if (baseName.length > 0) {
      aliases.set(baseName, {
        value: baseName,
        allowEmbeddedMatch: true,
      });
    }
  }

  return [...aliases.values()];
}

function projectNameMatchesAlias(normalizedProjectName: string, alias: ProjectNameAlias): boolean {
  if (normalizedProjectName.startsWith(`${alias.value}-`)) {
    return true;
  }

  if (!alias.allowEmbeddedMatch) {
    return false;
  }

  return (
    normalizedProjectName.includes(`-${alias.value}-`) ||
    normalizedProjectName.endsWith(`-${alias.value}`)
  );
}

export function filterProjectThreadsForOrchestrationMode<
  TThread extends WorkerVisibilityThread,
>(input: {
  threads: readonly TThread[];
  selectedSessionRootIds: ReadonlySet<Thread["id"]> | readonly Thread["id"][];
  threadsForResolution: readonly Pick<
    Thread,
    "id" | "parentThreadId" | "spawnRole" | "spawnedBy" | "orchestratorThreadId" | "workflowId"
  >[];
  projects?: readonly Pick<Project, "id">[];
  workerVisibilityScope?: SidebarWorkerVisibilityScope;
  workerLineageFilter?: SidebarWorkerLineageFilter;
  workerActivityFilter?: SidebarWorkerActivityFilter;
}): TThread[] {
  const selectedSessionRootIds =
    input.selectedSessionRootIds instanceof Set
      ? input.selectedSessionRootIds
      : new Set(input.selectedSessionRootIds);
  const visibilityMode = resolveWorkerVisibilityMode(
    input.workerVisibilityScope ?? DEFAULT_SIDEBAR_WORKER_VISIBILITY_SCOPE,
  );
  const lineageFilter = input.workerLineageFilter ?? DEFAULT_SIDEBAR_WORKER_LINEAGE_FILTER;
  const activityFilter = input.workerActivityFilter ?? DEFAULT_SIDEBAR_WORKER_ACTIVITY_FILTER;
  const workerFilterContext = {
    threads: input.threadsForResolution,
    ...(input.projects ? { projects: input.projects } : {}),
  };

  return input.threads.filter((thread) => {
    if (thread.spawnRole === "orchestrator") {
      return false;
    }

    if (
      !matchesWorkerLineageFilter({
        thread,
        ...workerFilterContext,
        lineageFilter,
      }) ||
      !matchesWorkerActivityFilter({
        thread,
        ...workerFilterContext,
        activityFilter,
      })
    ) {
      return false;
    }

    if (visibilityMode === "project-diagnostic") {
      return true;
    }

    if (thread.spawnRole === "worker" && isNonEmptyString(thread.orchestratorThreadId)) {
      return selectedSessionRootIds.has(thread.orchestratorThreadId);
    }

    const sessionRootId = resolveThreadSessionRootId({
      threadId: thread.id,
      threads: input.threadsForResolution,
    });

    if (sessionRootId !== null) {
      return selectedSessionRootIds.has(sessionRootId);
    }

    if (thread.spawnRole === "worker") {
      return false;
    }

    return true;
  });
}

export function resolveThreadSessionRootId(input: {
  threadId: Thread["id"];
  threads: readonly Pick<
    Thread,
    "id" | "parentThreadId" | "spawnRole" | "spawnedBy" | "orchestratorThreadId" | "workflowId"
  >[];
}): Thread["id"] | null {
  const threadsById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const thread = threadsById.get(input.threadId);
  if (!thread) {
    return null;
  }

  if (thread.spawnRole === "orchestrator") {
    return thread.id;
  }

  for (const candidateId of [thread.spawnedBy, thread.orchestratorThreadId]) {
    if (!candidateId) {
      continue;
    }
    const candidateThread = threadsById.get(candidateId as Thread["id"]);
    if (candidateThread?.spawnRole === "orchestrator") {
      return candidateThread.id;
    }
  }

  const visited = new Set<Thread["id"]>([thread.id]);
  let currentParentId = thread.parentThreadId as Thread["id"] | undefined;
  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parentThread = threadsById.get(currentParentId);
    if (!parentThread) {
      break;
    }
    if (parentThread.spawnRole === "orchestrator") {
      return parentThread.id;
    }
    for (const candidateId of [parentThread.spawnedBy, parentThread.orchestratorThreadId]) {
      if (!candidateId) {
        continue;
      }
      const candidateThread = threadsById.get(candidateId as Thread["id"]);
      if (candidateThread?.spawnRole === "orchestrator") {
        return candidateThread.id;
      }
    }
    currentParentId = parentThread.parentThreadId as Thread["id"] | undefined;
  }

  if (!isNonEmptyString(thread.workflowId)) {
    return null;
  }

  const workflowRoot = input.threads.find(
    (candidateThread) =>
      candidateThread.workflowId === thread.workflowId &&
      candidateThread.spawnRole === "orchestrator",
  );
  return workflowRoot?.id ?? null;
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
    | "sessionWorkerThreadCount"
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
          workerThreadCount:
            rootThread.sessionWorkerThreadCount ??
            memberThreadIds.filter((threadId) => threadId !== rootThreadId).length,
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
  projects: readonly Pick<Project, "id" | "name" | "cwd" | "kind" | "sidebarParentProjectId">[];
}): OrchestrationModeProjectBucket {
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const directProject = projectById.get(input.thread.projectId);
  if (directProject) {
    const configuredParentProject =
      directProject.sidebarParentProjectId &&
      directProject.sidebarParentProjectId !== directProject.id
        ? projectById.get(directProject.sidebarParentProjectId)
        : undefined;
    if (configuredParentProject) {
      return {
        canonicalProjectId: configuredParentProject.id,
        canonicalProjectName: configuredParentProject.name,
      };
    }

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
  const normalizedLabels = getDisplayThreadLabelEntries(input.thread.labels, 3).map(
    (label) => label.displayLabel,
  );

  const visibleBadges = normalizedLabels.map(createBadge);
  const hasRoleBadge = input.thread.spawnRole
    ? visibleBadges.some((badge) => badge.label === input.thread.spawnRole)
    : false;
  const hasModelBadge = visibleBadges.some(
    (badge) => badge.label === input.thread.modelSelection.model,
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
