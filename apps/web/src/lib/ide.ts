import type { ThreadId } from "@t3tools/contracts";
import { collapseThreadToCanonicalProject, resolveThreadSessionRootId } from "./orchestrationMode";
import type { Project, Thread } from "../types";
import type { ChangesSectionKind } from "../changesDiscovery";

export const IDE_EXPLORER_SECTIONS = ["changes", "explorer", "threads"] as const;
export type IdeExplorerSection = (typeof IDE_EXPLORER_SECTIONS)[number];

export const IDE_DEFAULT_EXPLORER_SECTIONS: readonly IdeExplorerSection[] = ["changes"];

export interface IdeSelectedFile {
  absolutePath: string;
  relativePath: string;
  displayPath: string;
  fileName: string;
  source: "changes" | "explorer";
  section: ChangesSectionKind | "explorer";
  threadId: ThreadId | null;
  worktreePath: string | null;
  sourcePath: string | null;
  latestCheckpointTurnCount: number | null;
}

export interface IdeExplorerRoot {
  cwd: string | null;
  projectId: Project["id"] | null;
  projectName: string | null;
}

export function isMarkdownPath(pathValue: string | null | undefined): boolean {
  return Boolean(pathValue && /\.mdx?$/i.test(pathValue));
}

type IdeProjectThread = Pick<
  Thread,
  | "archivedAt"
  | "createdAt"
  | "executiveProjectId"
  | "executiveThreadId"
  | "id"
  | "labels"
  | "modelSelection"
  | "orchestratorProjectId"
  | "orchestratorThreadId"
  | "parentThreadId"
  | "projectId"
  | "session"
  | "spawnRole"
  | "spawnedBy"
  | "title"
  | "updatedAt"
  | "worktreePath"
  | "workflowId"
>;

type IdeProject = Pick<
  Project,
  "cwd" | "currentSessionRootThreadId" | "id" | "kind" | "name" | "sidebarParentProjectId"
>;

type IdePrimaryDrawerThreadKind = "executive" | "orchestrator";

function compareThreadsByRecency(left: IdeProjectThread, right: IdeProjectThread): number {
  const leftAt = Date.parse(left.updatedAt ?? left.createdAt);
  const rightAt = Date.parse(right.updatedAt ?? right.createdAt);
  return rightAt - leftAt;
}

function resolveLatestThreadId(threads: readonly IdeProjectThread[]): Thread["id"] | null {
  return threads.toSorted(compareThreadsByRecency)[0]?.id ?? null;
}

function resolveLatestProjectThreadId(input: {
  projectId: Thread["projectId"] | null | undefined;
  preferredThreadId?: Thread["id"] | null | undefined;
  threads: readonly IdeProjectThread[];
  preferredSpawnRole?: Thread["spawnRole"] | undefined;
}): Thread["id"] | null {
  if (!input.projectId) {
    return null;
  }

  const projectThreads = input.threads.filter(
    (thread) => thread.archivedAt === null && thread.projectId === input.projectId,
  );
  if (projectThreads.length === 0) {
    return null;
  }

  if (
    input.preferredThreadId &&
    projectThreads.some((thread) => thread.id === input.preferredThreadId)
  ) {
    return input.preferredThreadId;
  }

  if (input.preferredSpawnRole) {
    const preferredThreads = projectThreads.filter(
      (thread) => thread.spawnRole === input.preferredSpawnRole,
    );
    const preferredThreadId = resolveLatestThreadId(preferredThreads);
    if (preferredThreadId) {
      return preferredThreadId;
    }
  }

  return resolveLatestThreadId(projectThreads);
}

function resolveScopedSpecialProject(input: {
  activeThread: IdeProjectThread;
  kind: IdePrimaryDrawerThreadKind;
  projects: readonly IdeProject[];
}): IdeProject | null {
  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const explicitProjectId =
    input.kind === "executive"
      ? input.activeThread.executiveProjectId
      : input.activeThread.orchestratorProjectId;
  if (explicitProjectId) {
    const explicitProject = projectById.get(explicitProjectId as Project["id"]);
    if (explicitProject) {
      return explicitProject;
    }
  }

  const activeCanonicalProjectId = collapseThreadToCanonicalProject({
    thread: input.activeThread,
    projects: input.projects,
  }).canonicalProjectId;
  const activeProject =
    projectById.get(input.activeThread.projectId) ??
    projectById.get(activeCanonicalProjectId) ??
    null;
  if (activeProject?.kind === input.kind) {
    return activeProject;
  }

  return (
    input.projects.find(
      (project) =>
        project.kind === input.kind && project.sidebarParentProjectId === activeCanonicalProjectId,
    ) ?? null
  );
}

