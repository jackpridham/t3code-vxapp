import { Effect, Layer, Schema } from "effect";
import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneError,
  type AgentsVxappAttentionSummaryExport,
  type AgentsVxappBindingAuthorityExport,
  type AgentsVxappControlPlaneShape,
  type AgentsVxappNotificationSummaryExport,
  type AgentsVxappOwnerProjectionAuthoritySnapshot,
  type AgentsVxappProgramsAuthoritySnapshot,
  type AgentsVxappProgramsAuthorityProgram,
  type AgentsVxappProgramAuthorityExport,
  type AgentsVxappWatchSummaryExport,
} from "../Services/AgentsVxappControlPlane.ts";
import {
  fetchAgentsVxappControlPlaneSnapshot,
  fetchAgentsVxappProgramsAuthoritySnapshot,
  fetchAgentsVxappProgramsTodosSnapshot,
  requestAgentsVxappProgramMutation,
  requestAgentsVxappTodoMutation,
  AgentsVxappOwnerClientError,
} from "../agentsVxappOwnerClient.ts";

type JsonRecord = Record<string, unknown>;

const isAgentsVxappControlPlaneError = Schema.is(AgentsVxappControlPlaneError);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function asRecordArray(value: unknown): ReadonlyArray<JsonRecord> {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function hasOwnerString(record: JsonRecord, ...fields: ReadonlyArray<string>): boolean {
  return fields.every((field) => asString(record[field]) !== null);
}

function isProjectionReadyNotification(record: JsonRecord): boolean {
  return (
    hasOwnerString(
      record,
      "programId",
      "executiveProjectId",
      "executiveThreadId",
      "kind",
      "severity",
      "summary",
      "state",
    ) &&
    asString(record.notificationId ?? record.id) !== null &&
    asString(record.queuedAt ?? record.createdAt ?? record.updatedAt) !== null &&
    asString(record.createdAt ?? record.queuedAt ?? record.updatedAt) !== null &&
    asString(record.updatedAt ?? record.createdAt ?? record.queuedAt) !== null
  );
}

function normalizeNotificationForProjection(record: JsonRecord): JsonRecord {
  return {
    ...record,
    orchestratorThreadId: asString(record.orchestratorThreadId),
    threadId: asString(record.threadId),
  };
}

function normalizeAttentionForProjection(record: JsonRecord): JsonRecord {
  const normalized: JsonRecord = {
    ...normalizeNotificationForProjection(record),
    sourceThreadId: asString(record.sourceThreadId),
  };
  if (asString(normalized.notificationId) !== null) {
    return normalized;
  }
  const attentionId = asString(normalized.attentionId ?? normalized.id);
  return attentionId ? { ...normalized, notificationId: attentionId } : normalized;
}

function isProjectionReadyAttention(record: JsonRecord): boolean {
  return (
    isProjectionReadyNotification(record) &&
    asString(record.attentionId ?? record.id ?? record.notificationId) !== null &&
    asString(record.attentionKey ?? record.id ?? record.attentionId) !== null
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapOwnerError(operation: string, cause: unknown): AgentsVxappControlPlaneError {
  if (isAgentsVxappControlPlaneError(cause)) {
    return cause;
  }
  if (cause instanceof AgentsVxappOwnerClientError) {
    return new AgentsVxappControlPlaneError({
      operation,
      detail: cause.message,
      cause,
      ownerCommand: cause.ownerCommand,
      authoritySurface: cause.authoritySurface,
      ownerErrorCode: cause.ownerErrorCode,
      authorityStore: cause.authorityStore,
      authoritySource: cause.authoritySource,
      contractFamily: cause.contractFamily,
      contractVersion: cause.contractVersion,
      exitCode: cause.exitCode,
      stdout: cause.stdout,
      stderr: cause.stderr,
      details: cause.details,
      hints: [...cause.hints],
    });
  }
  return new AgentsVxappControlPlaneError({
    operation,
    detail: cause instanceof Error ? cause.message : "agents-vxapp owner command failed.",
    cause,
  });
}

function ownerPromise<T>(
  operation: string,
  run: () => Promise<T>,
): Effect.Effect<T, AgentsVxappControlPlaneError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => mapOwnerError(operation, cause),
  });
}

function requireRecord<T>(operation: string, value: unknown, field: string): T {
  const record = asRecord(value);
  if (!record) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail: `Owner control-plane snapshot is missing ${field}.`,
    });
  }
  return record as T;
}

const OWNER_EXPORT_ENVELOPE = {
  authorityStore: "sqlite",
  authoritySource: "owner-command:t3code-control-plane-snapshot",
  legacyFallbackUsed: false,
} as const;

async function fetchControlPlaneSnapshotRecord(operation: string): Promise<JsonRecord> {
  const snapshot = await fetchAgentsVxappControlPlaneSnapshot();
  return requireRecord<JsonRecord>(operation, snapshot, "controlPlaneSnapshot");
}

