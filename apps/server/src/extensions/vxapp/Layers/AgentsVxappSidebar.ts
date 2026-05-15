import { ProgramId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import type {
  OrchestrationLatestTurn,
  OrchestrationLatestTurnState,
  OrchestrationSession,
  OrchestrationSessionStatus,
  ServerAgentsVxappSidebarAttentionItem,
  ServerAgentsVxappSidebarMirrorDiagnostics,
  ServerAgentsVxappSidebarProgramNotification,
  ServerAgentsVxappSidebarThreadLink,
  ServerAgentsVxappSidebarWake,
  ServerAgentsVxappSidebarWatchProjection,
  ServerGetAgentsVxappSidebarGraphResult,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import {
  AgentsVxappSidebar,
  AgentsVxappSidebarError,
  type AgentsVxappSidebarShape,
} from "../Services/AgentsVxappSidebar.ts";
import {
  AgentsVxappControlPlane,
  type AgentsVxappBindingAuthorityExport,
  type AgentsVxappWatchSummaryExport,
} from "../Services/AgentsVxappControlPlane.ts";
import {
  AgentsVxappExternalRoleAuthority,
  buildExternalRoleAuthorityIndex,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";
import {
  AGENTS_VXAPP_DB_PATH,
  type AgentsVxappSqliteRow,
  withAgentsVxappSqliteReadonly,
} from "../agentsVxappSqlite";
const VALID_SESSION_STATUSES = new Set([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
const VALID_TURN_STATES = new Set(["running", "interrupted", "completed", "error"]);
const VALID_NOTIFICATION_SEVERITIES = new Set(["critical", "warning", "info"]);
const EMPTY_MIRROR_DIAGNOSTICS: ServerAgentsVxappSidebarMirrorDiagnostics = {
  missingProjectIds: [],
  missingThreadIds: [],
  staleMirror: false,
};

const ProjectionProjectIdRow = Schema.Struct({ projectId: ProjectId });
const ProjectionThreadIdRow = Schema.Struct({ threadId: ThreadId });

function toProgramId(value: unknown): ProgramId {
  return ProgramId.makeUnsafe(String(value));
}

function toProjectIdOrNull(value: unknown): ProjectId | null {
  const normalized = asString(value);
  return normalized ? ProjectId.makeUnsafe(normalized) : null;
}

function toThreadIdOrNull(value: unknown): ThreadId | null {
  const normalized = asString(value);
  return normalized ? ThreadId.makeUnsafe(normalized) : null;
}

function toTurnIdOrNull(value: unknown): TurnId | null {
  const normalized = asString(value);
  return normalized ? TurnId.makeUnsafe(normalized) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asIsoDateTime(value: unknown): string | null {
  const normalized = asString(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asStringArrayFromJson(value: unknown): string[] {
  const raw = asString(value);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

function normalizeNotificationSeverity(
  value: unknown,
): ServerAgentsVxappSidebarProgramNotification["severity"] {
  const severity = asString(value);
  return severity && VALID_NOTIFICATION_SEVERITIES.has(severity)
    ? (severity as ServerAgentsVxappSidebarProgramNotification["severity"])
    : "info";
}

function requireOwnerString(value: unknown, field: string): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new AgentsVxappSidebarError({
      message: `vxapp owner export is missing ${field}.`,
    });
  }
  return normalized;
}

function requireOwnerObject(value: unknown, field: string): Record<string, unknown> {
  const normalized =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!normalized) {
    throw new AgentsVxappSidebarError({
      message: `vxapp owner export is missing ${field}.`,
    });
  }
  return normalized;
}

function mapSession(row: AgentsVxappSqliteRow, threadId: ThreadId): OrchestrationSession | null {
  const session = asJsonRecord(row.session_json);
  const status = asString(session?.status);
  const updatedAt = asIsoDateTime(session?.updatedAt);
  if (!session || !status || !VALID_SESSION_STATUSES.has(status) || !updatedAt) {
    return null;
  }
  return {
    threadId,
    status: status as OrchestrationSessionStatus,
    providerName: asString(session.providerName),
    runtimeMode: "full-access" as const,
    activeTurnId: toTurnIdOrNull(session.activeTurnId),
    lastError: asString(session.lastError),
    updatedAt,
  };
}

function mapLatestTurn(row: AgentsVxappSqliteRow): OrchestrationLatestTurn | null {
  const latestTurn = asJsonRecord(row.latest_turn_json);
  const turnId = asString(latestTurn?.id);
  const state = asString(latestTurn?.status);
  const requestedAt = asIsoDateTime(latestTurn?.requestedAt);
  if (!latestTurn || !turnId || !state || !VALID_TURN_STATES.has(state) || !requestedAt) {
    return null;
  }
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: state as OrchestrationLatestTurnState,
    requestedAt,
    startedAt: asIsoDateTime(latestTurn.startedAt),
    completedAt: asIsoDateTime(latestTurn.completedAt),
    assistantMessageId: null,
  };
}

function mapThreadLink(row: AgentsVxappSqliteRow): ServerAgentsVxappSidebarThreadLink {
  const threadId = ThreadId.makeUnsafe(String(row.thread_id));
  return {
    threadId,
    projectId: toProjectIdOrNull(row.project_id),
    workspaceRoot: asString(row.workspace_root),
    worktreePath: asString(row.worktree_path),
    title: typeof row.title === "string" ? row.title : null,
    spawnRole: asString(row.spawn_role),
    spawnedBy: asString(row.spawned_by),
    parentThreadId: toThreadIdOrNull(row.parent_thread_id),
    workflowId: asString(row.workflow_id),
    programId: row.program_id ? toProgramId(row.program_id) : null,
    executiveProjectId: toProjectIdOrNull(row.executive_project_id),
    executiveThreadId: toThreadIdOrNull(row.executive_thread_id),
    orchestratorThreadId: toThreadIdOrNull(row.orchestrator_thread_id),
    labels: asStringArrayFromJson(row.labels_json),
    session: mapSession(row, threadId),
    latestTurn: mapLatestTurn(row),
    metadata: asJsonRecord(row.metadata_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: asIsoDateTime(row.archived_at),
    deletedAt: asIsoDateTime(row.deleted_at),
  };
}

function mapWake(row: AgentsVxappSqliteRow): ServerAgentsVxappSidebarWake {
  return {
    wakeId: String(row.wake_id),
    orchestratorThreadId: ThreadId.makeUnsafe(String(row.orchestrator_thread_id)),
    programId: row.program_id ? toProgramId(row.program_id) : null,
    state: String(row.state),
    reason: asString(row.reason),
    payload: asJsonRecord(row.payload_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    settledAt: asIsoDateTime(row.settled_at),
  };
}

function mapOwnerNotification(
  row: Record<string, unknown>,
): ServerAgentsVxappSidebarProgramNotification {
  return {
    notificationId: requireOwnerString(row.notificationId ?? row.id, "notificationId"),
    programId: asString(row.programId) ? toProgramId(row.programId) : null,
    executiveProjectId: toProjectIdOrNull(row.executiveProjectId ?? row.projectId),
    executiveThreadId: toThreadIdOrNull(row.executiveThreadId ?? row.threadId),
    orchestratorThreadId: toThreadIdOrNull(row.orchestratorThreadId ?? row.threadId),
    kind: requireOwnerString(row.kind ?? row.notificationKind, "kind"),
    severity: normalizeNotificationSeverity(row.severity),
    summary: requireOwnerString(row.summary, "summary"),
    evidence: asJsonRecord(row.evidence ?? row.source),
    state: requireOwnerString(row.state, "state"),
    queuedAt: requireOwnerString(
      row.queuedAt ?? row.queued_at ?? row.createdAt ?? row.created_at,
      "queuedAt",
    ),
    deliveredAt: asIsoDateTime(row.deliveredAt ?? row.delivered_at),
    consumedAt: asIsoDateTime(row.consumedAt ?? row.consumed_at),
    droppedAt: asIsoDateTime(row.droppedAt ?? row.dropped_at),
    consumeReason: asString(row.consumeReason ?? row.consume_reason),
    dropReason: asString(row.dropReason ?? row.drop_reason),
    createdAt: requireOwnerString(
      row.createdAt ?? row.created_at ?? row.queuedAt ?? row.queued_at,
      "createdAt",
    ),
    updatedAt: requireOwnerString(
      row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.createdAt,
      "updatedAt",
    ),
  };
}

function mapOwnerAttentionItem(
  row: Record<string, unknown>,
): ServerAgentsVxappSidebarAttentionItem {
  return {
    attentionId: requireOwnerString(row.attentionId ?? row.id ?? row.notificationId, "attentionId"),
    attentionKey: asString(row.attentionKey ?? row.id ?? row.attentionId),
    notificationId: asString(row.notificationId),
    programId: asString(row.programId) ? toProgramId(row.programId) : null,
    executiveProjectId: toProjectIdOrNull(row.executiveProjectId ?? row.projectId),
    executiveThreadId: toThreadIdOrNull(row.executiveThreadId ?? row.threadId),
    sourceThreadId: toThreadIdOrNull(row.sourceThreadId ?? row.threadId),
    sourceRole: asString(row.sourceRole ?? row.sourceKind),
    kind: requireOwnerString(row.kind ?? row.notificationKind, "kind"),
    severity: normalizeNotificationSeverity(row.severity),
    summary: requireOwnerString(row.summary, "summary"),
    evidence: asJsonRecord(row.evidence ?? row.source),
    state: requireOwnerString(row.state, "state"),
    queuedAt: requireOwnerString(
      row.queuedAt ?? row.queued_at ?? row.createdAt ?? row.created_at,
      "queuedAt",
    ),
    acknowledgedAt: asIsoDateTime(row.acknowledgedAt ?? row.acknowledged_at),
    resolvedAt: asIsoDateTime(row.resolvedAt ?? row.resolved_at),
    droppedAt: asIsoDateTime(row.droppedAt ?? row.dropped_at),
    createdAt: requireOwnerString(
      row.createdAt ?? row.created_at ?? row.queuedAt ?? row.queued_at,
      "createdAt",
    ),
    updatedAt: requireOwnerString(
      row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.createdAt,
      "updatedAt",
    ),
  };
}

function mapOwnerWatchProjections(
  watchSummary: AgentsVxappWatchSummaryExport,
  bindingAuthority: AgentsVxappBindingAuthorityExport | null,
): ServerAgentsVxappSidebarWatchProjection[] {
  const state = requireOwnerObject(watchSummary.state, "state");
  const summaryProgramId =
    asString((watchSummary.program as Record<string, unknown> | null)?.id) ?? null;
  const bindingProgramId = bindingAuthority?.jasper.currentThread.programId ?? null;
  const enabledProgramId =
    watchSummary.enabledPrograms.length === 1 ? watchSummary.enabledPrograms[0] : null;
  const programId = summaryProgramId ?? enabledProgramId ?? bindingProgramId;
  if (!programId) {
    throw new AgentsVxappSidebarError({
      message: "watch-summary.json is missing a program id.",
    });
  }
  if (summaryProgramId && bindingProgramId && summaryProgramId !== bindingProgramId) {
    throw new AgentsVxappSidebarError({
      message: "watch-summary.json program id does not match binding authority.",
    });
  }

  const enabled =
    typeof state.enabled === "boolean"
      ? state.enabled
      : watchSummary.enabledPrograms.includes(programId);
  const classification = asString(watchSummary.classification ?? state.classification);
  const reason = asString(
    state.reason ?? state.recommendedAction ?? watchSummary.recommendedAction ?? null,
  );
  const signature = asString(state.signature ?? state.lastSignature);
  const lastEvaluatedAt = asIsoDateTime(state.last_evaluated_at ?? state.lastEvaluatedAt);
  const updatedAt = asIsoDateTime(state.updated_at ?? state.updatedAt);
  if (!signature || !lastEvaluatedAt || !updatedAt) {
    throw new AgentsVxappSidebarError({
      message: "watch-summary.json state is missing signature or timestamps.",
    });
  }

  return [
    {
      programId: ProgramId.makeUnsafe(programId),
      enabled,
      classification,
      reason,
      signature,
      suppression: asJsonRecord(state.suppression),
      metadata: asJsonRecord(state.metadata),
      lastEvaluatedAt,
      updatedAt,
    },
  ];
}

function buildMirrorDiagnostics(input: {
  graph: Omit<ServerGetAgentsVxappSidebarGraphResult, "mirrorDiagnostics">;
  projectionProjectIds: readonly ProjectId[];
  projectionThreadIds: readonly ThreadId[];
  ignoredProjectIds?: ReadonlySet<ProjectId>;
  ignoredThreadIds?: ReadonlySet<ThreadId>;
}): ServerAgentsVxappSidebarMirrorDiagnostics {
  const projectionProjectIds = new Set(input.projectionProjectIds);
  const projectionThreadIds = new Set(input.projectionThreadIds);
  const ignoredProjectIds = input.ignoredProjectIds ?? new Set<ProjectId>();
  const ignoredThreadIds = input.ignoredThreadIds ?? new Set<ThreadId>();
  const missingProjectIds = new Set<ProjectId>();
  const missingThreadIds = new Set<ThreadId>();

  for (const threadLink of input.graph.threadLinks) {
    if (
      threadLink.projectId &&
      !ignoredProjectIds.has(threadLink.projectId) &&
      !projectionProjectIds.has(threadLink.projectId)
    ) {
      missingProjectIds.add(threadLink.projectId);
    }
    if (
      !ignoredThreadIds.has(threadLink.threadId) &&
      !projectionThreadIds.has(threadLink.threadId)
    ) {
      missingThreadIds.add(threadLink.threadId);
    }
    if (
      threadLink.executiveProjectId &&
      !ignoredProjectIds.has(threadLink.executiveProjectId) &&
      !projectionProjectIds.has(threadLink.executiveProjectId)
    ) {
      missingProjectIds.add(threadLink.executiveProjectId);
    }
    if (
      threadLink.executiveThreadId &&
      !ignoredThreadIds.has(threadLink.executiveThreadId) &&
      !projectionThreadIds.has(threadLink.executiveThreadId)
    ) {
      missingThreadIds.add(threadLink.executiveThreadId);
    }
    if (
      threadLink.orchestratorThreadId &&
      !ignoredThreadIds.has(threadLink.orchestratorThreadId) &&
      !projectionThreadIds.has(threadLink.orchestratorThreadId)
    ) {
      missingThreadIds.add(threadLink.orchestratorThreadId);
    }
    if (
      threadLink.parentThreadId &&
      !ignoredThreadIds.has(threadLink.parentThreadId) &&
      !projectionThreadIds.has(threadLink.parentThreadId)
    ) {
      missingThreadIds.add(threadLink.parentThreadId);
    }
  }

  return {
    missingProjectIds: [...missingProjectIds].toSorted(),
    missingThreadIds: [...missingThreadIds].toSorted(),
    staleMirror: missingProjectIds.size > 0 || missingThreadIds.size > 0,
  };
}

function buildSidebarGraphFromQueryAll(
  queryAll: (sql: string) => AgentsVxappSqliteRow[],
): Omit<ServerGetAgentsVxappSidebarGraphResult, "mirrorDiagnostics"> {
  const threadLinks = queryAll(
    "SELECT * FROM t3_thread_links WHERE deleted_at IS NULL ORDER BY updated_at DESC",
  ).map(mapThreadLink);
  const openWakes = queryAll(
    "SELECT * FROM t3_wake_items WHERE settled_at IS NULL ORDER BY updated_at DESC",
  ).map(mapWake);

  return {
    source: "sqlite",
    dbPath: AGENTS_VXAPP_DB_PATH,
    fallbackReason: null,
    threadLinks,
    openWakes,
    watchProjections: [],
    notifications: [],
    attentionItems: [],
  };
}

const makeAgentsVxappSidebar = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const sql = yield* SqlClient.SqlClient;
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

  const getGraph: AgentsVxappSidebarShape["getGraph"] = (_input) =>
    Effect.gen(function* () {
      const exists = yield* fileSystem
        .exists(AGENTS_VXAPP_DB_PATH)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return {
          source: "unavailable" as const,
          dbPath: AGENTS_VXAPP_DB_PATH,
          fallbackReason: "agents-vxapp SQLite database not found.",
          threadLinks: [],
          openWakes: [],
          watchProjections: [],
          notifications: [],
          attentionItems: [],
          mirrorDiagnostics: EMPTY_MIRROR_DIAGNOSTICS,
        } satisfies ServerGetAgentsVxappSidebarGraphResult;
      }

      const graph = yield* Effect.tryPromise({
        try: async () => {
          return withAgentsVxappSqliteReadonly((queryAll) =>
            buildSidebarGraphFromQueryAll(queryAll),
          );
        },
        catch: (error) =>
          new AgentsVxappSidebarError({
            message:
              error instanceof Error ? error.message : "Failed to query agents-vxapp SQLite.",
          }),
      });

      const controlPlane = yield* Effect.serviceOption(AgentsVxappControlPlane).pipe(
        Effect.flatMap((controlPlaneOption) =>
          Option.match(controlPlaneOption, {
            onNone: () =>
              Effect.fail(
                new AgentsVxappSidebarError({
                  message: "vxapp sidebar requires the external control plane service.",
                }),
              ),
            onSome: (service) => Effect.succeed(service),
          }),
        ),
      );
      const [
        bindingAuthority,
        watchSummaryExport,
        notificationSummaryExport,
        attentionSummaryExport,
      ] = yield* Effect.all([
        controlPlane.getBindingAuthorityExport(),
        controlPlane.getWatchSummaryExport(),
        controlPlane.getNotificationSummaryExport(),
        controlPlane.getAttentionSummaryExport(),
      ]).pipe(
        Effect.mapError(
          (error) =>
            new AgentsVxappSidebarError({
              message: error instanceof Error ? error.message : "Failed to read owner exports.",
            }),
        ),
      );
      const ownerWatchProjections = mapOwnerWatchProjections(watchSummaryExport, bindingAuthority);
      const ownerNotifications = notificationSummaryExport.notifications.map(mapOwnerNotification);
      const ownerAttentionItems = attentionSummaryExport.attention.map(mapOwnerAttentionItem);

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

      const externalRoleIndex = yield* Effect.serviceOption(AgentsVxappExternalRoleAuthority).pipe(
        Effect.flatMap((externalRoleAuthorityOption) =>
          Option.match(externalRoleAuthorityOption, {
            onNone: () => Effect.succeed(null),
            onSome: (externalRoleAuthority) =>
              externalRoleAuthority.getSnapshot().pipe(
                Effect.map(buildExternalRoleAuthorityIndex),
                Effect.mapError(
                  (error) =>
                    new AgentsVxappSidebarError({
                      message: error.detail,
                    }),
                ),
              ),
          }),
        ),
      );

      return {
        ...graph,
        watchProjections: ownerWatchProjections,
        notifications: ownerNotifications,
        attentionItems: ownerAttentionItems,
        mirrorDiagnostics: buildMirrorDiagnostics(
          Object.assign(
            {
              graph,
              projectionProjectIds: projectionProjectRows.map((row) => row.projectId),
              projectionThreadIds: projectionThreadRows.map((row) => row.threadId),
            },
            externalRoleIndex
              ? {
                  ignoredProjectIds: externalRoleIndex.projectIds,
                  ignoredThreadIds: externalRoleIndex.threadIds,
                }
              : undefined,
          ),
        ),
      } satisfies ServerGetAgentsVxappSidebarGraphResult;
    });

  return {
    getGraph,
  } satisfies AgentsVxappSidebarShape;
});

export const AgentsVxappSidebarLive = Layer.effect(AgentsVxappSidebar, makeAgentsVxappSidebar);