function resolveSpecialProjectThreadId(input: {
  activeThread: IdeProjectThread;
  kind: IdePrimaryDrawerThreadKind;
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
  preferredSpawnRole?: Thread["spawnRole"] | undefined;
}): Thread["id"] | null {
  const specialProject = resolveScopedSpecialProject({
    activeThread: input.activeThread,
    kind: input.kind,
    projects: input.projects,
  });
  if (!specialProject) {
    return null;
  }

  return resolveLatestProjectThreadId({
    projectId: specialProject.id,
    preferredThreadId: specialProject.currentSessionRootThreadId ?? null,
    preferredSpawnRole: input.preferredSpawnRole,
    threads: input.threads,
  });
}

function resolveParentOrchestratorThreadId(input: {
  activeThread: IdeProjectThread;
  threads: readonly IdeProjectThread[];
}): Thread["id"] | null {
  if (!input.activeThread.parentThreadId) {
    return null;
  }

  const parentThread = input.threads.find(
    (thread) => thread.id === input.activeThread.parentThreadId,
  );
  return parentThread?.spawnRole === "orchestrator" ? parentThread.id : null;
}

function resolveProjectSessionRootThreadId(input: {
  activeThread: IdeProjectThread;
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
}): Thread["id"] | null {
  const activeProject = input.projects.find(
    (project) => project.id === input.activeThread.projectId,
  );
  if (!activeProject?.currentSessionRootThreadId) {
    return null;
  }

  const selectedRootThread = input.threads.find(
    (thread) =>
      thread.archivedAt === null && thread.id === activeProject.currentSessionRootThreadId,
  );
  return selectedRootThread?.spawnRole === "orchestrator" ? selectedRootThread.id : null;
}

function resolveCanonicalProjectOrchestratorThreadId(input: {
  activeThread: IdeProjectThread;
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
}): Thread["id"] | null {
  const activeCanonicalProjectId = collapseThreadToCanonicalProject({
    thread: input.activeThread,
    projects: input.projects,
  }).canonicalProjectId;

  const canonicalProject = input.projects.find(
    (project) => project.id === activeCanonicalProjectId,
  );
  if (!canonicalProject?.currentSessionRootThreadId) {
    return null;
  }

  const canonicalRootThread = input.threads.find(
    (project) =>
      project.archivedAt === null && project.id === canonicalProject.currentSessionRootThreadId,
  );
  if (canonicalRootThread?.spawnRole === "orchestrator") {
    return canonicalRootThread.id;
  }

  return null;
}

export function collectIdeDrawerThreads(input: {
  activeThreadId: Thread["id"];
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
}): IdeProjectThread[] {
  const activeThread = input.threads.find((thread) => thread.id === input.activeThreadId);
  if (!activeThread) {
    return [];
  }

  const activeCanonicalProjectId = collapseThreadToCanonicalProject({
    thread: activeThread,
    projects: input.projects,
  }).canonicalProjectId;
  const includedProjectIds = new Set<Project["id"]>();
  for (const kind of ["executive", "orchestrator"] as const) {
    const specialProject = resolveScopedSpecialProject({
      activeThread,
      kind,
      projects: input.projects,
    });
    if (specialProject) {
      includedProjectIds.add(specialProject.id);
    }
  }

  return input.threads
    .filter((thread) => thread.archivedAt === null)
    .filter(
      (thread) =>
        includedProjectIds.has(thread.projectId) ||
        collapseThreadToCanonicalProject({ thread, projects: input.projects })
          .canonicalProjectId === activeCanonicalProjectId,
    )
    .toSorted(compareThreadsByRecency);
}

