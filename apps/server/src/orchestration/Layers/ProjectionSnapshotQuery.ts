import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  ThreadLabels,
  ProjectHooks,
  ProjectScript,
  OrchestrationProjectKind,
  OrchestrationProgramStatus,
  ProgramNotificationEvidence,
  OrchestratorWakeItem,
  OrchestrationSnapshotProfile,
  ProjectId,
  ProgramId,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationProgram,
  type OrchestrationProgramNotification,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  ModelSelection,
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
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProgramNotification } from "../../persistence/Services/ProjectionProgramNotifications.ts";
import { ProjectionProgram } from "../../persistence/Services/ProjectionPrograms.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionOrchestratorWake } from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    kind: Schema.optional(OrchestrationProjectKind),
    sidebarParentProjectId: Schema.NullOr(ProjectId),
    currentSessionRootThreadId: Schema.NullOr(ThreadId),
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
    hooks: Schema.fromJsonString(ProjectHooks),
  }),
);
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
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    labels: Schema.fromJsonString(ThreadLabels),
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionOrchestratorWakeDbRowSchema = ProjectionOrchestratorWake;
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;
const CountDbRowSchema = Schema.Struct({
  count: NonNegativeInt,
});
const ProjectionThreadChildCountDbRowSchema = Schema.Struct({
  threadId: ThreadId,
  count: NonNegativeInt,
});
const SnapshotScopedRowsRequest = Schema.Struct({
  requestedThreadId: Schema.NullOr(ThreadId),
  includeArchivedThreads: Schema.Boolean,
  limit: Schema.NullOr(Schema.Number),
});
const SnapshotScopedCountRowsRequest = Schema.Struct({
  requestedThreadId: Schema.NullOr(ThreadId),
  includeArchivedThreads: Schema.Boolean,
});
const SnapshotScopedLatestTurnRowsRequest = Schema.Struct({
  requestedThreadId: Schema.NullOr(ThreadId),
  includeArchivedThreads: Schema.Boolean,
});
const SnapshotScopedWakeRowsRequest = Schema.Struct({
  limit: Schema.NullOr(Schema.Number),
});

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

type SnapshotProfile = typeof OrchestrationSnapshotProfile.Type;
const SNAPSHOT_WARNING_TOTAL_COUNT_THRESHOLD = 10_000;

type SnapshotBounds = {
  includeArchivedThreads: boolean;
  messageLimit: number | null;
  proposedPlanLimit: number | null;
  activityLimit: number | null;
  checkpointLimit: number | null;
  wakeItemLimit: number | null;
};

const SNAPSHOT_BOUNDS_BY_PROFILE: Record<SnapshotProfile, SnapshotBounds> = {
  "bootstrap-summary": {
    includeArchivedThreads: false,
    messageLimit: 0,
    proposedPlanLimit: 0,
    activityLimit: 0,
    checkpointLimit: 0,
    wakeItemLimit: 100,
  },
  "command-state": {
    includeArchivedThreads: true,
    messageLimit: 0,
    proposedPlanLimit: null,
    activityLimit: 0,
    checkpointLimit: 0,
    wakeItemLimit: 100,
  },
  operational: {
    includeArchivedThreads: true,
    messageLimit: 200,
    proposedPlanLimit: 50,
    activityLimit: 100,
    checkpointLimit: 50,
    wakeItemLimit: 100,
  },
  "active-thread": {
    includeArchivedThreads: false,
    messageLimit: 500,
    proposedPlanLimit: 100,
    activityLimit: 250,
    checkpointLimit: 100,
    wakeItemLimit: 100,
  },
  "debug-export": {
    includeArchivedThreads: true,
    messageLimit: null,
    proposedPlanLimit: null,
    activityLimit: null,
    checkpointLimit: null,
    wakeItemLimit: null,
  },
};

function resolveSnapshotBounds(profile: SnapshotProfile): SnapshotBounds {
  return SNAPSHOT_BOUNDS_BY_PROFILE[profile];
}

function takeTailBounded<Value>(
  values: ReadonlyArray<Value>,
  limit: number | null,
  totalCount: number = values.length,
): {
  values: ReadonlyArray<Value>;
  totalCount: number;
  truncated: boolean;
} {
  if (limit === null || totalCount <= limit) {
    return {
      values,
      totalCount,
      truncated: false,
    };
  }
  return {
    values: values.slice(-limit),
    totalCount,
    truncated: true,
  };
}

