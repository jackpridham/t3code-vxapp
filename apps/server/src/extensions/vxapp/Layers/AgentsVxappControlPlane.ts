import { Effect, Layer, Schema } from "effect";

import {
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneError,
  type AgentsVxappAttentionSummaryExport,
  type AgentsVxappBindingAuthorityExport,
  type AgentsVxappControlPlaneShape,
  type AgentsVxappNotificationSummaryExport,
  type AgentsVxappOwnerProjectionAuthoritySnapshot,
  type AgentsVxappProgramAuthorityExport,
  type AgentsVxappWatchSummaryExport,
} from "../Services/AgentsVxappControlPlane.ts";
import {
  fetchAgentsVxappControlPlaneSnapshot,
  fetchAgentsVxappProgramsTodosSnapshot,
  requestAgentsVxappProgramMutation,
  requestAgentsVxappTodoMutation,
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

function nowIso(): string {
  return new Date().toISOString();
}

function mapOwnerError(operation: string, cause: unknown): AgentsVxappControlPlaneError {
  if (isAgentsVxappControlPlaneError(cause)) {
    return cause;
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

async function fetchControlPlaneField<T>(operation: string, field: string): Promise<T> {
  const snapshot = await fetchAgentsVxappControlPlaneSnapshot();
  return requireRecord<T>(operation, snapshot[field], field);
}

const makeAgentsVxappControlPlane = Effect.succeed({
  getBindingAuthorityExport: () =>
    ownerPromise("ownerControlPlane.bindingAuthority.getSnapshot", () =>
      fetchControlPlaneField<AgentsVxappBindingAuthorityExport>(
        "bindingAuthority",
        "bindingAuthority",
      ),
    ),
  getProgramAuthorityExport: () =>
    ownerPromise("ownerControlPlane.programAuthority.getSnapshot", () =>
      fetchControlPlaneField<AgentsVxappProgramAuthorityExport>(
        "programAuthority",
        "programAuthority",
      ),
    ),
  getAttentionSummaryExport: () =>
    ownerPromise("ownerControlPlane.attentionSummary.getSnapshot", () =>
      fetchControlPlaneField<AgentsVxappAttentionSummaryExport>(
        "attentionSummary",
        "attentionSummary",
      ),
    ),
  getNotificationSummaryExport: () =>
    ownerPromise("ownerControlPlane.notificationSummary.getSnapshot", () =>
      fetchControlPlaneField<AgentsVxappNotificationSummaryExport>(
        "notificationSummary",
        "notificationSummary",
      ),
    ),
  getWatchSummaryExport: () =>
    ownerPromise("ownerControlPlane.watchSummary.getSnapshot", () =>
      fetchControlPlaneField<AgentsVxappWatchSummaryExport>("watchSummary", "watchSummary"),
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
  getSnapshot: () =>
    ownerPromise("ownerControlPlane.programsTodos.getSnapshot", () =>
      fetchAgentsVxappProgramsTodosSnapshot(),
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
