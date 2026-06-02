import type {
  OrchestrationProject,
  OrchestrationProjectKind,
  OrchestrationThreadSummary,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export interface AgentsVxappExternalRoleAuthoritySnapshot {
  readonly projects: readonly OrchestrationProject[];
  readonly threadSummaries: readonly OrchestrationThreadSummary[];
}

type AgentsVxappExternalRoleAuthorityProjectInput = Omit<OrchestrationProject, "kind"> & {
  readonly kind?: OrchestrationProjectKind | "workspace" | undefined;
};

interface AgentsVxappExternalRoleAuthoritySnapshotInput {
  readonly projects: readonly AgentsVxappExternalRoleAuthorityProjectInput[];
  readonly threadSummaries: readonly OrchestrationThreadSummary[];
}

export interface AgentsVxappRoleSessionRuntimePathsRoleEntry {
  readonly role: "cto" | "jasper";
  readonly generatedWorkspaceRoot: string;
  readonly stateRoot: string;
  readonly sessionsRoot: string;
  readonly reservationsRoot: string;
}

export interface AgentsVxappRoleSessionRuntimePaths {
  readonly runtimeRoot: string;
  readonly roleSessionsRoot: string;
  readonly roleStateRoot: string;
  readonly workspaceRuntimeMetadataDir: string;
  readonly env: {
    readonly runtimeRoot: string;
    readonly stateRoot: string;
  };
  readonly roles: {
    readonly cto: AgentsVxappRoleSessionRuntimePathsRoleEntry;
    readonly jasper: AgentsVxappRoleSessionRuntimePathsRoleEntry;
  };
}

export interface AgentsVxappExternalRoleAuthorityIndex {
  readonly projectIds: ReadonlySet<ProjectId>;
  readonly threadIds: ReadonlySet<ThreadId>;
  readonly workspaceRoots: ReadonlySet<string>;
  readonly worktreePaths: ReadonlySet<string>;
}

export function buildExternalRoleAuthorityIndex(
  snapshot: AgentsVxappExternalRoleAuthoritySnapshot,
): AgentsVxappExternalRoleAuthorityIndex {
  return {
    projectIds: new Set(snapshot.projects.map((project) => project.id)),
    threadIds: new Set(snapshot.threadSummaries.map((thread) => thread.id)),
    workspaceRoots: new Set(snapshot.projects.map((project) => project.workspaceRoot)),
    worktreePaths: new Set(
      snapshot.threadSummaries.flatMap((thread) =>
        thread.worktreePath && thread.worktreePath.length > 0 ? [thread.worktreePath] : [],
      ),
    ),
  };
}

function normalizeExternalRoleAuthorityProject(
  project: AgentsVxappExternalRoleAuthorityProjectInput,
): OrchestrationProject {
  const { kind, ...projectWithoutKind } = project;
  if (kind === "workspace") {
    return { ...projectWithoutKind, kind: "project" };
  }
  if (kind === undefined) {
    return projectWithoutKind;
  }
  return { ...projectWithoutKind, kind };
}

export function validateExternalRoleAuthoritySnapshot(
  snapshot: AgentsVxappExternalRoleAuthoritySnapshotInput,
): AgentsVxappExternalRoleAuthoritySnapshot {
  const projects = snapshot.projects.map(normalizeExternalRoleAuthorityProject);
  const activeThreadIds = new Set(
    snapshot.threadSummaries
      .filter((thread) => thread.archivedAt === null && thread.deletedAt === null)
      .map((thread) => thread.id),
  );
  const staleProject = projects.find(
    (project) =>
      project.currentSessionRootThreadId !== undefined &&
      project.currentSessionRootThreadId !== null &&
      !activeThreadIds.has(project.currentSessionRootThreadId),
  );
  if (staleProject) {
    throw new Error(
      `agents-vxapp external role authority project ${staleProject.id} points at a stale currentSessionRootThreadId.`,
    );
  }
  return {
    projects,
    threadSummaries: snapshot.threadSummaries,
  };
}

export class AgentsVxappExternalRoleAuthorityError extends Schema.TaggedErrorClass<AgentsVxappExternalRoleAuthorityError>()(
  "AgentsVxappExternalRoleAuthorityError",
  {
    detail: Schema.String,
    operation: Schema.String,
    ownerCommand: Schema.optional(Schema.String),
    authoritySurface: Schema.optional(Schema.String),
    ownerErrorCode: Schema.optional(Schema.NullOr(Schema.String)),
    authorityStore: Schema.optional(Schema.NullOr(Schema.String)),
    authoritySource: Schema.optional(Schema.NullOr(Schema.String)),
    contractFamily: Schema.optional(Schema.NullOr(Schema.String)),
    contractVersion: Schema.optional(Schema.NullOr(Schema.String)),
    exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
    stdout: Schema.optional(Schema.String),
    stderr: Schema.optional(Schema.String),
  },
) {}

export interface AgentsVxappExternalRoleAuthorityShape {
  readonly getSnapshot: () => Effect.Effect<
    AgentsVxappExternalRoleAuthoritySnapshot,
    AgentsVxappExternalRoleAuthorityError
  >;
  readonly getRuntimePaths: () => Effect.Effect<
    AgentsVxappRoleSessionRuntimePaths,
    AgentsVxappExternalRoleAuthorityError
  >;
}

export class AgentsVxappExternalRoleAuthority extends ServiceMap.Service<
  AgentsVxappExternalRoleAuthority,
  AgentsVxappExternalRoleAuthorityShape
>()("t3/extensions/vxapp/Services/AgentsVxappExternalRoleAuthority") {}
