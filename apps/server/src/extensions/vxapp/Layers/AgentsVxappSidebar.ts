import {
  ProjectId,
  ThreadId,
  type ServerGetAgentsVxappSidebarGraphResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  AgentsVxappExternalRoleAuthority,
  buildExternalRoleAuthorityIndex,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";
import {
  AgentsVxappSidebar,
  AgentsVxappSidebarError,
  type AgentsVxappSidebarShape,
} from "../Services/AgentsVxappSidebar.ts";
import { fetchAgentsVxappBootstrapSidebarSnapshot } from "../agentsVxappOwnerClient.ts";

const ProjectionProjectIdRow = Schema.Struct({ projectId: ProjectId });
const ProjectionThreadIdRow = Schema.Struct({ threadId: ThreadId });

function buildMirrorDiagnostics(input: {
  graph: Omit<ServerGetAgentsVxappSidebarGraphResult, "mirrorDiagnostics">;
  ignoredProjectIds?: ReadonlySet<ProjectId>;
  ignoredThreadIds?: ReadonlySet<ThreadId>;
  projectionProjectIds: readonly ProjectId[];
  projectionThreadIds: readonly ThreadId[];
}): ServerGetAgentsVxappSidebarGraphResult["mirrorDiagnostics"] {
  const projectionProjectIds = new Set(input.projectionProjectIds);
  const projectionThreadIds = new Set(input.projectionThreadIds);
  const ignoredProjectIds = input.ignoredProjectIds ?? new Set<ProjectId>();
  const ignoredThreadIds = input.ignoredThreadIds ?? new Set<ThreadId>();
  const missingProjectIds = new Set<ProjectId>();
  const missingThreadIds = new Set<ThreadId>();

  for (const threadLink of input.graph.threadLinks) {
    for (const projectId of [threadLink.projectId, threadLink.executiveProjectId]) {
      if (projectId && !ignoredProjectIds.has(projectId) && !projectionProjectIds.has(projectId)) {
        missingProjectIds.add(projectId);
      }
    }
    for (const threadId of [
      threadLink.threadId,
      threadLink.executiveThreadId,
      threadLink.orchestratorThreadId,
      threadLink.parentThreadId,
    ]) {
      if (threadId && !ignoredThreadIds.has(threadId) && !projectionThreadIds.has(threadId)) {
        missingThreadIds.add(threadId);
      }
    }
  }

  return {
    missingProjectIds: [...missingProjectIds].toSorted(),
    missingThreadIds: [...missingThreadIds].toSorted(),
    staleMirror: missingProjectIds.size > 0 || missingThreadIds.size > 0,
  };
}

const makeAgentsVxappSidebar = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const externalRoleAuthority = yield* AgentsVxappExternalRoleAuthority;
  const listProjectionProjectIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectIdRow,
    execute: () =>
      sql`
        SELECT project_id AS "projectId"
        FROM projection_projects
        WHERE deleted_at IS NULL
      `,
  });
  const listProjectionThreadIds = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadIdRow,
    execute: () =>
      sql`
        SELECT thread_id AS "threadId"
        FROM projection_threads
        WHERE deleted_at IS NULL
      `,
  });

  const getGraph: AgentsVxappSidebarShape["getGraph"] = () =>
    Effect.gen(function* () {
      const graph = yield* Effect.tryPromise({
        try: () => fetchAgentsVxappBootstrapSidebarSnapshot(),
        catch: (error) =>
          new AgentsVxappSidebarError({
            message:
              error instanceof Error
                ? error.message
                : "Failed to fetch vxapp sidebar owner snapshot.",
          }),
      });

      const [projectionProjectRows, projectionThreadRows] = yield* Effect.all([
        listProjectionProjectIds(undefined),
        listProjectionThreadIds(undefined),
      ]).pipe(
        Effect.mapError(
          (error) =>
            new AgentsVxappSidebarError({
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to query mirrored T3 projection tables.",
            }),
        ),
      );

      const externalRoleIndex = yield* externalRoleAuthority.getSnapshot().pipe(
        Effect.map(buildExternalRoleAuthorityIndex),
        Effect.mapError(
          (error) =>
            new AgentsVxappSidebarError({
              message: error.detail,
            }),
        ),
      );

      return {
        ...graph,
        mirrorDiagnostics: buildMirrorDiagnostics(
          Object.assign(
            {
              graph,
              projectionProjectIds: projectionProjectRows.map((row) => row.projectId),
              projectionThreadIds: projectionThreadRows.map((row) => row.threadId),
            },
            {
              ignoredProjectIds: externalRoleIndex.projectIds,
              ignoredThreadIds: externalRoleIndex.threadIds,
            },
          ),
        ),
      } satisfies ServerGetAgentsVxappSidebarGraphResult;
    });

  return {
    getGraph,
  } satisfies AgentsVxappSidebarShape;
});

export const AgentsVxappSidebarLive = Layer.effect(AgentsVxappSidebar, makeAgentsVxappSidebar);
