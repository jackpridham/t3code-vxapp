import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationLatestTurn,
  OrchestrationProjectKind,
  ProjectHooks,
  ProjectScript,
  ThreadId,
  ThreadLabels,
  TurnId,
  ModelSelection,
  type OrchestrationGetProjectByWorkspaceResult,
  type OrchestrationGetReadinessResult,
  type OrchestrationListProjectThreadsResult,
  type OrchestrationListProjectsResult,
  type OrchestrationSession,
  type OrchestrationThreadSummary,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionOperationalQuery,
  type ProjectionOperationalQueryShape,
} from "../Services/ProjectionOperationalQuery.ts";

const ProjectionProjectSummaryDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    kind: Schema.NullOr(OrchestrationProjectKind),
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    hooks: Schema.fromJsonString(ProjectHooks),
  }),
);

const ProjectionThreadSummaryDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(ThreadLabels),
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);

const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;

const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  state: Schema.Literals(["running", "interrupted", "completed", "error"]),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(Schema.String),
});

const ProjectionStateDbRowSchema = ProjectionState;

const CountRowSchema = Schema.Struct({
  count: NonNegativeInt,
});

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
  ORCHESTRATION_PROJECTOR_NAMES.orchestratorWakes,
] as const;

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionOperationalQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectSummaryDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          kind,
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          hooks_json AS "hooks",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const getProjectByWorkspaceRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ workspaceRoot: Schema.String }),
    Result: ProjectionProjectSummaryDbRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          kind,
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          hooks_json AS "hooks",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY updated_at DESC, project_id DESC
        LIMIT 1
      `,
  });

  const listProjectThreadRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.String,
      includeArchived: Schema.Boolean,
      includeDeleted: Schema.Boolean,
    }),
    Result: ProjectionThreadSummaryDbRowSchema,
    execute: ({ projectId, includeArchived, includeDeleted }) => {
      if (includeArchived && includeDeleted) {
        return sql`
          SELECT
            thread_id AS "threadId",
            project_id AS "projectId",
            title,
            labels_json AS "labels",
            model_selection_json AS "modelSelection",
            runtime_mode AS "runtimeMode",
            interaction_mode AS "interactionMode",
            branch,
            worktree_path AS "worktreePath",
            latest_turn_id AS "latestTurnId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            archived_at AS "archivedAt",
            deleted_at AS "deletedAt",
            orchestrator_project_id AS "orchestratorProjectId",
            orchestrator_thread_id AS "orchestratorThreadId",
            parent_thread_id AS "parentThreadId",
            spawn_role AS "spawnRole",
            spawned_by AS "spawnedBy",
            workflow_id AS "workflowId"
          FROM projection_threads
          WHERE project_id = ${projectId}
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      if (includeArchived) {
        return sql`
          SELECT
            thread_id AS "threadId",
            project_id AS "projectId",
            title,
            labels_json AS "labels",
            model_selection_json AS "modelSelection",
            runtime_mode AS "runtimeMode",
            interaction_mode AS "interactionMode",
            branch,
            worktree_path AS "worktreePath",
            latest_turn_id AS "latestTurnId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            archived_at AS "archivedAt",
            deleted_at AS "deletedAt",
            orchestrator_project_id AS "orchestratorProjectId",
            orchestrator_thread_id AS "orchestratorThreadId",
            parent_thread_id AS "parentThreadId",
            spawn_role AS "spawnRole",
            spawned_by AS "spawnedBy",
            workflow_id AS "workflowId"
          FROM projection_threads
          WHERE project_id = ${projectId}
            AND deleted_at IS NULL
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      if (includeDeleted) {
        return sql`
          SELECT
            thread_id AS "threadId",
            project_id AS "projectId",
            title,
            labels_json AS "labels",
            model_selection_json AS "modelSelection",
            runtime_mode AS "runtimeMode",
            interaction_mode AS "interactionMode",
            branch,
            worktree_path AS "worktreePath",
            latest_turn_id AS "latestTurnId",
            created_at AS "createdAt",
            updated_at AS "updatedAt",
            archived_at AS "archivedAt",
            deleted_at AS "deletedAt",
            orchestrator_project_id AS "orchestratorProjectId",
            orchestrator_thread_id AS "orchestratorThreadId",
            parent_thread_id AS "parentThreadId",
            spawn_role AS "spawnRole",
            spawned_by AS "spawnedBy",
            workflow_id AS "workflowId"
          FROM projection_threads
          WHERE project_id = ${projectId}
            AND archived_at IS NULL
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      return sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          labels_json AS "labels",
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt",
          orchestrator_project_id AS "orchestratorProjectId",
          orchestrator_thread_id AS "orchestratorThreadId",
          parent_thread_id AS "parentThreadId",
          spawn_role AS "spawnRole",
          spawned_by AS "spawnedBy",
          workflow_id AS "workflowId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND archived_at IS NULL
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
      `;
    },
  });

  const listProjectThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String }),
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          s.thread_id AS "threadId",
          s.status,
          s.provider_name AS "providerName",
          s.provider_session_id AS "providerSessionId",
          s.provider_thread_id AS "providerThreadId",
          s.runtime_mode AS "runtimeMode",
          s.active_turn_id AS "activeTurnId",
          s.last_error AS "lastError",
          s.updated_at AS "updatedAt"
        FROM projection_thread_sessions s
        INNER JOIN projection_threads t ON t.thread_id = s.thread_id
        WHERE t.project_id = ${projectId}
        ORDER BY s.thread_id ASC
      `,
  });

  const listProjectLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: Schema.String }),
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          tr.thread_id AS "threadId",
          tr.turn_id AS "turnId",
          tr.state AS "state",
          tr.requested_at AS "requestedAt",
          tr.started_at AS "startedAt",
          tr.completed_at AS "completedAt",
          tr.assistant_message_id AS "assistantMessageId",
          tr.source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          tr.source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns tr
        INNER JOIN projection_threads t ON t.thread_id = tr.thread_id
        WHERE t.project_id = ${projectId}
          AND tr.turn_id = t.latest_turn_id
        ORDER BY tr.thread_id ASC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
        ORDER BY projector ASC
      `,
  });

  const readProjectCountRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CountRowSchema,
    execute: () =>
      sql`
        SELECT
          COUNT(*) AS "count"
        FROM projection_projects
        WHERE deleted_at IS NULL
      `,
  });

  const readThreadCountRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CountRowSchema,
    execute: () =>
      sql`
        SELECT
          COUNT(*) AS "count"
        FROM projection_threads
        WHERE deleted_at IS NULL
      `,
  });

  const getReadiness: ProjectionOperationalQueryShape["getReadiness"] = () =>
    Effect.all({
      stateRows: listProjectionStateRows(undefined).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.getReadiness:listProjectionState:query",
            "ProjectionOperationalQuery.getReadiness:listProjectionState:decodeRows",
          ),
        ),
      ),
      projectCountRow: readProjectCountRow(undefined).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.getReadiness:projectCount:query",
            "ProjectionOperationalQuery.getReadiness:projectCount:decodeRow",
          ),
        ),
      ),
      threadCountRow: readThreadCountRow(undefined).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.getReadiness:threadCount:query",
            "ProjectionOperationalQuery.getReadiness:threadCount:decodeRow",
          ),
        ),
      ),
    }).pipe(
      Effect.map(
        ({ stateRows, projectCountRow, threadCountRow }): OrchestrationGetReadinessResult => ({
          snapshotSequence: computeSnapshotSequence(stateRows),
          projectCount: projectCountRow.count,
          threadCount: threadCountRow.count,
        }),
      ),
    );

  const listProjects: ProjectionOperationalQueryShape["listProjects"] = () =>
    listProjectRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listProjects:query",
          "ProjectionOperationalQuery.listProjects:decodeRows",
        ),
      ),
      Effect.map(
        (rows): OrchestrationListProjectsResult =>
          rows.map((row) => ({
            id: row.projectId,
            title: row.title,
            workspaceRoot: row.workspaceRoot,
            kind: row.kind ?? null,
            defaultModelSelection: row.defaultModelSelection ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt ?? null,
          })),
      ),
    );

  const getProjectByWorkspace: ProjectionOperationalQueryShape["getProjectByWorkspace"] = (input) =>
    getProjectByWorkspaceRow({ workspaceRoot: input.workspaceRoot }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.getProjectByWorkspace:query",
          "ProjectionOperationalQuery.getProjectByWorkspace:decodeRow",
        ),
      ),
      Effect.map((row): OrchestrationGetProjectByWorkspaceResult =>
        Option.match(row, {
          onNone: () => null,
          onSome: (project) => ({
            id: project.projectId,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
            kind: project.kind ?? null,
            defaultModelSelection: project.defaultModelSelection ?? null,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            deletedAt: project.deletedAt ?? null,
          }),
        }),
      ),
    );

  const listProjectThreads: ProjectionOperationalQueryShape["listProjectThreads"] = (input) => {
    const includeArchived = input.includeArchived ?? false;
    const includeDeleted = input.includeDeleted ?? false;
    return Effect.all({
      threads: listProjectThreadRows({
        projectId: input.projectId,
        includeArchived,
        includeDeleted,
      }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.listProjectThreads:threads:query",
            "ProjectionOperationalQuery.listProjectThreads:threads:decodeRows",
          ),
        ),
      ),
      sessions: listProjectThreadSessionRows({ projectId: input.projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.listProjectThreads:sessions:query",
            "ProjectionOperationalQuery.listProjectThreads:sessions:decodeRows",
          ),
        ),
      ),
      latestTurns: listProjectLatestTurnRows({ projectId: input.projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.listProjectThreads:latestTurns:query",
            "ProjectionOperationalQuery.listProjectThreads:latestTurns:decodeRows",
          ),
        ),
      ),
    }).pipe(
      Effect.map(({ threads, sessions, latestTurns }): OrchestrationListProjectThreadsResult => {
        const sessionByThreadId = new Map<string, OrchestrationSession>();
        for (const row of sessions) {
          sessionByThreadId.set(row.threadId, {
            threadId: row.threadId,
            status: row.status,
            providerName: row.providerName,
            runtimeMode: row.runtimeMode,
            activeTurnId: row.activeTurnId,
            lastError: row.lastError,
            updatedAt: row.updatedAt,
          });
        }

        const latestTurnByThreadId = new Map<string, OrchestrationThreadSummary["latestTurn"]>();
        for (const row of latestTurns) {
          latestTurnByThreadId.set(row.threadId, {
            turnId: row.turnId,
            state: row.state,
            requestedAt: row.requestedAt,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            assistantMessageId: row.assistantMessageId,
            ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
              ? {
                  sourceProposedPlan: {
                    threadId: row.sourceProposedPlanThreadId,
                    planId: row.sourceProposedPlanId,
                  },
                }
              : {}),
          });
        }

        return threads.map((row) => ({
          id: row.threadId,
          projectId: row.projectId,
          title: row.title,
          labels: row.labels,
          modelSelection: row.modelSelection,
          runtimeMode: row.runtimeMode,
          interactionMode: row.interactionMode,
          branch: row.branch,
          worktreePath: row.worktreePath,
          latestTurn: latestTurnByThreadId.get(row.threadId) ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          archivedAt: row.archivedAt ?? null,
          deletedAt: row.deletedAt ?? null,
          session: sessionByThreadId.get(row.threadId) ?? null,
          orchestratorProjectId: row.orchestratorProjectId ?? undefined,
          orchestratorThreadId: row.orchestratorThreadId ?? undefined,
          parentThreadId: row.parentThreadId ?? undefined,
          spawnRole: row.spawnRole ?? undefined,
          spawnedBy: row.spawnedBy ?? undefined,
          workflowId: row.workflowId ?? undefined,
        }));
      }),
    );
  };

  return {
    getReadiness,
    listProjects,
    getProjectByWorkspace,
    listProjectThreads,
  } satisfies ProjectionOperationalQueryShape;
});

export const OrchestrationProjectionOperationalQueryLive = Layer.effect(
  ProjectionOperationalQuery,
  makeProjectionOperationalQuery,
);