function snapshotCoverageWarnings(input: {
  readonly label: string;
  readonly totalCount: number;
  readonly threshold?: number;
}): ReadonlyArray<string> {
  const threshold = input.threshold ?? SNAPSHOT_WARNING_TOTAL_COUNT_THRESHOLD;
  if (input.totalCount <= threshold) {
    return [];
  }
  return [`${input.label} total ${input.totalCount} exceeds warning threshold ${threshold}.`];
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
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
        ORDER BY queued_at DESC, notification_id ASC
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
          workflow_id AS "workflowId",
          program_id AS "programId",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: SnapshotScopedRowsRequest,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads, limit }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      if (limit === 0) {
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
          WHERE 1 = 0
        `;
      }
      if (limit === null) {
        return sql`
          SELECT
            m.message_id AS "messageId",
            m.thread_id AS "threadId",
            m.turn_id AS "turnId",
            m.role,
            m.text,
            m.attachments_json AS "attachments",
            m.is_streaming AS "isStreaming",
            m.created_at AS "createdAt",
            m.updated_at AS "updatedAt"
          FROM projection_thread_messages m
          INNER JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE (${requestedThreadId} IS NULL OR m.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
          ORDER BY m.thread_id ASC, m.created_at ASC, m.message_id ASC
        `;
      }
      return sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM (
          SELECT
            m.message_id,
            m.thread_id,
            m.turn_id,
            m.role,
            m.text,
            m.attachments_json AS attachments,
            m.is_streaming,
            m.created_at,
            m.updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY m.thread_id
              ORDER BY m.created_at DESC, m.message_id DESC
            ) AS rn
          FROM projection_thread_messages m
          INNER JOIN projection_threads t ON t.thread_id = m.thread_id
          WHERE (${requestedThreadId} IS NULL OR m.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        )
        WHERE rn <= ${limit}
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `;
    },
  });

  const countThreadMessageRows = SqlSchema.findAll({
    Request: SnapshotScopedCountRowsRequest,
    Result: ProjectionThreadChildCountDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      return sql`
        SELECT
          m.thread_id AS "threadId",
          COUNT(*) AS "count"
        FROM projection_thread_messages m
        INNER JOIN projection_threads t ON t.thread_id = m.thread_id
        WHERE (${requestedThreadId} IS NULL OR m.thread_id = ${requestedThreadId})
          AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        GROUP BY m.thread_id
      `;
    },
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: SnapshotScopedRowsRequest,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads, limit }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      if (limit === 0) {
        return sql`
          SELECT
            plan_id AS "planId",
            thread_id AS "threadId",
            turn_id AS "turnId",
            plan_markdown AS "planMarkdown",
            implemented_at AS "implementedAt",
            implementation_thread_id AS "implementationThreadId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM projection_thread_proposed_plans
          WHERE 1 = 0
        `;
      }
      if (limit === null) {
        return sql`
          SELECT
            p.plan_id AS "planId",
            p.thread_id AS "threadId",
            p.turn_id AS "turnId",
            p.plan_markdown AS "planMarkdown",
            p.implemented_at AS "implementedAt",
            p.implementation_thread_id AS "implementationThreadId",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt"
          FROM projection_thread_proposed_plans p
          INNER JOIN projection_threads t ON t.thread_id = p.thread_id
          WHERE (${requestedThreadId} IS NULL OR p.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
          ORDER BY p.thread_id ASC, p.created_at ASC, p.plan_id ASC
        `;
      }
      return sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM (
          SELECT
            p.plan_id,
            p.thread_id,
            p.turn_id,
            p.plan_markdown,
            p.implemented_at,
            p.implementation_thread_id,
            p.created_at,
            p.updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY p.thread_id
              ORDER BY p.created_at DESC, p.plan_id DESC
            ) AS rn
          FROM projection_thread_proposed_plans p
          INNER JOIN projection_threads t ON t.thread_id = p.thread_id
          WHERE (${requestedThreadId} IS NULL OR p.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        )
        WHERE rn <= ${limit}
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `;
    },
  });

  const countThreadProposedPlanRows = SqlSchema.findAll({
    Request: SnapshotScopedCountRowsRequest,
    Result: ProjectionThreadChildCountDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      return sql`
        SELECT
          p.thread_id AS "threadId",
          COUNT(*) AS "count"
        FROM projection_thread_proposed_plans p
        INNER JOIN projection_threads t ON t.thread_id = p.thread_id
        WHERE (${requestedThreadId} IS NULL OR p.thread_id = ${requestedThreadId})
          AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        GROUP BY p.thread_id
      `;
    },
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: SnapshotScopedRowsRequest,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads, limit }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      if (limit === 0) {
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
          WHERE 1 = 0
        `;
      }
      if (limit === null) {
        return sql`
          SELECT
            a.activity_id AS "activityId",
            a.thread_id AS "threadId",
            a.turn_id AS "turnId",
            a.tone,
            a.kind,
            a.summary,
            a.payload_json AS "payload",
            a.sequence,
            a.created_at AS "createdAt"
          FROM projection_thread_activities a
          INNER JOIN projection_threads t ON t.thread_id = a.thread_id
          WHERE (${requestedThreadId} IS NULL OR a.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
          ORDER BY
            a.thread_id ASC,
            CASE WHEN a.sequence IS NULL THEN 0 ELSE 1 END ASC,
            a.sequence ASC,
            a.created_at ASC,
            a.activity_id ASC
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
          payload AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM (
          SELECT
            a.activity_id,
            a.thread_id,
            a.turn_id,
            a.tone,
            a.kind,
            a.summary,
            a.payload_json AS payload,
            a.sequence,
            a.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY a.thread_id
              ORDER BY
                CASE WHEN a.sequence IS NULL THEN 0 ELSE 1 END DESC,
                a.sequence DESC,
                a.created_at DESC,
                a.activity_id DESC
            ) AS rn
          FROM projection_thread_activities a
          INNER JOIN projection_threads t ON t.thread_id = a.thread_id
          WHERE (${requestedThreadId} IS NULL OR a.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        )
        WHERE rn <= ${limit}
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `;
    },
  });

  const countThreadActivityRows = SqlSchema.findAll({
    Request: SnapshotScopedCountRowsRequest,
    Result: ProjectionThreadChildCountDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      return sql`
        SELECT
          a.thread_id AS "threadId",
          COUNT(*) AS "count"
        FROM projection_thread_activities a
        INNER JOIN projection_threads t ON t.thread_id = a.thread_id
        WHERE (${requestedThreadId} IS NULL OR a.thread_id = ${requestedThreadId})
          AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        GROUP BY a.thread_id
      `;
    },
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

  const listOrchestratorWakeRows = SqlSchema.findAll({
    Request: SnapshotScopedWakeRowsRequest,
    Result: ProjectionOrchestratorWakeDbRowSchema,
    execute: ({ limit }) => {
      if (limit === null) {
        return sql`
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
        `;
      }
      return sql`
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
        FROM (
          SELECT *
          FROM projection_orchestrator_wakes
          ORDER BY queued_at DESC, wake_id DESC
          LIMIT ${limit}
        )
        ORDER BY queued_at ASC, wake_id ASC
      `;
    },
  });

  const countOrchestratorWakeRows = SqlSchema.findOne({
    Request: Schema.Void,
    Result: CountDbRowSchema,
    execute: () =>
      sql`
        SELECT COUNT(*) AS "count"
        FROM projection_orchestrator_wakes
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: SnapshotScopedRowsRequest,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads, limit }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      if (limit === 0) {
        return sql`
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
          WHERE 1 = 0
        `;
      }
      if (limit === null) {
        return sql`
          SELECT
            turns.thread_id AS "threadId",
            turns.turn_id AS "turnId",
            turns.checkpoint_turn_count AS "checkpointTurnCount",
            turns.checkpoint_ref AS "checkpointRef",
            turns.checkpoint_status AS "status",
            turns.checkpoint_files_json AS "files",
            turns.assistant_message_id AS "assistantMessageId",
            turns.completed_at AS "completedAt"
          FROM projection_turns turns
          INNER JOIN projection_threads t ON t.thread_id = turns.thread_id
          WHERE turns.checkpoint_turn_count IS NOT NULL
            AND (${requestedThreadId} IS NULL OR turns.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
          ORDER BY turns.thread_id ASC, turns.checkpoint_turn_count ASC
        `;
      }
      return sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM (
          SELECT
            turns.thread_id,
            turns.turn_id,
            turns.checkpoint_turn_count,
            turns.checkpoint_ref,
            turns.checkpoint_status,
            turns.checkpoint_files_json,
            turns.assistant_message_id,
            turns.completed_at,
            ROW_NUMBER() OVER (
              PARTITION BY turns.thread_id
              ORDER BY turns.checkpoint_turn_count DESC
            ) AS rn
          FROM projection_turns turns
          INNER JOIN projection_threads t ON t.thread_id = turns.thread_id
          WHERE turns.checkpoint_turn_count IS NOT NULL
            AND (${requestedThreadId} IS NULL OR turns.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        )
        WHERE rn <= ${limit}
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `;
    },
  });

  const countCheckpointRows = SqlSchema.findAll({
    Request: SnapshotScopedCountRowsRequest,
    Result: ProjectionThreadChildCountDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      return sql`
        SELECT
          turns.thread_id AS "threadId",
          COUNT(*) AS "count"
        FROM projection_turns turns
        INNER JOIN projection_threads t ON t.thread_id = turns.thread_id
        WHERE turns.checkpoint_turn_count IS NOT NULL
          AND (${requestedThreadId} IS NULL OR turns.thread_id = ${requestedThreadId})
          AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        GROUP BY turns.thread_id
      `;
    },
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: SnapshotScopedLatestTurnRowsRequest,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ requestedThreadId, includeArchivedThreads }) => {
      const includeArchived = includeArchivedThreads ? 1 : 0;
      return sql`
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
        FROM (
          SELECT
            turns.thread_id,
            turns.turn_id,
            turns.state,
            turns.requested_at,
            turns.started_at,
            turns.completed_at,
            turns.assistant_message_id,
            turns.source_proposed_plan_thread_id,
            turns.source_proposed_plan_id,
            ROW_NUMBER() OVER (
              PARTITION BY turns.thread_id
              ORDER BY turns.requested_at DESC, turns.turn_id DESC
            ) AS rn
          FROM projection_turns turns
          INNER JOIN projection_threads t ON t.thread_id = turns.thread_id
          WHERE turns.turn_id IS NOT NULL
            AND (${requestedThreadId} IS NULL OR turns.thread_id = ${requestedThreadId})
            AND (${includeArchived} = 1 OR t.archived_at IS NULL)
        )
        WHERE rn = 1
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `;
    },
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

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const profile = input?.profile ?? "operational";
          const requestedThreadId = input?.threadId;
          const bounds = resolveSnapshotBounds(profile);
          const includeArchivedThreads = bounds.includeArchivedThreads;
          const scopedRowsRequest = {
            requestedThreadId: requestedThreadId ?? null,
            includeArchivedThreads,
          };
          const [
            projectRows,
            programRows,
            programNotificationRows,
            threadRows,
            messageRows,
            messageCountRows,
            proposedPlanRows,
            proposedPlanCountRows,
            activityRows,
            activityCountRows,
            sessionRows,
            orchestratorWakeRows,
            orchestratorWakeCountRow,
            checkpointRows,
            checkpointCountRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listProgramRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listPrograms:query",
                  "ProjectionSnapshotQuery.getSnapshot:listPrograms:decodeRows",
                ),
              ),
            ),
            listProgramNotificationRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProgramNotifications:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProgramNotifications:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadMessageRows({ ...scopedRowsRequest, limit: bounds.messageLimit }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            countThreadMessageRows(scopedRowsRequest).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:countThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:countThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows({
              ...scopedRowsRequest,
              limit: bounds.proposedPlanLimit,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            countThreadProposedPlanRows(scopedRowsRequest).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:countThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:countThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows({ ...scopedRowsRequest, limit: bounds.activityLimit }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            countThreadActivityRows(scopedRowsRequest).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:countThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:countThreadActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listOrchestratorWakeRows({ limit: bounds.wakeItemLimit }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listOrchestratorWakes:query",
                  "ProjectionSnapshotQuery.getSnapshot:listOrchestratorWakes:decodeRows",
                ),
              ),
            ),
            countOrchestratorWakeRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:countOrchestratorWakes:query",
                  "ProjectionSnapshotQuery.getSnapshot:countOrchestratorWakes:decodeRows",
                ),
              ),
            ),
            listCheckpointRows({ ...scopedRowsRequest, limit: bounds.checkpointLimit }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            countCheckpointRows(scopedRowsRequest).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:countCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:countCheckpoints:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(scopedRowsRequest).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const scopedThreadRows = threadRows.filter((row) => {
            if (requestedThreadId !== undefined && row.threadId !== requestedThreadId) {
              return false;
            }
            return includeArchivedThreads || row.archivedAt === null;
          });
          const visibleThreadIds = new Set(scopedThreadRows.map((row) => row.threadId));
          const visibleProjectIds =
            requestedThreadId !== undefined
              ? new Set(scopedThreadRows.map((row) => row.projectId))
              : null;

          const messagesByThread = new Map<string, Array<OrchestrationMessage>>();
          const messageCountByThread = new Map(
            messageCountRows.map((row) => [row.threadId, row.count] as const),
          );
          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const proposedPlanCountByThread = new Map(
            proposedPlanCountRows.map((row) => [row.threadId, row.count] as const),
          );
          const activitiesByThread = new Map<string, Array<OrchestrationThreadActivity>>();
          const activityCountByThread = new Map(
            activityCountRows.map((row) => [row.threadId, row.count] as const),
          );
          const checkpointsByThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
          const checkpointCountByThread = new Map(
            checkpointCountRows.map((row) => [row.threadId, row.count] as const),
          );
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
          const orchestratorWakeItems: Array<OrchestratorWakeItem> = [];

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            if (visibleProjectIds !== null && !visibleProjectIds.has(row.projectId)) {
              continue;
            }
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of programRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of scopedThreadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          for (const row of messageRows) {
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null ? { attachments: row.attachments } : {}),
              turnId: row.turnId,
              streaming: row.isStreaming === 1,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            messagesByThread.set(row.threadId, threadMessages);
          }

          for (const row of proposedPlanRows) {
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadProposedPlans.push({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              implementedAt: row.implementedAt,
              implementationThreadId: row.implementationThreadId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            proposedPlansByThread.set(row.threadId, threadProposedPlans);
          }

          for (const row of activityRows) {
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
            updatedAt = maxIso(updatedAt, row.createdAt);
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push({
              id: row.activityId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              turnId: row.turnId,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            });
            activitiesByThread.set(row.threadId, threadActivities);
          }

          for (const row of checkpointRows) {
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
            updatedAt = maxIso(updatedAt, row.completedAt);
            const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
            threadCheckpoints.push({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              checkpointRef: row.checkpointRef,
              status: row.status,
              files: row.files,
              assistantMessageId: row.assistantMessageId,
              completedAt: row.completedAt,
            });
            checkpointsByThread.set(row.threadId, threadCheckpoints);
          }

          for (const row of latestTurnRows) {
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
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
              state:
                row.state === "error"
                  ? "error"
                  : row.state === "interrupted"
                    ? "interrupted"
                    : row.state === "completed"
                      ? "completed"
                      : "running",
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
            if (!visibleThreadIds.has(row.threadId)) {
              continue;
            }
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

          for (const row of orchestratorWakeRows) {
            updatedAt = maxIso(updatedAt, row.queuedAt);
            if (row.deliveredAt !== null) {
              updatedAt = maxIso(updatedAt, row.deliveredAt);
            }
            if (row.consumedAt !== null) {
              updatedAt = maxIso(updatedAt, row.consumedAt);
            }
            orchestratorWakeItems.push({
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
            });
          }

          const boundedWakeItems = takeTailBounded(
            orchestratorWakeItems,
            bounds.wakeItemLimit,
            orchestratorWakeCountRow.count,
          );

          const projects: ReadonlyArray<OrchestrationProject> = projectRows
            .filter((row) => visibleProjectIds === null || visibleProjectIds.has(row.projectId))
            .map((row) =>
              Object.assign(
                {
                  id: row.projectId,
                  title: row.title,
                  workspaceRoot: row.workspaceRoot,
                  kind: row.kind ?? "project",
                  defaultModelSelection: row.defaultModelSelection,
                  scripts: row.scripts,
                  hooks: row.hooks,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  deletedAt: row.deletedAt,
                },
                row.sidebarParentProjectId !== null
                  ? { sidebarParentProjectId: row.sidebarParentProjectId }
                  : undefined,
                row.currentSessionRootThreadId !== null
                  ? { currentSessionRootThreadId: row.currentSessionRootThreadId }
                  : undefined,
              ),
            );

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

          const threads: ReadonlyArray<OrchestrationThread> = scopedThreadRows.map((row) => {
            const boundedMessages = takeTailBounded(
              messagesByThread.get(row.threadId) ?? [],
              bounds.messageLimit,
              messageCountByThread.get(row.threadId) ?? 0,
            );
            const boundedProposedPlans = takeTailBounded(
              proposedPlansByThread.get(row.threadId) ?? [],
              bounds.proposedPlanLimit,
              proposedPlanCountByThread.get(row.threadId) ?? 0,
            );
            const boundedActivities = takeTailBounded(
              activitiesByThread.get(row.threadId) ?? [],
              bounds.activityLimit,
              activityCountByThread.get(row.threadId) ?? 0,
            );
            const boundedCheckpoints = takeTailBounded(
              checkpointsByThread.get(row.threadId) ?? [],
              bounds.checkpointLimit,
              checkpointCountByThread.get(row.threadId) ?? 0,
            );
            const coverageWarnings = [
              ...snapshotCoverageWarnings({
                label: `thread ${row.threadId} message`,
                totalCount: boundedMessages.totalCount,
              }),
              ...snapshotCoverageWarnings({
                label: `thread ${row.threadId} proposed plan`,
                totalCount: boundedProposedPlans.totalCount,
              }),
              ...snapshotCoverageWarnings({
                label: `thread ${row.threadId} activity`,
                totalCount: boundedActivities.totalCount,
              }),
              ...snapshotCoverageWarnings({
                label: `thread ${row.threadId} checkpoint`,
                totalCount: boundedCheckpoints.totalCount,
              }),
            ];

            return Object.assign(
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
                messages: boundedMessages.values,
                proposedPlans: boundedProposedPlans.values,
                activities: boundedActivities.values,
                checkpoints: boundedCheckpoints.values,
                snapshotCoverage: {
                  messageCount: boundedMessages.totalCount,
                  messageLimit: bounds.messageLimit,
                  messagesTruncated: boundedMessages.truncated,
                  proposedPlanCount: boundedProposedPlans.totalCount,
                  proposedPlanLimit: bounds.proposedPlanLimit,
                  proposedPlansTruncated: boundedProposedPlans.truncated,
                  activityCount: boundedActivities.totalCount,
                  activityLimit: bounds.activityLimit,
                  activitiesTruncated: boundedActivities.truncated,
                  checkpointCount: boundedCheckpoints.totalCount,
                  checkpointLimit: bounds.checkpointLimit,
                  checkpointsTruncated: boundedCheckpoints.truncated,
                  warnings: coverageWarnings,
                },
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
              row.programId !== null ? { programId: row.programId } : undefined,
              row.executiveProjectId !== null
                ? { executiveProjectId: row.executiveProjectId }
                : undefined,
              row.executiveThreadId !== null
                ? { executiveThreadId: row.executiveThreadId }
                : undefined,
            ) satisfies OrchestrationThread;
          });

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            snapshotProfile: profile,
            snapshotCoverage: {
              includeArchivedThreads,
              wakeItemCount: boundedWakeItems.totalCount,
              wakeItemLimit: bounds.wakeItemLimit,
              wakeItemsTruncated: boundedWakeItems.truncated,
              warnings: snapshotCoverageWarnings({
                label: "orchestrator wake",
                totalCount: boundedWakeItems.totalCount,
              }),
            },
            projects,
            programs,
            programNotifications,
            threads,
            orchestratorWakeItems: boundedWakeItems.values,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  return {
    getSnapshot,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
