import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationCtoAttentionItem,
  OrchestrationReadModel,
  OrchestrationProjectKind,
  OrchestrationProgramStatus,
  ProgramId,
  ProgramNotificationEvidence,
  OrchestratorWakeItem,
  ProjectId,
  ProjectHooks,
  ProjectScript,
  ThreadId,
  ThreadLabels,
  TurnId,
  ModelSelection,
  type OrchestrationGetProjectByWorkspaceResult,
  type OrchestrationGetReadinessResult,
  type OrchestrationListOrchestratorWakesResult,
  type OrchestrationListProjectThreadsResult,
  type OrchestrationListSessionThreadsResult,
  type OrchestrationListThreadActivitiesResult,
  type OrchestrationListThreadMessagesResult,
  type OrchestrationListThreadSessionsResult,
  type OrchestrationListProjectsResult,
  type OrchestrationMessage,
  type OrchestrationProgram,
  type OrchestrationProgramNotification,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadSummary,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionCtoAttention } from "../../persistence/Services/ProjectionCtoAttention.ts";
import { ProjectionOrchestratorWake } from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProgramNotification } from "../../persistence/Services/ProjectionProgramNotifications.ts";
import { ProjectionProgram } from "../../persistence/Services/ProjectionPrograms.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { selectOperationalCtoAttentionItems } from "../projectionCtoAttention.ts";
import {
  ProjectionOperationalQuery,
  type ProjectionOperationalQueryShape,
  type ProjectionThreadCheckpointContext,
} from "../Services/ProjectionOperationalQuery.ts";

const ProjectionProjectSummaryDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    kind: Schema.NullOr(OrchestrationProjectKind),
    sidebarParentProjectId: Schema.NullOr(ProjectId),
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    hooks: Schema.fromJsonString(ProjectHooks),
  }),
);

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);

const ProjectionProgramDbRowSchema = ProjectionProgram.mapFields(
  Struct.assign({
    programId: ProgramId,
    status: OrchestrationProgramStatus,
    executiveProjectId: ProjectId,
    executiveThreadId: ThreadId,
    currentOrchestratorThreadId: Schema.NullOr(ThreadId),
  }),
);

const ProjectionProgramNotificationDbRowSchema = ProjectionProgramNotification.mapFields(
  Struct.assign({
    evidence: Schema.fromJsonString(ProgramNotificationEvidence),
    consumeReason: Schema.NullOr(Schema.String),
    dropReason: Schema.NullOr(Schema.String),
  }),
);
const ProjectionCtoAttentionDbRowSchema = ProjectionCtoAttention.mapFields(
  Struct.assign({
    evidence: Schema.fromJsonString(ProgramNotificationEvidence),
  }),
);

const ProjectionThreadSummaryDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(ThreadLabels),
    modelSelection: Schema.fromJsonString(ModelSelection),
    sessionWorkerThreadCount: Schema.optional(NonNegativeInt),
  }),
);

const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
type ProjectionProjectSummaryDbRow = typeof ProjectionProjectSummaryDbRowSchema.Type;
type ProjectionThreadSummaryDbRow = typeof ProjectionThreadSummaryDbRowSchema.Type;
type ProjectionThreadSessionDbRow = typeof ProjectionThreadSessionDbRowSchema.Type;

const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);

const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);

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
type ProjectionLatestTurnDbRow = typeof ProjectionLatestTurnDbRowSchema.Type;

const ProjectionThreadCheckpointContextDbRowSchema = Schema.Struct({
  threadId: ThreadId,
  worktreePath: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.NullOr(Schema.String),
});

const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);

const ProjectionStateDbRowSchema = ProjectionState;

const CountRowSchema = Schema.Struct({
  count: NonNegativeInt,
});

const ProjectionSessionWorkerCountDbRowSchema = Schema.Struct({
  rootThreadId: ThreadId,
  workerThreadCount: NonNegativeInt,
});

function mapProjectRowToReadModelProject(
  row: ProjectionProjectSummaryDbRow,
): OrchestrationReadModel["projects"][number] {
  return Object.assign(
    {
      id: row.projectId,
      title: row.title,
      workspaceRoot: row.workspaceRoot,
      kind: row.kind ?? "project",
      defaultModelSelection: row.defaultModelSelection ?? null,
      scripts: row.scripts,
      hooks: row.hooks,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
    },
    row.sidebarParentProjectId !== null
      ? { sidebarParentProjectId: row.sidebarParentProjectId }
      : undefined,
    row.currentSessionRootThreadId !== null
      ? { currentSessionRootThreadId: row.currentSessionRootThreadId }
      : undefined,
  );
}