function buildBindingAuthorityExport(
  operation: string,
  snapshot: JsonRecord,
): AgentsVxappBindingAuthorityExport {
  const selection = requireRecord<JsonRecord>(operation, snapshot.selection, "selection");
  const jasper = requireRecord<JsonRecord>(operation, selection.jasper, "selection.jasper");
  const thread = requireRecord<JsonRecord>(operation, jasper.thread, "selection.jasper.thread");
  const threadId = asString(thread.id);
  const programId = asString(thread.programId);
  const projectId = asString(thread.projectId);
  if (!threadId || !programId || !projectId) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail: "Owner control-plane snapshot is missing the Jasper binding thread identity.",
    });
  }
  return {
    ...OWNER_EXPORT_ENVELOPE,
    diagnostics: snapshot.diagnostics ?? selection.diagnostics ?? [],
    jasper: {
      ...jasper,
      currentThread: {
        ...thread,
        id: threadId,
        programId,
        projectId,
      },
      project: {
        currentSessionRootThreadId: threadId,
      },
    },
  };
}

function buildProgramAuthorityExport(snapshot: JsonRecord): AgentsVxappProgramAuthorityExport {
  const selection = asRecord(snapshot.selection);
  const activeProgram = asRecord(selection?.activeProgram);
  return {
    ...OWNER_EXPORT_ENVELOPE,
    action: activeProgram ? "active_program_selected" : "no_active_program",
    enabled: activeProgram !== null,
    mode: "owner-control-plane-snapshot",
  };
}

function buildAttentionSummaryExport(snapshot: JsonRecord): AgentsVxappAttentionSummaryExport {
  const attention = asRecordArray(snapshot.attention)
    .map(normalizeAttentionForProjection)
    .filter(isProjectionReadyAttention);
  const resolvedAttention = attention.filter(
    (item) => asString(item.state) === "resolved" || asString(item.resolvedAt) !== null,
  );
  return {
    ...OWNER_EXPORT_ENVELOPE,
    attention,
    resolvedAttention,
    passiveNotifications: [],
  };
}

function buildNotificationSummaryExport(
  snapshot: JsonRecord,
): AgentsVxappNotificationSummaryExport {
  const attention = asRecordArray(snapshot.attention)
    .map(normalizeAttentionForProjection)
    .filter(isProjectionReadyAttention);
  return {
    ...OWNER_EXPORT_ENVELOPE,
    notifications: asRecordArray(snapshot.notifications)
      .map(normalizeNotificationForProjection)
      .filter(isProjectionReadyNotification),
    attention,
  };
}

function buildWatchSummaryExport(snapshot: JsonRecord): AgentsVxappWatchSummaryExport {
  const watches = asRecordArray(snapshot.watches);
  const enabledWatch = watches.find((watch) => watch.enabled === true) ?? null;
  const selection = asRecord(snapshot.selection);
  const jasper = asRecord(selection?.jasper);
  return {
    ...OWNER_EXPORT_ENVELOPE,
    ...(Object.hasOwn(snapshot, "providerRequestStatus")
      ? { providerRequestStatus: snapshot.providerRequestStatus }
      : {}),
    ...(Object.hasOwn(snapshot, "providerRequest")
      ? { providerRequest: snapshot.providerRequest }
      : {}),
    ...(Object.hasOwn(snapshot, "failureCode") ? { failureCode: snapshot.failureCode } : {}),
    ...(Object.hasOwn(snapshot, "failureMessage")
      ? { failureMessage: snapshot.failureMessage }
      : {}),
    enabledPrograms: watches.flatMap((watch) => {
      const programId = asString(watch.programId);
      return watch.enabled === true && programId ? [programId] : [];
    }),
    state: {
      watches,
    },
    classification: enabledWatch ? asString(enabledWatch.classification) : null,
    recommendedAction: enabledWatch ? asString(enabledWatch.reason) : null,
    program: asRecord(selection?.activeProgram),
    currentOrchestratorThread: asRecord(jasper?.thread),
    wakeDecision: asRecordArray(snapshot.wakes)[0] ?? null,
  };
}

function requireSnapshotString(value: unknown, field: string): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new Error(`Owner Programs authority snapshot is missing ${field}.`);
  }
  return normalized;
}

function normalizeProgramAuthorityProgram(
  program: JsonRecord,
): AgentsVxappProgramsAuthorityProgram {
  const executiveProjectId = asString(program.executiveProjectId ?? program.executive_project_id);
  const executiveThreadId = asString(program.executiveThreadId ?? program.executive_thread_id);
  const currentOrchestratorThreadId = asString(
    program.currentOrchestratorThreadId ?? program.current_orchestrator_thread_id,
  );
  return {
    ...program,
    id: ProgramId.makeUnsafe(requireSnapshotString(program.id ?? program.program_id, "program id")),
    title: requireSnapshotString(program.title, "program title"),
    objective: asString(program.objective),
    status: requireSnapshotString(
      program.status ?? program.current_status ?? program.base_status,
      "program status",
    ),
    executiveProjectId: executiveProjectId ? ProjectId.makeUnsafe(executiveProjectId) : null,
    executiveThreadId: executiveThreadId ? ThreadId.makeUnsafe(executiveThreadId) : null,
    currentOrchestratorThreadId: currentOrchestratorThreadId
      ? ThreadId.makeUnsafe(currentOrchestratorThreadId)
      : null,
    createdAt: requireSnapshotString(program.createdAt ?? program.created_at, "createdAt"),
    updatedAt: requireSnapshotString(program.updatedAt ?? program.updated_at, "updatedAt"),
    completedAt: asString(program.completedAt ?? program.completed_at),
    deletedAt: asString(program.deletedAt ?? program.deleted_at),
  };
}

