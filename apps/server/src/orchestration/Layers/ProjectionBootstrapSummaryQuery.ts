import {
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationProjectKind,
  OrchestrationReadModel,
  ProgramNotificationEvidence,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ProjectHooks,
  ProjectScript,
  ThreadId,
  ThreadLabels,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationProject,
  type OrchestrationProgram,
  type OrchestrationProgramNotification,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestratorWakeItem,
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
import {
  decodeProjectionProgramDbRow,
  ProjectionProgramDbRowSchema,
  toOrchestrationProgram,
} from "../../persistence/programProjectionRow.ts";
import { ProjectionOrchestratorWake } from "../../persistence/Services/ProjectionOrchestratorWakes.ts";
import { ProjectionProgramNotification } from "../../persistence/Services/ProjectionProgramNotifications.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { resolveLocalThreadErrorPresentation } from "../localThreadErrorPresentation.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import {
  AgentsVxappExternalRoleAuthority,
  buildExternalRoleAuthorityIndex,
  type AgentsVxappRoleSessionRuntimePaths,
  type AgentsVxappExternalRoleAuthoritySnapshot,
} from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import { AgentsVxappControlPlane } from "../../extensions/vxapp/Services/AgentsVxappControlPlane.ts";
import { isAgentsVxappWorkspaceRoot } from "../../extensions/vxapp/agentsVxappAuthorityPaths.ts";
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

const ProjectionProgramNotificationDbRowSchema =
  ProjectionProgramNotification.mapFields(
    Struct.assign({
      evidence: Schema.fromJsonString(ProgramNotificationEvidence),
      consumeReason: Schema.NullOr(Schema.String),
      dropReason: Schema.NullOr(Schema.String),
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
  ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<
    Schema.Schema.Type<typeof ProjectionStateDbRowSchema>
  >,
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

function toPersistenceSqlOrDecodeError(
  sqlOperation: string,
  decodeOperation: string,
) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function missingRuntimePathAuthorityError() {
  return toPersistenceSqlError(
    "ProjectionBootstrapSummaryQuery.getRuntimePaths:missingAuthority",
  )(
    new Error(
      "vxapp projection boundary requires external role authority runtime paths.",
    ),
  );
}

function mergeProjectsWithExternal(
  localProjects: ReadonlyArray<OrchestrationProject>,
  externalSnapshot: AgentsVxappExternalRoleAuthoritySnapshot,
): OrchestrationProject[] {
  const externalIndex = buildExternalRoleAuthorityIndex(externalSnapshot);
  return [
    ...localProjects.filter(
      (project) =>
        !externalIndex.projectIds.has(project.id) &&
        !externalIndex.workspaceRoots.has(project.workspaceRoot),
    ),
    ...externalSnapshot.projects,
  ].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function mergeThreadsWithExternal(input: {
  localThreads: ReadonlyArray<OrchestrationThread>;
  externalSnapshot: AgentsVxappExternalRoleAuthoritySnapshot;
}): OrchestrationThread[] {
  const externalIndex = buildExternalRoleAuthorityIndex(input.externalSnapshot);
  const strippedLocalProjectIds = new Set(
    input.localThreads
      .filter(
        (thread) =>
          thread.worktreePath !== null &&
          externalIndex.worktreePaths.has(thread.worktreePath),
      )
      .map((thread) => thread.projectId),
  );
  return [
    ...input.localThreads.filter(
      (thread) =>
        !externalIndex.threadIds.has(thread.id) &&
        !externalIndex.projectIds.has(thread.projectId) &&
        !strippedLocalProjectIds.has(thread.projectId) &&
        !(
          thread.worktreePath !== null &&
          externalIndex.worktreePaths.has(thread.worktreePath)
        ),
    ),
    ...input.externalSnapshot.threadSummaries.map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      labels: thread.labels,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: thread.session,
      hasActiveError: thread.hasActiveError,
      activeError: thread.activeError,
      historicalError: thread.historicalError,
      errorPresentationSource: thread.errorPresentationSource,
      ...(thread.orchestratorProjectId !== undefined
        ? { orchestratorProjectId: thread.orchestratorProjectId }
        : {}),
      ...(thread.orchestratorThreadId !== undefined
        ? { orchestratorThreadId: thread.orchestratorThreadId }
        : {}),
      ...(thread.parentThreadId !== undefined
        ? { parentThreadId: thread.parentThreadId }
        : {}),
      ...(thread.spawnRole !== undefined
        ? { spawnRole: thread.spawnRole }
        : {}),
      ...(thread.spawnedBy !== undefined
        ? { spawnedBy: thread.spawnedBy }
        : {}),
      ...(thread.workflowId !== undefined
        ? { workflowId: thread.workflowId }
        : {}),
      ...(thread.programId !== undefined
        ? { programId: thread.programId }
        : {}),
      ...(thread.executiveProjectId !== undefined
        ? { executiveProjectId: thread.executiveProjectId }
        : {}),
      ...(thread.executiveThreadId !== undefined
        ? { executiveThreadId: thread.executiveThreadId }
        : {}),
    })),
  ].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function requireOwnerString(value: unknown, field: string): string {
  const normalized =
    typeof value === "string" && value.trim().length > 0 ? value : null;
  if (!normalized) {
    throw new Error(`vxapp owner export is missing ${field}.`);
  }
  return normalized;
}

function requireOwnerObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  const normalized =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!normalized) {
    throw new Error(`vxapp owner export is missing ${field}.`);
  }
  return normalized;
}

function mapOwnerProgramNotification(
  row: Record<string, unknown>,
): OrchestrationProgramNotification {
  const notificationId = requireOwnerString(
    row.notificationId ?? row.id,
    "notificationId",
  );
  const programId = requireOwnerString(row.programId, "programId");
  const executiveProjectId = requireOwnerString(
    row.executiveProjectId ?? row.projectId,
    "executiveProjectId",
  );
  const executiveThreadId = requireOwnerString(
    row.executiveThreadId ?? row.threadId,
    "executiveThreadId",
  );
  const orchestratorThreadId =
    typeof (row.orchestratorThreadId ?? row.threadId) === "string"
      ? ((row.orchestratorThreadId ?? row.threadId) as ThreadId)
      : null;
  return {
    notificationId: ProgramNotificationId.makeUnsafe(notificationId),
    programId: ProgramId.makeUnsafe(programId),
    executiveProjectId: ProjectId.makeUnsafe(executiveProjectId),
    executiveThreadId: ThreadId.makeUnsafe(executiveThreadId),
    orchestratorThreadId,
    kind: requireOwnerString(
      row.kind ?? row.notificationKind,
      "kind",
    ) as OrchestrationProgramNotification["kind"],
    severity: requireOwnerString(
      row.severity,
      "severity",
    ) as OrchestrationProgramNotification["severity"],
    summary: requireOwnerString(row.summary, "summary"),
    evidence: requireOwnerObject(row.evidence ?? row.source ?? {}, "evidence"),
    state: requireOwnerString(
      row.state,
      "state",
    ) as OrchestrationProgramNotification["state"],
    queuedAt: requireOwnerString(
      row.queuedAt ?? row.createdAt ?? row.updatedAt,
      "queuedAt",
    ),
    deliveredAt: typeof row.deliveredAt === "string" ? row.deliveredAt : null,
    consumedAt: typeof row.consumedAt === "string" ? row.consumedAt : null,
    droppedAt: typeof row.droppedAt === "string" ? row.droppedAt : null,
    consumeReason:
      typeof row.consumeReason === "string" ? row.consumeReason : undefined,
    dropReason: typeof row.dropReason === "string" ? row.dropReason : undefined,
    createdAt: requireOwnerString(
      row.createdAt ?? row.queuedAt ?? row.updatedAt,
      "createdAt",
    ),
    updatedAt: requireOwnerString(
      row.updatedAt ?? row.createdAt ?? row.queuedAt,
      "updatedAt",
    ),
  };
}

function mapOwnerProgram(program: {
  readonly id: ProgramId;
  readonly title: string;
  readonly objective: string | null;
  readonly status: string;
  readonly executiveProjectId: ProjectId | null;
  readonly executiveThreadId: ThreadId | null;
  readonly currentOrchestratorThreadId: ThreadId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly deletedAt: string | null;
}): OrchestrationProgram {
  if (
    program.executiveProjectId === null ||
    program.executiveThreadId === null
  ) {
    throw new Error(
      `vxapp owner snapshot is missing executive ids for program ${program.id}.`,
    );
  }
  return {
    id: program.id,
    title: program.title,
    objective: program.objective,
    status: program.status,
    declaredRepos: [],
    affectedAppTargets: [],
    requiredLocalSuites: [],
    requiredExternalE2ESuites: [],
    requireDevelopmentDeploy: false,
    requireExternalE2E: false,
    requireCleanPostFlight: false,
    requirePrPerRepo: false,
    executiveProjectId: program.executiveProjectId,
    executiveThreadId: program.executiveThreadId,
    currentOrchestratorThreadId: program.currentOrchestratorThreadId,
    repoPrs: [],
    localValidation: [],
    appValidations: [],
    observedRepos: [],
    postFlight: null,
    createdAt: program.createdAt,
    updatedAt: program.updatedAt,
    completedAt: program.completedAt,
    cancelReason: null,
    cancelledAt: null,
    supersededByProgramId: null,
    deletedAt: program.deletedAt,
  };
}

function applyBindingCurrentThreadToProjects(
  projects: ReadonlyArray<OrchestrationProject>,
  bindingAuthority: {
    jasper: { currentThread: { id: string; projectId: string } };
  } | null,
): OrchestrationProject[] {
  if (!bindingAuthority) {
    return [...projects];
  }
  const currentThread = bindingAuthority.jasper.currentThread;
  return projects.map((project) =>
    project.id === currentThread.projectId
      ? {
          ...project,
          currentSessionRootThreadId: currentThread.id as ThreadId,
        }
      : project,
  );
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
          declared_repos_json AS "declaredRepos",
          affected_app_targets_json AS "affectedAppTargets",
          required_local_suites_json AS "requiredLocalSuites",
          required_external_e2e_suites_json AS "requiredExternalE2ESuites",
          require_development_deploy AS "requireDevelopmentDeploy",
          require_external_e2e AS "requireExternalE2E",
          require_clean_post_flight AS "requireCleanPostFlight",
          require_pr_per_repo AS "requirePrPerRepo",
          executive_project_id AS "executiveProjectId",
          executive_thread_id AS "executiveThreadId",
          current_orchestrator_thread_id AS "currentOrchestratorThreadId",
          repo_prs_json AS "repoPrs",
          local_validation_json AS "localValidation",
          app_validations_json AS "appValidations",
          observed_repos_json AS "observedRepos",
          post_flight_json AS "postFlight",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          completed_at AS "completedAt",
          cancel_reason AS "cancelReason",
          cancelled_at AS "cancelledAt",
          superseded_by_program_id AS "supersededByProgramId",
          deleted_at AS "deletedAt"
        FROM projection_programs
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, program_id ASC
      `,
  });

  const listProgramNotificationRows = SqlSchema.findAll({
    // Local mirror path for native/non-vxapp workspaces only.
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

  const getExternalSnapshot = () =>
    Effect.serviceOption(AgentsVxappExternalRoleAuthority).pipe(
      Effect.flatMap((externalRoleAuthorityOption) =>
        Option.match(externalRoleAuthorityOption, {
          onNone: () =>
            Effect.succeed({
              projects: [],
              threadSummaries: [],
            } satisfies AgentsVxappExternalRoleAuthoritySnapshot),
          onSome: (externalRoleAuthority) =>
            externalRoleAuthority
              .getSnapshot()
              .pipe(
                Effect.mapError((error) =>
                  toPersistenceSqlError(
                    "ProjectionBootstrapSummaryQuery.externalRoleAuthority:query",
                  )(error),
                ),
              ),
        }),
      ),
    );
  const getRuntimePaths = (options?: { readonly requiredForBoundary?: boolean }) =>
    Effect.serviceOption(AgentsVxappExternalRoleAuthority).pipe(
      Effect.flatMap((externalRoleAuthorityOption) =>
        Option.match(externalRoleAuthorityOption, {
          onNone: () =>
            options?.requiredForBoundary
              ? Effect.fail(missingRuntimePathAuthorityError())
              : Effect.succeed<AgentsVxappRoleSessionRuntimePaths | null>(null),
          onSome: (externalRoleAuthority) =>
            externalRoleAuthority.getRuntimePaths().pipe(
              Effect.mapError(
                toPersistenceSqlError(
                  "ProjectionBootstrapSummaryQuery.getRuntimePaths:query",
                ),
              ),
            ),
        }),
      ),
    );

  const getBootstrapSummary: ProjectionBootstrapSummaryQueryShape["getBootstrapSummary"] =
    () =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const projectRows = yield* listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjects:query",
                  "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProjects:decodeRows",
                ),
              ),
            );
            const [
              programRows,
              threadRows,
              sessionRows,
              latestTurnRows,
              wakeRows,
              stateRows,
              externalSnapshot,
              runtimePaths,
            ] = yield* Effect.all([
              listProgramRows(undefined).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listPrograms:query",
                    "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listPrograms:decodeRows",
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
              getExternalSnapshot(),
              getRuntimePaths({
                requiredForBoundary: projectRows.length > 0,
              }),
            ]);

            const latestTurnByThread = new Map<
              string,
              OrchestrationLatestTurn
            >();
            const sessionsByThread = new Map<string, OrchestrationSession>();
            let updatedAt: string | null = null;
            const vxappBacked = projectRows.some((row) =>
              isAgentsVxappWorkspaceRoot(row.workspaceRoot, runtimePaths),
            );
            let bindingAuthority: {
              jasper: {
                currentThread: {
                  id: string;
                  projectId: string;
                };
              };
            } | null = null;
            let programNotificationRows: ReadonlyArray<OrchestrationProgramNotification> =
              [];
            let ownerPrograms: ReadonlyArray<OrchestrationProgram> | null =
              null;
            if (vxappBacked) {
              const controlPlane = yield* Effect.serviceOption(
                AgentsVxappControlPlane,
              ).pipe(
                Effect.flatMap((controlPlaneOption) =>
                  Option.match(controlPlaneOption, {
                    onNone: () =>
                      Effect.fail(
                        new Error(
                          "vxapp-backed bootstrap requires external control plane service.",
                        ),
                      ),
                    onSome: (service) => Effect.succeed(service),
                  }),
                ),
              );
              const [
                bindingAuthorityExport,
                notificationSummaryExport,
                ownerSnapshot,
              ] = yield* Effect.all([
                controlPlane.getBindingAuthorityExport(),
                controlPlane.getNotificationSummaryExport(),
                controlPlane.getSnapshot({}),
              ]);
              bindingAuthority = {
                jasper: {
                  currentThread: {
                    id: bindingAuthorityExport.jasper.currentThread.id,
                    projectId:
                      bindingAuthorityExport.jasper.currentThread.projectId,
                  },
                },
              };
              programNotificationRows =
                notificationSummaryExport.notifications.map(
                  mapOwnerProgramNotification,
                );
              ownerPrograms = ownerSnapshot.programs.map(mapOwnerProgram);
            } else {
              const localProgramNotificationRows =
                yield* listProgramNotificationRows(undefined).pipe(
                  Effect.mapError(
                    toPersistenceSqlOrDecodeError(
                      "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProgramNotifications:query",
                      "ProjectionBootstrapSummaryQuery.getBootstrapSummary:listProgramNotifications:decodeRows",
                    ),
                  ),
                );
              programNotificationRows = localProgramNotificationRows.map(
                (row) => ({
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
                }),
              );
            }

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
                ...(row.sourceProposedPlanThreadId !== null &&
                row.sourceProposedPlanId !== null
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
            for (const row of ownerPrograms ?? programRows) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }
            for (const row of programNotificationRows) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }
            for (const row of threadRows) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }
            for (const row of stateRows) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }

            const localProjects: ReadonlyArray<OrchestrationProject> =
              projectRows.map((row) =>
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
                    ? {
                        currentSessionRootThreadId:
                          row.currentSessionRootThreadId,
                      }
                    : undefined,
                ),
              );
            const projects = applyBindingCurrentThreadToProjects(
              mergeProjectsWithExternal(localProjects, externalSnapshot),
              bindingAuthority,
            );

            const programs: ReadonlyArray<OrchestrationProgram> =
              ownerPrograms ??
              programRows.map((row) =>
                toOrchestrationProgram(decodeProjectionProgramDbRow(row)),
              );

            const programNotifications = programNotificationRows;

            const vxappBackedProjectIds = new Set(
              projectRows
                .filter((row) =>
                  isAgentsVxappWorkspaceRoot(row.workspaceRoot, runtimePaths),
                )
                .map((row) => row.projectId),
            );
            const externalIndex =
              buildExternalRoleAuthorityIndex(externalSnapshot);
            const localCurrentAuthorityThreadRows = vxappBacked
              ? threadRows.filter(
                  (row) =>
                    !vxappBackedProjectIds.has(row.projectId) &&
                    !externalIndex.threadIds.has(row.threadId) &&
                    !(
                      row.worktreePath !== null &&
                      externalIndex.worktreePaths.has(row.worktreePath)
                    ),
                )
              : threadRows;

            const localThreads: ReadonlyArray<OrchestrationThread> =
              localCurrentAuthorityThreadRows.map(
                (row) =>
                  Object.assign(
                    {
                      ...resolveLocalThreadErrorPresentation({
                        archivedAt: row.archivedAt,
                        deletedAt: row.deletedAt,
                        latestTurnState: latestTurnByThread.get(row.threadId)
                          ?.state,
                        sessionStatus: sessionsByThread.get(row.threadId)
                          ?.status,
                        sessionLastError: sessionsByThread.get(row.threadId)
                          ?.lastError,
                      }),
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
                    row.parentThreadId !== null
                      ? { parentThreadId: row.parentThreadId }
                      : undefined,
                    row.spawnRole !== null
                      ? { spawnRole: row.spawnRole }
                      : undefined,
                    row.spawnedBy !== null
                      ? { spawnedBy: row.spawnedBy }
                      : undefined,
                    row.workflowId !== null
                      ? { workflowId: row.workflowId }
                      : undefined,
                    row.programId !== null
                      ? { programId: row.programId }
                      : undefined,
                    row.executiveProjectId !== null
                      ? { executiveProjectId: row.executiveProjectId }
                      : undefined,
                    row.executiveThreadId !== null
                      ? { executiveThreadId: row.executiveThreadId }
                      : undefined,
                  ) satisfies OrchestrationThread,
              );
            const threads = mergeThreadsWithExternal({
              localThreads,
              externalSnapshot,
            });

            const orchestratorWakeItems: ReadonlyArray<OrchestratorWakeItem> =
              vxappBacked
                ? []
                : wakeRows.map((row) =>
                    Object.assign(
                      {
                        wakeId: row.wakeId,
                        orchestratorThreadId: row.orchestratorThreadId,
                        orchestratorProjectId: row.orchestratorProjectId,
                        workerThreadId: row.workerThreadId,
                        workerProjectId: row.workerProjectId,
                        workerTurnId: row.workerTurnId,
                        workerTitleSnapshot: row.workerTitleSnapshot,
                        outcome: row.outcome,
                        summary: row.summary,
                        queuedAt: row.queuedAt,
                        state: row.state,
                        deliveredAt: row.deliveredAt,
                        consumedAt: row.consumedAt,
                      },
                      row.workflowId !== null
                        ? { workflowId: row.workflowId }
                        : undefined,
                      row.deliveryMessageId !== null
                        ? { deliveryMessageId: row.deliveryMessageId }
                        : undefined,
                      row.consumeReason !== null
                        ? { consumeReason: row.consumeReason }
                        : undefined,
                    ),
                  );

            return yield* decodeReadModel({
              snapshotSequence: computeSnapshotSequence(stateRows),
              snapshotProfile: "bootstrap-summary",
              projects,
              programs,
              programNotifications,
              threads,
              orchestratorWakeItems,
              updatedAt:
                [
                  updatedAt,
                  ...externalSnapshot.projects.map(
                    (project) => project.updatedAt,
                  ),
                  ...externalSnapshot.threadSummaries.map(
                    (thread) => thread.updatedAt,
                  ),
                  ...externalSnapshot.threadSummaries.flatMap((thread) =>
                    thread.session ? [thread.session.updatedAt] : [],
                  ),
                ]
                  .filter((value): value is string => value !== null)
                  .toSorted()
                  .at(-1) ?? new Date(0).toISOString(),
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
            return toPersistenceSqlError(
              "ProjectionBootstrapSummaryQuery.getBootstrapSummary:query",
            )(error);
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