function mapProjectRowToSummary(
  row: ProjectionProjectSummaryDbRow,
): OrchestrationListProjectsResult[number] {
  return Object.assign(
    {
      id: row.projectId,
      title: row.title,
      workspaceRoot: row.workspaceRoot,
      kind: row.kind ?? null,
      defaultModelSelection: row.defaultModelSelection ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
    },
    row.sidebarParentProjectId !== null
      ? { sidebarParentProjectId: row.sidebarParentProjectId }
      : undefined,
    row.currentSessionRootThreadId !== null
      ? { currentSessionRootThreadId: row.currentSessionRootThreadId }
      : undefined,
  );
}

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.programs,
  ORCHESTRATION_PROJECTOR_NAMES.programNotifications,
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

function mapThreadSummaryRows(input: {
  threads: ReadonlyArray<ProjectionThreadSummaryDbRow>;
  sessions: ReadonlyArray<ProjectionThreadSessionDbRow>;
  latestTurns: ReadonlyArray<ProjectionLatestTurnDbRow>;
}): OrchestrationThreadSummary[] {
  const sessionByThreadId = new Map<string, OrchestrationSession>();
  for (const row of input.sessions) {
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
  for (const row of input.latestTurns) {
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

  return input.threads.map((row) => ({
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
    programId: row.programId ?? undefined,
    executiveProjectId: row.executiveProjectId ?? undefined,
    executiveThreadId: row.executiveThreadId ?? undefined,
    sessionWorkerThreadCount: row.sessionWorkerThreadCount ?? undefined,
  }));
}

function emptyThreadCoverage() {
  return {
    messageCount: 0,
    messageLimit: 0,
    messagesTruncated: false,
    proposedPlanCount: 0,
    proposedPlanLimit: 0,
    proposedPlansTruncated: false,
    activityCount: 0,
    activityLimit: 0,
    activitiesTruncated: false,
    checkpointCount: 0,
    checkpointLimit: 0,
    checkpointsTruncated: false,
  };
}

function mapSummaryToThread(summary: OrchestrationThreadSummary): OrchestrationThread {
  return {
    id: summary.id,
    projectId: summary.projectId,
    title: summary.title,
    labels: summary.labels,
    modelSelection: summary.modelSelection,
    runtimeMode: summary.runtimeMode,
    interactionMode: summary.interactionMode,
    branch: summary.branch,
    worktreePath: summary.worktreePath,
    latestTurn: summary.latestTurn,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    archivedAt: summary.archivedAt,
    deletedAt: summary.deletedAt,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    snapshotCoverage: emptyThreadCoverage(),
    session: summary.session,
    ...(summary.orchestratorProjectId !== undefined
      ? { orchestratorProjectId: summary.orchestratorProjectId }
      : {}),
    ...(summary.orchestratorThreadId !== undefined
      ? { orchestratorThreadId: summary.orchestratorThreadId }
      : {}),
    ...(summary.parentThreadId !== undefined ? { parentThreadId: summary.parentThreadId } : {}),
    ...(summary.spawnRole !== undefined ? { spawnRole: summary.spawnRole } : {}),
    ...(summary.spawnedBy !== undefined ? { spawnedBy: summary.spawnedBy } : {}),
    ...(summary.workflowId !== undefined ? { workflowId: summary.workflowId } : {}),
    ...(summary.programId !== undefined ? { programId: summary.programId } : {}),
    ...(summary.executiveProjectId !== undefined
      ? { executiveProjectId: summary.executiveProjectId }
      : {}),
    ...(summary.executiveThreadId !== undefined
      ? { executiveThreadId: summary.executiveThreadId }
      : {}),
  };
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

  const listProgramRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProgramDbRowSchema,
    execute: () =>
      sql`
        SELECT
          program_id AS "programId",
          title,
          objective,
          status,
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          deleted_at AS "deletedAt"
        FROM projection_programs
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, program_id ASC
      `,
  });

  const listProgramNotificationRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProgramNotificationDbRowSchema,
    execute: () =>
      sql`
        SELECT
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          orchestrator_thread_id AS "orchestratorThreadId",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          delivered_at AS "deliveredAt",
          consumed_at AS "consumedAt",
          dropped_at AS "droppedAt",
          consume_reason AS "consumeReason",
          drop_reason AS "dropReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_program_notifications
        WHERE state IN ('pending', 'delivering', 'delivered')
        ORDER BY queued_at DESC, notification_id ASC
        LIMIT 100
      `,
  });

  const listCtoAttentionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCtoAttentionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          attention_id AS "attentionId",
          attention_key AS "attentionKey",
          notification_id AS "notificationId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          source_thread_id AS "sourceThreadId",
          source_role AS "sourceRole",
          kind,
          severity,
          summary,
          evidence_json AS "evidence",
          state,
          queued_at AS "queuedAt",
          acknowledged_at AS "acknowledgedAt",
          resolved_at AS "resolvedAt",
          dropped_at AS "droppedAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_cto_attention
        ORDER BY updated_at DESC, attention_id ASC
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
          sidebar_parent_project_id AS "sidebarParentProjectId",
          current_session_root_thread_id AS "currentSessionRootThreadId",
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
          FROM projection_threads
          WHERE project_id = ${projectId}
            AND archived_at IS NULL
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      return sql`
        SELECT
          t.thread_id AS "threadId",
          t.project_id AS "projectId",
          t.title,
          t.labels_json AS "labels",
          t.model_selection_json AS "modelSelection",
          t.runtime_mode AS "runtimeMode",
          t.interaction_mode AS "interactionMode",
          t.branch,
          t.worktree_path AS "worktreePath",
          t.latest_turn_id AS "latestTurnId",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          t.archived_at AS "archivedAt",
          t.deleted_at AS "deletedAt",
          t.orchestrator_project_id AS "orchestratorProjectId",
          t.orchestrator_thread_id AS "orchestratorThreadId",
          t.parent_thread_id AS "parentThreadId",
          t.spawn_role AS "spawnRole",
          t.spawned_by AS "spawnedBy",
          t.workflow_id AS "workflowId",
          t.program_id AS "programId",
          t.executive_project_id AS "executiveProjectId",
          t.executive_thread_id AS "executiveThreadId"
        FROM projection_threads t
        WHERE t.project_id = ${projectId}
          AND t.archived_at IS NULL
          AND t.deleted_at IS NULL
        ORDER BY t.created_at ASC, t.thread_id ASC
      `;
    },
  });

  const listProjectSessionWorkerCountRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.String,
      includeArchived: Schema.Boolean,
      includeDeleted: Schema.Boolean,
    }),
    Result: ProjectionSessionWorkerCountDbRowSchema,
    execute: ({ projectId, includeArchived, includeDeleted }) => {
      if (includeArchived && includeDeleted) {
        return sql`
          WITH RECURSIVE
            roots AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE project_id = ${projectId}
                AND spawn_role = 'orchestrator'
            ),
            family(root_thread_id, thread_id) AS (
              SELECT root_thread_id, root_thread_id FROM roots
              UNION
              SELECT f.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
            ),
            family_with_workflow(root_thread_id, thread_id) AS (
              SELECT root_thread_id, thread_id FROM family
              UNION
              SELECT r.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN roots r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT
            r.root_thread_id AS "rootThreadId",
            COUNT(DISTINCT CASE
              WHEN f.thread_id <> r.root_thread_id THEN f.thread_id
              ELSE NULL
            END) AS "workerThreadCount"
          FROM roots r
          LEFT JOIN family_with_workflow f ON f.root_thread_id = r.root_thread_id
          GROUP BY r.root_thread_id
        `;
      }
      if (includeArchived) {
        return sql`
          WITH RECURSIVE
            roots AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE project_id = ${projectId}
                AND spawn_role = 'orchestrator'
                AND deleted_at IS NULL
            ),
            family(root_thread_id, thread_id) AS (
              SELECT root_thread_id, root_thread_id FROM roots
              UNION
              SELECT f.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
              WHERE t.deleted_at IS NULL
            ),
            family_with_workflow(root_thread_id, thread_id) AS (
              SELECT root_thread_id, thread_id FROM family
              UNION
              SELECT r.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN roots r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE t.deleted_at IS NULL
                AND COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT
            r.root_thread_id AS "rootThreadId",
            COUNT(DISTINCT CASE
              WHEN f.thread_id <> r.root_thread_id THEN f.thread_id
              ELSE NULL
            END) AS "workerThreadCount"
          FROM roots r
          LEFT JOIN family_with_workflow f ON f.root_thread_id = r.root_thread_id
          GROUP BY r.root_thread_id
        `;
      }
      if (includeDeleted) {
        return sql`
          WITH RECURSIVE
            roots AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE project_id = ${projectId}
                AND spawn_role = 'orchestrator'
                AND archived_at IS NULL
            ),
            family(root_thread_id, thread_id) AS (
              SELECT root_thread_id, root_thread_id FROM roots
              UNION
              SELECT f.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
              WHERE t.archived_at IS NULL
            ),
            family_with_workflow(root_thread_id, thread_id) AS (
              SELECT root_thread_id, thread_id FROM family
              UNION
              SELECT r.root_thread_id, t.thread_id
              FROM projection_threads t
              INNER JOIN roots r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE t.archived_at IS NULL
                AND COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT
            r.root_thread_id AS "rootThreadId",
            COUNT(DISTINCT CASE
              WHEN f.thread_id <> r.root_thread_id THEN f.thread_id
              ELSE NULL
            END) AS "workerThreadCount"
          FROM roots r
          LEFT JOIN family_with_workflow f ON f.root_thread_id = r.root_thread_id
          GROUP BY r.root_thread_id
        `;
      }
      return sql`
        WITH RECURSIVE
          roots AS (
            SELECT
              thread_id AS root_thread_id,
              workflow_id AS root_workflow_id
            FROM projection_threads
            WHERE project_id = ${projectId}
              AND spawn_role = 'orchestrator'
              AND archived_at IS NULL
              AND deleted_at IS NULL
          ),
          family(root_thread_id, thread_id) AS (
            SELECT root_thread_id, root_thread_id FROM roots
            UNION
            SELECT f.root_thread_id, t.thread_id
            FROM projection_threads t
            INNER JOIN family f
              ON t.parent_thread_id = f.thread_id
              OR t.spawned_by = f.thread_id
              OR t.orchestrator_thread_id = f.thread_id
            WHERE t.archived_at IS NULL
              AND t.deleted_at IS NULL
          ),
          family_with_workflow(root_thread_id, thread_id) AS (
            SELECT root_thread_id, thread_id FROM family
            UNION
            SELECT r.root_thread_id, t.thread_id
            FROM projection_threads t
            INNER JOIN roots r
              ON r.root_workflow_id IS NOT NULL
              AND t.workflow_id = r.root_workflow_id
            WHERE t.archived_at IS NULL
              AND t.deleted_at IS NULL
              AND COALESCE(t.spawn_role, '') <> 'orchestrator'
          )
        SELECT
          r.root_thread_id AS "rootThreadId",
          COUNT(DISTINCT CASE
            WHEN f.thread_id <> r.root_thread_id THEN f.thread_id
            ELSE NULL
          END) AS "workerThreadCount"
        FROM roots r
        LEFT JOIN family_with_workflow f ON f.root_thread_id = r.root_thread_id
        GROUP BY r.root_thread_id
      `;
    },
  });

  const listCurrentThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSummaryDbRowSchema,
    execute: () =>
      sql`
        SELECT
          t.thread_id AS "threadId",
          t.project_id AS "projectId",
          t.title,
          t.labels_json AS "labels",
          t.model_selection_json AS "modelSelection",
          t.runtime_mode AS "runtimeMode",
          t.interaction_mode AS "interactionMode",
          t.branch,
          t.worktree_path AS "worktreePath",
          t.latest_turn_id AS "latestTurnId",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          t.archived_at AS "archivedAt",
          t.deleted_at AS "deletedAt",
          t.orchestrator_project_id AS "orchestratorProjectId",
          t.orchestrator_thread_id AS "orchestratorThreadId",
          t.parent_thread_id AS "parentThreadId",
          t.spawn_role AS "spawnRole",
          t.spawned_by AS "spawnedBy",
          t.workflow_id AS "workflowId",
          t.program_id AS "programId",
          t.executive_project_id AS "executiveProjectId",
          t.executive_thread_id AS "executiveThreadId"
        FROM projection_threads t
        INNER JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.archived_at IS NULL
          AND t.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY t.created_at ASC, t.thread_id ASC
      `,
  });

  const listSessionThreadRows = SqlSchema.findAll({
    Request: Schema.Struct({
      rootThreadId: ThreadId,
      includeArchived: Schema.Boolean,
      includeDeleted: Schema.Boolean,
    }),
    Result: ProjectionThreadSummaryDbRowSchema,
    execute: ({ rootThreadId, includeArchived, includeDeleted }) => {
      if (includeArchived && includeDeleted) {
        return sql`
          WITH RECURSIVE
            root AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE thread_id = ${rootThreadId}
              LIMIT 1
            ),
            family(thread_id) AS (
              SELECT root_thread_id FROM root
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
            ),
            family_with_workflow(thread_id) AS (
              SELECT thread_id FROM family
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN root r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT DISTINCT
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
          FROM projection_threads
          WHERE thread_id IN (SELECT thread_id FROM family_with_workflow)
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      if (includeArchived) {
        return sql`
          WITH RECURSIVE
            root AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE thread_id = ${rootThreadId}
                AND deleted_at IS NULL
              LIMIT 1
            ),
            family(thread_id) AS (
              SELECT root_thread_id FROM root
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
              WHERE t.deleted_at IS NULL
            ),
            family_with_workflow(thread_id) AS (
              SELECT thread_id FROM family
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN root r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE t.deleted_at IS NULL
                AND COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT DISTINCT
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
          FROM projection_threads
          WHERE thread_id IN (SELECT thread_id FROM family_with_workflow)
            AND deleted_at IS NULL
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      if (includeDeleted) {
        return sql`
          WITH RECURSIVE
            root AS (
              SELECT
                thread_id AS root_thread_id,
                workflow_id AS root_workflow_id
              FROM projection_threads
              WHERE thread_id = ${rootThreadId}
                AND archived_at IS NULL
              LIMIT 1
            ),
            family(thread_id) AS (
              SELECT root_thread_id FROM root
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN family f
                ON t.parent_thread_id = f.thread_id
                OR t.spawned_by = f.thread_id
                OR t.orchestrator_thread_id = f.thread_id
              WHERE t.archived_at IS NULL
            ),
            family_with_workflow(thread_id) AS (
              SELECT thread_id FROM family
              UNION
              SELECT t.thread_id
              FROM projection_threads t
              INNER JOIN root r
                ON r.root_workflow_id IS NOT NULL
                AND t.workflow_id = r.root_workflow_id
              WHERE t.archived_at IS NULL
                AND COALESCE(t.spawn_role, '') <> 'orchestrator'
            )
          SELECT DISTINCT
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
            workflow_id AS "workflowId",
            program_id AS "programId",
            executive_project_id AS "executiveProjectId",
            executive_thread_id AS "executiveThreadId"
          FROM projection_threads
          WHERE thread_id IN (SELECT thread_id FROM family_with_workflow)
            AND archived_at IS NULL
          ORDER BY created_at ASC, thread_id ASC
        `;
      }
      return sql`
        WITH RECURSIVE
          root AS (
            SELECT
              thread_id AS root_thread_id,
              workflow_id AS root_workflow_id
            FROM projection_threads
            WHERE thread_id = ${rootThreadId}
              AND archived_at IS NULL
              AND deleted_at IS NULL
            LIMIT 1
          ),
          family(thread_id) AS (
            SELECT root_thread_id FROM root
            UNION
            SELECT t.thread_id
            FROM projection_threads t
            INNER JOIN family f
              ON t.parent_thread_id = f.thread_id
              OR t.spawned_by = f.thread_id
              OR t.orchestrator_thread_id = f.thread_id
            WHERE t.archived_at IS NULL
              AND t.deleted_at IS NULL
          ),
          family_with_workflow(thread_id) AS (
            SELECT thread_id FROM family
            UNION
            SELECT t.thread_id
            FROM projection_threads t
            INNER JOIN root r
              ON r.root_workflow_id IS NOT NULL
              AND t.workflow_id = r.root_workflow_id
            WHERE t.archived_at IS NULL
              AND t.deleted_at IS NULL
              AND COALESCE(t.spawn_role, '') <> 'orchestrator'
          )
        SELECT DISTINCT
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
          workflow_id AS "workflowId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId"
        FROM projection_threads
        WHERE thread_id IN (SELECT thread_id FROM family_with_workflow)
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

  const listCurrentThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
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
        INNER JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.archived_at IS NULL
          AND t.deleted_at IS NULL
          AND p.deleted_at IS NULL
        ORDER BY s.thread_id ASC
      `,
  });

  const listCurrentLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
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
        INNER JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.archived_at IS NULL
          AND t.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND tr.turn_id = t.latest_turn_id
        ORDER BY tr.thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Struct({
      threadId: ThreadId,
      limit: NonNegativeInt,
      beforeCreatedAt: Schema.NullOr(IsoDateTime),
    }),
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId, limit, beforeCreatedAt }) => {
      if (beforeCreatedAt !== null) {
        return sql`
          SELECT
            message_id AS "messageId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            role,
            text,
            attachments_json AS "attachments",
            is_streaming AS "isStreaming",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
            AND created_at < ${beforeCreatedAt}
          ORDER BY created_at DESC, message_id DESC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC, message_id DESC
        LIMIT ${limit}
      `;
    },
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Struct({
      threadId: ThreadId,
      limit: NonNegativeInt,
      beforeSequence: Schema.NullOr(NonNegativeInt),
    }),
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId, limit, beforeSequence }) => {
      if (beforeSequence !== null) {
        return sql`
          SELECT
            activity_id AS "activityId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            tone,
            kind,
            summary,
            payload_json AS "payload",
            sequence,
            created_at AS "createdAt"
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
            AND sequence IS NOT NULL
            AND sequence < ${beforeSequence}
          ORDER BY sequence DESC, created_at DESC, activity_id DESC
          LIMIT ${limit}
        `;
      }
      return sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
          sequence DESC,
          created_at DESC,
          activity_id DESC
        LIMIT ${limit}
      `;
    },
  });

  const listThreadSessionRowsByThread = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadId }) =>
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
        WHERE thread_id = ${threadId}
        ORDER BY updated_at DESC
      `,
  });

  const listOrchestratorWakeRowsByThread = SqlSchema.findAll({
    Request: Schema.Struct({ orchestratorThreadId: ThreadId, limit: NonNegativeInt }),
    Result: ProjectionOrchestratorWakeDbRowSchema,
    execute: ({ orchestratorThreadId, limit }) =>
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
        WHERE orchestrator_thread_id = ${orchestratorThreadId}
        ORDER BY queued_at DESC, wake_id DESC
        LIMIT ${limit}
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

  const getThreadCheckpointContextRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: ProjectionThreadCheckpointContextDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          t.thread_id AS "threadId",
          t.worktree_path AS "worktreePath",
          p.workspace_root AS "workspaceRoot"
        FROM projection_threads t
        LEFT JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const listThreadCheckpointRows = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
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

  const getCurrentState: ProjectionOperationalQueryShape["getCurrentState"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const stateRows = yield* listProjectionStateRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listProjectionState:query",
                "ProjectionOperationalQuery.getCurrentState:listProjectionState:decodeRows",
              ),
            ),
          );
          const projectRows = yield* listProjectRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listProjects:query",
                "ProjectionOperationalQuery.getCurrentState:listProjects:decodeRows",
              ),
            ),
          );
          const programRows = yield* listProgramRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listPrograms:query",
                "ProjectionOperationalQuery.getCurrentState:listPrograms:decodeRows",
              ),
            ),
          );
          const programNotificationRows = yield* listProgramNotificationRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listProgramNotifications:query",
                "ProjectionOperationalQuery.getCurrentState:listProgramNotifications:decodeRows",
              ),
            ),
          );
          const ctoAttentionRows = yield* listCtoAttentionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listCtoAttention:query",
                "ProjectionOperationalQuery.getCurrentState:listCtoAttention:decodeRows",
              ),
            ),
          );

          const threadRows = yield* listCurrentThreadRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listCurrentThreads:query",
                "ProjectionOperationalQuery.getCurrentState:listCurrentThreads:decodeRows",
              ),
            ),
          );
          const sessionRows = yield* listCurrentThreadSessionRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listCurrentSessions:query",
                "ProjectionOperationalQuery.getCurrentState:listCurrentSessions:decodeRows",
              ),
            ),
          );
          const latestTurnRows = yield* listCurrentLatestTurnRows(undefined).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionOperationalQuery.getCurrentState:listCurrentLatestTurns:query",
                "ProjectionOperationalQuery.getCurrentState:listCurrentLatestTurns:decodeRows",
              ),
            ),
          );

          const threadSummaries = mapThreadSummaryRows({
            threads: threadRows,
            sessions: sessionRows,
            latestTurns: latestTurnRows,
          });
          const updatedAt =
            [
              ...projectRows.map((row) => row.updatedAt),
              ...programRows.map((row) => row.updatedAt),
              ...programNotificationRows.map((row) => row.updatedAt),
              ...ctoAttentionRows.map((row) => row.updatedAt),
              ...stateRows.map((row) => row.updatedAt),
            ]
              .toSorted()
              .at(-1) ?? new Date(0).toISOString();

          const programs: ReadonlyArray<OrchestrationProgram> = programRows.map((row) => ({
            id: row.programId,
            title: row.title,
            objective: row.objective,
            status: row.status,
            executiveProjectId: row.executiveProjectId,
            executiveThreadId: row.executiveThreadId,
            currentOrchestratorThreadId: row.currentOrchestratorThreadId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            completedAt: row.completedAt,
            deletedAt: row.deletedAt,
          }));

          const programNotifications: ReadonlyArray<OrchestrationProgramNotification> =
            programNotificationRows.map((row) => ({
              notificationId: row.notificationId,
              programId: row.programId,
              executiveProjectId: row.executiveProjectId,
              executiveThreadId: row.executiveThreadId,
              orchestratorThreadId: row.orchestratorThreadId,
              kind: row.kind,
              severity: row.severity,
              summary: row.summary,
              evidence: row.evidence,
              state: row.state,
              queuedAt: row.queuedAt,
              deliveredAt: row.deliveredAt,
              consumedAt: row.consumedAt,
              droppedAt: row.droppedAt,
              consumeReason: row.consumeReason ?? undefined,
              dropReason: row.dropReason ?? undefined,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            }));
          const ctoAttentionItems: ReadonlyArray<OrchestrationCtoAttentionItem> =
            selectOperationalCtoAttentionItems(ctoAttentionRows);

          const readModel = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            snapshotProfile: "bootstrap-summary" as const,
            snapshotCoverage: {
              includeArchivedThreads: false,
              wakeItemCount: 0,
              wakeItemLimit: 0,
              wakeItemsTruncated: false,
            },
            projects: projectRows.map(mapProjectRowToReadModelProject),
            programs,
            programNotifications,
            ctoAttentionItems,
            threads: threadSummaries.map(mapSummaryToThread),
            orchestratorWakeItems: [],
            updatedAt,
          };

          return yield* decodeReadModel(readModel).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionOperationalQuery.getCurrentState:decodeReadModel",
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
          return toPersistenceSqlError("ProjectionOperationalQuery.getCurrentState:query")(error);
        }),
      );

  const listProjects: ProjectionOperationalQueryShape["listProjects"] = () =>
    listProjectRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listProjects:query",
          "ProjectionOperationalQuery.listProjects:decodeRows",
        ),
      ),
      Effect.map((rows): OrchestrationListProjectsResult => rows.map(mapProjectRowToSummary)),
    );

  const getProjectByWorkspace: ProjectionOperationalQueryShape["getProjectByWorkspace"] = (input) =>
    getProjectByWorkspaceRow({ workspaceRoot: input.workspaceRoot }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.getProjectByWorkspace:query",
          "ProjectionOperationalQuery.getProjectByWorkspace:decodeRow",
        ),
      ),
      Effect.map(
        (row): OrchestrationGetProjectByWorkspaceResult =>
          Option.match(row, {
            onNone: () => null,
            onSome: mapProjectRowToSummary,
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
      sessionWorkerCounts: listProjectSessionWorkerCountRows({
        projectId: input.projectId,
        includeArchived,
        includeDeleted,
      }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionOperationalQuery.listProjectThreads:sessionWorkerCounts:query",
            "ProjectionOperationalQuery.listProjectThreads:sessionWorkerCounts:decodeRows",
          ),
        ),
      ),
    }).pipe(
      Effect.map(
        ({
          threads,
          sessions,
          latestTurns,
          sessionWorkerCounts,
        }): OrchestrationListProjectThreadsResult => {
          const sessionWorkerCountByRootId = new Map(
            sessionWorkerCounts.map((row) => [row.rootThreadId, row.workerThreadCount] as const),
          );
          const enrichedThreads = threads.map((row) =>
            row.spawnRole === "orchestrator"
              ? {
                  ...row,
                  sessionWorkerThreadCount: sessionWorkerCountByRootId.get(row.threadId) ?? 0,
                }
              : row,
          );
          return mapThreadSummaryRows({ threads: enrichedThreads, sessions, latestTurns });
        },
      ),
    );
  };

  const listSessionThreads: ProjectionOperationalQueryShape["listSessionThreads"] = (input) => {
    const includeArchived = input.includeArchived ?? true;
    const includeDeleted = input.includeDeleted ?? false;
    return listSessionThreadRows({
      rootThreadId: input.rootThreadId,
      includeArchived,
      includeDeleted,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listSessionThreads:threads:query",
          "ProjectionOperationalQuery.listSessionThreads:threads:decodeRows",
        ),
      ),
      Effect.flatMap((threads) => {
        if (threads.length === 0) {
          return Effect.succeed([] satisfies OrchestrationListSessionThreadsResult);
        }

        const threadIds = new Set(threads.map((thread) => thread.threadId));
        const projectIds = [...new Set(threads.map((thread) => thread.projectId))];

        return Effect.all({
          threads: Effect.succeed(threads),
          sessionsByProject: Effect.forEach(projectIds, (projectId) =>
            listProjectThreadSessionRows({ projectId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionOperationalQuery.listSessionThreads:sessions:query",
                  "ProjectionOperationalQuery.listSessionThreads:sessions:decodeRows",
                ),
              ),
            ),
          ),
          latestTurnsByProject: Effect.forEach(projectIds, (projectId) =>
            listProjectLatestTurnRows({ projectId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionOperationalQuery.listSessionThreads:latestTurns:query",
                  "ProjectionOperationalQuery.listSessionThreads:latestTurns:decodeRows",
                ),
              ),
            ),
          ),
        }).pipe(
          Effect.map(
            ({
              threads,
              sessionsByProject,
              latestTurnsByProject,
            }): OrchestrationListSessionThreadsResult =>
              mapThreadSummaryRows({
                threads,
                sessions: sessionsByProject
                  .flat()
                  .filter((sessionRow) => threadIds.has(sessionRow.threadId)),
                latestTurns: latestTurnsByProject
                  .flat()
                  .filter((turnRow) => threadIds.has(turnRow.threadId)),
              }),
          ),
        );
      }),
    );
  };

  const listThreadMessages: ProjectionOperationalQueryShape["listThreadMessages"] = (input) =>
    listThreadMessageRows({
      threadId: input.threadId,
      limit: input.limit,
      beforeCreatedAt: input.beforeCreatedAt ?? null,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listThreadMessages:query",
          "ProjectionOperationalQuery.listThreadMessages:decodeRows",
        ),
      ),
      Effect.map(
        (rows): OrchestrationListThreadMessagesResult =>
          rows
            .map(
              (row): OrchestrationMessage => ({
                id: row.messageId,
                role: row.role,
                text: row.text,
                ...(row.attachments !== null ? { attachments: row.attachments } : {}),
                turnId: row.turnId,
                streaming: row.isStreaming === 1,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              }),
            )
            .reverse(),
      ),
    );

  const listThreadActivities: ProjectionOperationalQueryShape["listThreadActivities"] = (input) =>
    listThreadActivityRows({
      threadId: input.threadId,
      limit: input.limit,
      beforeSequence: input.beforeSequence ?? null,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listThreadActivities:query",
          "ProjectionOperationalQuery.listThreadActivities:decodeRows",
        ),
      ),
      Effect.map(
        (rows): OrchestrationListThreadActivitiesResult =>
          rows
            .map(
              (row): OrchestrationThreadActivity => ({
                id: row.activityId,
                tone: row.tone,
                kind: row.kind,
                summary: row.summary,
                payload: row.payload,
                turnId: row.turnId,
                ...(row.sequence !== null ? { sequence: row.sequence } : {}),
                createdAt: row.createdAt,
              }),
            )
            .reverse(),
      ),
    );

  const listThreadSessions: ProjectionOperationalQueryShape["listThreadSessions"] = (input) =>
    listThreadSessionRowsByThread({ threadId: input.threadId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listThreadSessions:query",
          "ProjectionOperationalQuery.listThreadSessions:decodeRows",
        ),
      ),
      Effect.map(
        (rows): OrchestrationListThreadSessionsResult =>
          rows.map((row) => ({
            threadId: row.threadId,
            status: row.status,
            providerName: row.providerName,
            runtimeMode: row.runtimeMode,
            activeTurnId: row.activeTurnId,
            lastError: row.lastError,
            updatedAt: row.updatedAt,
          })),
      ),
    );

  const listOrchestratorWakes: ProjectionOperationalQueryShape["listOrchestratorWakes"] = (input) =>
    listOrchestratorWakeRowsByThread({
      orchestratorThreadId: input.orchestratorThreadId,
      limit: input.limit,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionOperationalQuery.listOrchestratorWakes:query",
          "ProjectionOperationalQuery.listOrchestratorWakes:decodeRows",
        ),
      ),
      Effect.map(
        (rows): OrchestrationListOrchestratorWakesResult =>
          rows
            .map(
              (row): OrchestratorWakeItem => ({
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
                ...(row.deliveryMessageId !== null
                  ? { deliveryMessageId: row.deliveryMessageId }
                  : {}),
                deliveredAt: row.deliveredAt,
                consumedAt: row.consumedAt,
                ...(row.consumeReason !== null ? { consumeReason: row.consumeReason } : {}),
              }),
            )
            .reverse(),
      ),
    );

  const getThreadCheckpointContext: ProjectionOperationalQueryShape["getThreadCheckpointContext"] =
    (input) =>
      Effect.gen(function* () {
        const threadRow = yield* getThreadCheckpointContextRow({ threadId: input.threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionOperationalQuery.getThreadCheckpointContext:thread:query",
              "ProjectionOperationalQuery.getThreadCheckpointContext:thread:decodeRow",
            ),
          ),
        );

        if (Option.isNone(threadRow)) {
          return {
            threadId: input.threadId,
            threadFound: false,
            workspaceCwd: null,
            checkpoints: [],
          } satisfies ProjectionThreadCheckpointContext;
        }

        const checkpoints = yield* listThreadCheckpointRows({ threadId: input.threadId }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProjectionOperationalQuery.getThreadCheckpointContext:checkpoints:query",
              "ProjectionOperationalQuery.getThreadCheckpointContext:checkpoints:decodeRows",
            ),
          ),
        );

        return {
          threadId: input.threadId,
          threadFound: true,
          workspaceCwd: threadRow.value.worktreePath ?? threadRow.value.workspaceRoot,
          checkpoints,
        } satisfies ProjectionThreadCheckpointContext;
      });

  return {
    getReadiness,
    getCurrentState,
    listProjects,
    getProjectByWorkspace,
    listProjectThreads,
    listSessionThreads,
    listThreadMessages,
    listThreadActivities,
    listThreadSessions,
    listOrchestratorWakes,
    getThreadCheckpointContext,
  } satisfies ProjectionOperationalQueryShape;
});

export const OrchestrationProjectionOperationalQueryLive = Layer.effect(
  ProjectionOperationalQuery,
  makeProjectionOperationalQuery,
);