function normalizeProgramsAuthoritySnapshot(
  snapshot: JsonRecord,
): AgentsVxappProgramsAuthoritySnapshot {
  return {
    ...snapshot,
    programs: asRecordArray(snapshot.programs).flatMap((program) => {
      try {
        return [normalizeProgramAuthorityProgram(program)];
      } catch {
        return [];
      }
    }),
  };
}

const makeAgentsVxappControlPlane = Effect.succeed({
  getBindingAuthorityExport: () =>
    ownerPromise("ownerControlPlane.bindingAuthority.getSnapshot", () =>
      fetchControlPlaneSnapshotRecord("bindingAuthority").then((snapshot) =>
        buildBindingAuthorityExport("bindingAuthority", snapshot),
      ),
    ),
  getProgramAuthorityExport: () =>
    ownerPromise("ownerControlPlane.programAuthority.getSnapshot", () =>
      fetchControlPlaneSnapshotRecord("programAuthority").then(buildProgramAuthorityExport),
    ),
  getAttentionSummaryExport: () =>
    ownerPromise("ownerControlPlane.attentionSummary.getSnapshot", () =>
      fetchControlPlaneSnapshotRecord("attentionSummary").then(buildAttentionSummaryExport),
    ),
  getNotificationSummaryExport: () =>
    ownerPromise("ownerControlPlane.notificationSummary.getSnapshot", () =>
      fetchControlPlaneSnapshotRecord("notificationSummary").then(buildNotificationSummaryExport),
    ),
  getWatchSummaryExport: () =>
    ownerPromise("ownerControlPlane.watchSummary.getSnapshot", () =>
      fetchControlPlaneSnapshotRecord("watchSummary").then(buildWatchSummaryExport),
    ),
  getProjectionAuthoritySnapshot: () =>
    ownerPromise("ownerControlPlane.getSnapshot", async () => {
      const payload = await fetchAgentsVxappControlPlaneSnapshot();
      return {
        contractFamily: asString(payload.contractFamily),
        contractVersion: asString(payload.contractVersion),
        exportPath: "owner-command:control_plane_snapshot",
        fetchedAt: nowIso(),
        payload,
      } satisfies AgentsVxappOwnerProjectionAuthoritySnapshot;
    }),
  getProgramsAuthoritySnapshot: () =>
    ownerPromise("ownerControlPlane.programsAuthority.getSnapshot", () =>
      fetchAgentsVxappProgramsAuthoritySnapshot().then(normalizeProgramsAuthoritySnapshot),
    ),
  getProgramsTodosSnapshot: (input) =>
    ownerPromise("ownerControlPlane.programsTodos.getProgramsTodosSnapshot", () =>
      fetchAgentsVxappProgramsTodosSnapshot(input),
    ),
  createProgram: (input) =>
    ownerPromise("ownerControlPlane.program.create", () =>
      requestAgentsVxappProgramMutation({ action: "create", input }),
    ),
  updateProgram: (input) =>
    ownerPromise("ownerControlPlane.program.update", () =>
      requestAgentsVxappProgramMutation({ action: "update", input }),
    ),
  deleteProgram: (input) =>
    ownerPromise("ownerControlPlane.program.delete", () =>
      requestAgentsVxappProgramMutation({ action: "delete", input }),
    ),
  setProgramLifecycle: (input) =>
    ownerPromise("ownerControlPlane.program.lifecycle", () =>
      requestAgentsVxappProgramMutation({ action: "lifecycle", input }),
    ),
  createTodo: (input) =>
    ownerPromise("ownerControlPlane.todo.create", () =>
      requestAgentsVxappTodoMutation({ action: "create", input }),
    ),
  updateTodo: (input) =>
    ownerPromise("ownerControlPlane.todo.update", () =>
      requestAgentsVxappTodoMutation({ action: "update", input }),
    ),
  deleteTodo: (input) =>
    ownerPromise("ownerControlPlane.todo.delete", () =>
      requestAgentsVxappTodoMutation({ action: "delete", input }),
    ),
} satisfies AgentsVxappControlPlaneShape);

export const AgentsVxappControlPlaneLive = Layer.effect(
  AgentsVxappControlPlane,
  makeAgentsVxappControlPlane,
);