export function resolveIdeExplorerRoot(input: {
  activeThreadId: Thread["id"];
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
}): IdeExplorerRoot {
  const activeThread = input.threads.find((thread) => thread.id === input.activeThreadId);
  if (!activeThread) {
    return {
      cwd: null,
      projectId: null,
      projectName: null,
    };
  }

  const projectById = new Map(input.projects.map((project) => [project.id, project] as const));
  const activeProject = projectById.get(activeThread.projectId) ?? null;
  const canonicalProjectId = collapseThreadToCanonicalProject({
    thread: activeThread,
    projects: input.projects,
  }).canonicalProjectId;
  const canonicalProject = projectById.get(canonicalProjectId) ?? null;

  if (canonicalProject?.cwd) {
    return {
      cwd: canonicalProject.cwd,
      projectId: canonicalProject.id,
      projectName: canonicalProject.name,
    };
  }

  if (activeProject?.cwd) {
    return {
      cwd: activeProject.cwd,
      projectId: activeProject.id,
      projectName: activeProject.name,
    };
  }

  return {
    cwd: activeThread.worktreePath ?? null,
    projectId: activeProject?.id ?? null,
    projectName: activeProject?.name ?? null,
  };
}

export function resolveIdeDrawerPrimaryThreadId(input: {
  activeThreadId: Thread["id"];
  kind: IdePrimaryDrawerThreadKind;
  projects: readonly IdeProject[];
  threads: readonly IdeProjectThread[];
}): Thread["id"] | null {
  const activeThread = input.threads.find((thread) => thread.id === input.activeThreadId);
  if (!activeThread) {
    return null;
  }

  if (input.kind === "executive") {
    if (
      activeThread.executiveThreadId &&
      input.threads.some((thread) => thread.id === activeThread.executiveThreadId)
    ) {
      return activeThread.executiveThreadId as Thread["id"];
    }

    if (
      activeThread.executiveProjectId &&
      activeThread.projectId === activeThread.executiveProjectId
    ) {
      return activeThread.id;
    }

    return resolveSpecialProjectThreadId({
      activeThread,
      kind: "executive",
      projects: input.projects,
      threads: input.threads,
    });
  }

  if (activeThread.spawnRole === "orchestrator") {
    return activeThread.id;
  }

  if (
    activeThread.orchestratorThreadId &&
    input.threads.some((thread) => thread.id === activeThread.orchestratorThreadId)
  ) {
    return activeThread.orchestratorThreadId as Thread["id"];
  }

  const parentOrchestratorThreadId = resolveParentOrchestratorThreadId({
    activeThread,
    threads: input.threads,
  });
  if (parentOrchestratorThreadId) {
    return parentOrchestratorThreadId;
  }

  if (
    activeThread.orchestratorProjectId &&
    activeThread.projectId === activeThread.orchestratorProjectId
  ) {
    return activeThread.id;
  }

  const projectThreadId = resolveSpecialProjectThreadId({
    activeThread,
    kind: "orchestrator",
    projects: input.projects,
    threads: input.threads,
    preferredSpawnRole: "orchestrator",
  });
  if (projectThreadId) {
    return projectThreadId;
  }

  const activeProjectSessionRootThreadId = resolveProjectSessionRootThreadId({
    activeThread,
    projects: input.projects,
    threads: input.threads,
  });
  if (activeProjectSessionRootThreadId) {
    return activeProjectSessionRootThreadId;
  }

  const canonicalProjectOrchestratorThreadId = resolveCanonicalProjectOrchestratorThreadId({
    activeThread,
    projects: input.projects,
    threads: input.threads,
  });
  if (canonicalProjectOrchestratorThreadId) {
    return canonicalProjectOrchestratorThreadId;
  }

  const sessionRootId = resolveThreadSessionRootId({
    threadId: activeThread.id,
    threads: input.threads,
  });
  if (sessionRootId) {
    return sessionRootId;
  }

  return (
    collectIdeDrawerThreads({
      activeThreadId: activeThread.id,
      projects: input.projects,
      threads: input.threads,
    }).find((thread) => thread.spawnRole === "orchestrator")?.id ?? null
  );
}
