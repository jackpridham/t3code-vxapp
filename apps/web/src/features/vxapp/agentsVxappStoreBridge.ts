import type {
  AgentsVxappOwnerBoundaryError,
  AgentsVxappSidebarAuthorityDiagnostic,
  ServerAgentsVxappSidebarAttentionItem,
  ServerAgentsVxappSidebarProgramNotification,
  ServerAgentsVxappSidebarAuthorityProgramCard,
  ServerAgentsVxappSidebarWake,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
} from "@t3tools/contracts";
import {
  AgentsVxappSidebarAuthorityField,
  AgentsVxappSidebarProgramCardField,
} from "@t3tools/contracts";
import { resolveVortexErrorDisplay } from "@t3tools/shared/vortexErrors";
import { ensureNativeApi } from "~/nativeApi";
import { WebSocketRequestError } from "~/wsTransport";

type SidebarAuthoritySnapshot = ServerGetAgentsVxappSidebarAuthoritySnapshotResult;
type SidebarTodoList = SidebarAuthoritySnapshot["todos"][number][];

export interface AgentsVxappSidebarAuthorityNormalizedSnapshot {
  readonly attentionItems: readonly ServerAgentsVxappSidebarAttentionItem[];
  readonly snapshot: SidebarAuthoritySnapshot;
  readonly currentTodoIdByProgramId: ReadonlyMap<string, string>;
  readonly diagnosticsByProgramId: ReadonlyMap<
    string,
    readonly AgentsVxappSidebarAuthorityDiagnostic[]
  >;
  readonly notifications: readonly ServerAgentsVxappSidebarProgramNotification[];
  readonly openWakes: readonly ServerAgentsVxappSidebarWake[];
  readonly programCardById: ReadonlyMap<string, ServerAgentsVxappSidebarAuthorityProgramCard>;
  readonly programCards: readonly ServerAgentsVxappSidebarAuthorityProgramCard[];
  readonly runtimeTargetByThreadId: ReadonlyMap<
    string,
    ServerAgentsVxappSidebarAuthorityProgramCard["executive"]
  >;
  readonly todosByProgramId: ReadonlyMap<string, SidebarTodoList>;
}

function makeBoundaryError(input: {
  readonly code?: AgentsVxappOwnerBoundaryError["code"];
  readonly details?: Record<string, unknown> | null;
  readonly kind: AgentsVxappOwnerBoundaryError["kind"];
  readonly message: string;
  readonly ownerErrorCode?: string | null;
  readonly title?: string;
}): AgentsVxappOwnerBoundaryError {
  const display =
    input.code !== undefined && input.title !== undefined
      ? null
      : resolveVortexErrorDisplay({
          code: input.code,
          kind: input.kind,
          message: input.message,
          ownerErrorCode: input.ownerErrorCode,
        });
  return {
    kind: input.kind,
    ...(input.code !== undefined || display ? { code: input.code ?? display?.code } : {}),
    message: display?.message ?? input.message,
    ...(input.ownerErrorCode !== undefined ? { ownerErrorCode: input.ownerErrorCode } : {}),
    ...(input.title !== undefined || display ? { title: input.title ?? display?.title } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  };
}

function validateSidebarAuthoritySnapshot(
  value: unknown,
): asserts value is ServerGetAgentsVxappSidebarAuthoritySnapshotResult {
  if (!value || typeof value !== "object") {
    throw makeBoundaryError({
      kind: "decode_error",
      message: "Owner sidebar authority snapshot is not an object.",
    });
  }

  const record = value as Record<string, unknown>;
  for (const [fieldName, fieldValue] of [
    [AgentsVxappSidebarAuthorityField.Programs, record[AgentsVxappSidebarAuthorityField.Programs]],
    [AgentsVxappSidebarAuthorityField.Todos, record[AgentsVxappSidebarAuthorityField.Todos]],
    [
      AgentsVxappSidebarAuthorityField.CurrentTodos,
      record[AgentsVxappSidebarAuthorityField.CurrentTodos],
    ],
    [
      AgentsVxappSidebarAuthorityField.OwnerDiagnostics,
      record[AgentsVxappSidebarAuthorityField.OwnerDiagnostics],
    ],
  ] as const) {
    if (!Array.isArray(fieldValue)) {
      throw makeBoundaryError({
        kind: "missing_required_field",
        message: `Owner sidebar authority snapshot is missing '${fieldName}'.`,
        details: { fieldName },
      });
    }
  }
}

function normalizeTodosByProgramId(
  todos: SidebarAuthoritySnapshot["todos"],
): ReadonlyMap<string, SidebarTodoList> {
  const next = new Map<string, SidebarTodoList>();
  for (const todo of todos) {
    if (!todo.programId) {
      continue;
    }
    const existing = next.get(todo.programId) ?? [];
    existing.push(todo);
    next.set(todo.programId, existing);
  }
  return next;
}

export async function fetchAgentsVxappSidebarAuthoritySnapshotFromOwner(): Promise<SidebarAuthoritySnapshot> {
  try {
    const snapshot = await ensureNativeApi().server.getAgentsVxappSidebarAuthoritySnapshot({});
    validateSidebarAuthoritySnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof WebSocketRequestError) {
      const display = resolveVortexErrorDisplay({
        code: error.code,
        kind: "owner_contract_error",
        message: error.message,
        ownerErrorCode: error.ownerErrorCode,
      });
      throw makeBoundaryError({
        kind: "owner_contract_error",
        code: display.code,
        title: display.title,
        message: display.message,
        ownerErrorCode: display.ownerErrorCode,
      });
    }
    if (
      error &&
      typeof error === "object" &&
      "kind" in error &&
      "message" in error &&
      typeof (error as { kind?: unknown }).kind === "string"
    ) {
      throw error;
    }
    const display = resolveVortexErrorDisplay({
      kind: "transport_error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to fetch agents-vxapp sidebar authority snapshot.",
    });
    throw makeBoundaryError({
      kind: "transport_error",
      code: display.code,
      title: display.title,
      message: display.message,
      ownerErrorCode: display.ownerErrorCode,
    });
  }
}

