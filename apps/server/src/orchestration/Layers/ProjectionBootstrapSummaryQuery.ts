import {
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationProjectKind,
  OrchestrationReadModel,
  ProjectId,
  ProjectHooks,
  ProjectScript,
  ThreadId,
  ThreadLabels,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionOrchestratorWake } from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionBootstrapSummaryQuery,
  type ProjectionBootstrapSummaryQueryShape,
} from "../Services/ProjectionBootstrapSummaryQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);

const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    kind: Schema.NullOr(OrchestrationProjectKind),
    sidebarParentProjectId: Schema.NullOr(ProjectId),
    currentSessionRootThreadId: Schema.NullOr(ThreadId),
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    hooks: Schema.fromJsonString(ProjectHooks),
  }),
);

const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(ThreadLabels),
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);

const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionOrchestratorWakeDbRowSchema = ProjectionOrchestratorWake;

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

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

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

const makeProjectionBootstrapSummaryQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          kind,
          sidebar_parent_project_id AS "sidebarParentProjectId",
          current_session_root_thread_id AS "currentSessionRootThreadId",
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

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
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
        WHERE archived_at IS NULL
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listOrchestratorWakeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionOrchestratorWakeDbRowSchema,
    execute: () =>
      sql`
        SELECT
          wake_id AS "wakeId",
          orchestrator_thread_id AS "orchestratorThreadId",
          orchestrator_project_id AS "orchestratorProjectId",
          worker_thread_id AS "workerThreadId",
          worker_project_id AS "workerProjectId",
          worker_turn_id AS "workerTurnId",
          workflow_id AS "workflowId",
          worker_title_snapshot AS "workerTitleSnapshot",
          outcome,
          summary,
          queued_at AS "queuedAt",
          state,
          delivery_message_id AS "deliveryMessageId",
          delivered_at AS "deliveredAt",
          consumed_at AS "consumedAt",
          consume_reason AS "consumeReason"
        FROM projection_orchestrator_wakes
        ORDER BY queued_at ASC, wake_id ASC
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
      `,
  });

  const getBootstrapSummary: ProjectionBootstrapSummaryQueryShape["getBootstrapSummary"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [projectRows, threadRows, sessionRows, latestTurnRows, wakeRows, stateRows] =
            yield* Effect.all([
              listProjectRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjects:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjects:decodeRows",
                  ),
                ),
              ),
              listThreadRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listThreads:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listThreads:decodeRows",
                  ),
                ),
              ),
              listThreadSessionRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listThreadSessions:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listThreadSessions:decodeRows",
                  ),
                ),
              ),
              listLatestTurnRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listLatestTurns:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listLatestTurns:decodeRows",
                  ),
                ),
              ),
              listOrchestratorWakeRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listOrchestratorWakes:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listOrchestratorWakes:decodeRows",
                  ),
                ),
              ),
              listProjectionStateRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjectionState:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjectionState:decodeRows",
                  ),
                ),
              ),
            ]);

          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          let updatedAt: string | null = null;

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (latestTurnByThread.has(row.threadId)) {
              continue;
            }
            latestTurnByThread.set(row.threadId, {
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

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            workspaceRoot: row.workspaceRoot,
            kind: row.kind ?? "project",
            ...(row.sidebarParentProjectId !== null
              ? { sidebarParentProjectId: row.sidebarParentProjectId }
              : {}),
            ...(row.currentSessionRootThreadId !== null
              ? { currentSessionRootThreadId: row.currentSessionRootThreadId }
              : {}),
            defaultModelSelection: row.defaultModelSelection,
            scripts: row.scripts,
            hooks: row.hooks,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map(
            (row) =>
              Object.assign(
                {
                  id: row.threadId,
                  projectId: row.projectId,
                  title: row.title,
                  labels: row.labels,
                  modelSelection: row.modelSelection,
                  runtimeMode: row.runtimeMode,
                  interactionMode: row.interactionMode,
                  branch: row.branch,
                  worktreePath: row.worktreePath,
                  latestTurn: latestTurnByThread.get(row.threadId) ?? null,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  archivedAt: row.archivedAt,
                  deletedAt: row.deletedAt,
                  messages: [],
                  proposedPlans: [],
                  activities: [],
                  checkpoints: [],
                  session: sessionsByThread.get(row.threadId) ?? null,
                },
                row.orchestratorProjectId !== null
                  ? { orchestratorProjectId: row.orchestratorProjectId }
                  : undefined,
                row.orchestratorThreadId !== null
                  ? { orchestratorThreadId: row.orchestratorThreadId }
                  : undefined,
                row.parentThreadId !== null ? { parentThreadId: row.parentThreadId } : undefined,
                row.spawnRole !== null ? { spawnRole: row.spawnRole } : undefined,
                row.spawnedBy !== null ? { spawnedBy: row.spawnedBy } : undefined,
                row.workflowId !== null ? { workflowId: row.workflowId } : undefined,
              ) satisfies OrchestrationThread,
          );

          const orchestratorWakeItems = wakeRows.map((row) => ({
            wakeId: row.wakeId,
            orchestratorThreadId: row.orchestratorThreadId,
            orchestratorProjectId: row.orchestratorProjectId,
            workerThreadId: row.workerThreadId,
            workerProjectId: row.workerProjectId,
            workerTurnId: row.workerTurnId,
            ...(row.workflowId !== null ? { workflowId: row.workflowId } : {}),
            workerTitleSnapshot: row.workerTitleSnapshot,
            outcome: row.outcome,
            summary: row.summary,
            queuedAt: row.queuedAt,
            state: row.state,
            ...(row.deliveryMessageId !== null ? { deliveryMessageId: row.deliveryMessageId } : {}),
            deliveredAt: row.deliveredAt,
            consumedAt: row.consumedAt,
            ...(row.consumeReason !== null ? { consumeReason: row.consumeReason } : {}),
          }));

          return yield* decodeReadModel({
            snapshotSequence: computeSnapshotSequence(stateRows),
            snapshotProfile: "bootstrap-summary",
            projects,
            threads,
            orchestratorWakeItems,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionBootstrapSummaryQuery.getBootstrapSummary:decodeReadModel",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionBootstrapSummaryQuery.getBootstrapSummary:query")(
            error,
          );
        }),
      );

  return {
    getBootstrapSummary,
  } satisfies ProjectionBootstrapSummaryQueryShape;
});

export const OrchestrationProjectionBootstrapSummaryQueryLive = Layer.effect(
  ProjectionBootstrapSummaryQuery,
  makeProjectionBootstrapSummaryQuery,
);