export function normalizeAgentsVxappSidebarAuthoritySnapshot(
  snapshot: SidebarAuthoritySnapshot,
): AgentsVxappSidebarAuthorityNormalizedSnapshot {
  const programCardById = new Map<string, ServerAgentsVxappSidebarAuthorityProgramCard>();
  const currentTodoIdByProgramId = new Map<string, string>();
  const runtimeTargetByThreadId = new Map<
    string,
    ServerAgentsVxappSidebarAuthorityProgramCard["executive"]
  >();
  const diagnosticsByProgramId = new Map<
    string,
    readonly AgentsVxappSidebarAuthorityDiagnostic[]
  >();
  const notifications: ServerAgentsVxappSidebarProgramNotification[] = [];
  const attentionItems: ServerAgentsVxappSidebarAttentionItem[] = [];
  const openWakes: ServerAgentsVxappSidebarWake[] = [];

  for (const row of snapshot.currentTodos) {
    currentTodoIdByProgramId.set(row.programId, row.todoId);
  }

  for (const card of snapshot.programs) {
    const program =
      card[AgentsVxappSidebarProgramCardField.Program as keyof typeof card] ?? card.program;
    const programId =
      program && typeof program === "object" && "id" in program && typeof program.id === "string"
        ? program.id
        : null;
    if (!programId) {
      continue;
    }
    programCardById.set(programId, card);
    diagnosticsByProgramId.set(programId, card.ownerDiagnostics);
    notifications.push(...card.notifications);
    attentionItems.push(...card.attentionItems);
    openWakes.push(...card.openWakes);
    if (card.executive?.threadId) {
      runtimeTargetByThreadId.set(card.executive.threadId, card.executive);
    }
    if (card.orchestrator?.threadId) {
      runtimeTargetByThreadId.set(card.orchestrator.threadId, card.orchestrator);
    }
    for (const worker of card.workers) {
      if (worker.threadId) {
        runtimeTargetByThreadId.set(worker.threadId, worker);
      }
    }
  }

  return {
    attentionItems,
    snapshot,
    programCards: snapshot.programs,
    programCardById,
    currentTodoIdByProgramId,
    diagnosticsByProgramId,
    notifications,
    openWakes,
    runtimeTargetByThreadId,
    todosByProgramId: normalizeTodosByProgramId(snapshot.todos),
  };
}
