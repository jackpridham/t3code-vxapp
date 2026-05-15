import path from "node:path";
import {
  ProgramId,
  ProjectId,
  ThreadId,
  type ServerAgentsVxappCurrentTodoProjection,
  type ServerAgentsVxappOwnerMutationResult,
  type ServerAgentsVxappProgramSnapshot,
  type ServerAgentsVxappTodoSnapshot,
  type ServerGetAgentsVxappControlPlaneSnapshotResult,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { runProcess } from "../../../processRunner";
import {
  AGENTS_VXAPP_DB_PATH,
  AGENTS_VXAPP_ROOT,
  AGENTS_VXAPP_TODO_ROOT,
  type AgentsVxappSqliteRow,
  withAgentsVxappSqliteReadonly,
} from "../agentsVxappSqlite";
import {
  AgentsVxappControlPlane,
  AgentsVxappControlPlaneError,
  type AgentsVxappAttentionSummaryExport,
  type AgentsVxappBindingAuthorityExport,
  type AgentsVxappNotificationSummaryExport,
  type AgentsVxappControlPlaneShape,
  type AgentsVxappProgramAuthorityExport,
  type AgentsVxappWatchSummaryExport,
} from "../Services/AgentsVxappControlPlane.ts";
import {
  hydrateProgramSnapshotFromCloseoutFile,
  normalizeProgramStatus,
  resolveProgramCurrentStatus,
} from "../programStatus";

const CONTROL_PLANE_OWNER_PATH = path.join(
  AGENTS_VXAPP_ROOT,
  "scripts/tools/t3-control-plane-owner",
);
const TODO_OWNER_PATH = path.join(AGENTS_VXAPP_ROOT, "scripts/tools/todo-owner");
const AGENTS_VXAPP_OWNER_EXPORT_PATH_ENV = "T3_AGENTS_VXAPP_OWNER_EXPORT_PATH";
const OWNER_EXPORT_ROOT = path.join(AGENTS_VXAPP_ROOT, ".agents/state/exports/t3");
const BINDING_AUTHORITY_EXPORT_PATH = path.join(OWNER_EXPORT_ROOT, "binding-authority.json");
const PROGRAM_AUTHORITY_EXPORT_PATH = path.join(OWNER_EXPORT_ROOT, "program-authority.json");
const ATTENTION_SUMMARY_EXPORT_PATH = path.join(OWNER_EXPORT_ROOT, "attention-summary.json");
const NOTIFICATION_SUMMARY_EXPORT_PATH = path.join(OWNER_EXPORT_ROOT, "notification-summary.json");
const WATCH_SUMMARY_EXPORT_PATH = path.join(OWNER_EXPORT_ROOT, "watch-summary.json");
const OWNER_COMMAND_TIMEOUT_MS = 30_000;
const OWNER_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const TODO_ID_ALLOWED = /^[A-Za-z0-9._-]+$/;
type JsonRecord = Record<string, unknown>;
const isAgentsVxappControlPlaneError = Schema.is(AgentsVxappControlPlaneError);

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asObjectArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function parseJsonText(operation: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail: error instanceof Error ? error.message : "Command returned invalid JSON.",
    });
  }
}

function toControlPlaneError(
  operation: string,
  detail: string,
  cause: unknown,
): AgentsVxappControlPlaneError {
  if (isAgentsVxappControlPlaneError(cause)) {
    return cause;
  }
  return new AgentsVxappControlPlaneError({
    operation,
    detail: cause instanceof Error ? cause.message : detail,
  });
}

function tryPromiseAs<T>(input: {
  operation: string;
  detail: string;
  try: () => Promise<T>;
}): Effect.Effect<T, AgentsVxappControlPlaneError, never> {
  return Effect.tryPromise({
    try: input.try,
    catch: (cause) => toControlPlaneError(input.operation, input.detail, cause),
  });
}

function mapFileSystemError(operation: string, detail: string) {
  return Effect.mapError((cause: unknown) => toControlPlaneError(operation, detail, cause));
}

function ownerErrorDetail(payload: unknown, fallback: string): string {
  const object = asObject(payload);
  const error = asObject(object?.error);
  const message =
    asString(error?.message) ??
    asString(object?.message) ??
    asString(object?.detail) ??
    asString(object?.stderr);
  return message ?? fallback;
}

function requireObject(operation: string, value: unknown, detail: string): JsonRecord {
  const object = asObject(value);
  if (!object) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail,
    });
  }
  return object;
}

function requireString(operation: string, value: unknown, detail: string): string {
  const normalized = asString(value);
  if (!normalized) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail,
    });
  }
  return normalized;
}

function requireBoolean(operation: string, value: unknown, detail: string): boolean {
  if (typeof value !== "boolean") {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail,
    });
  }
  return value;
}

function requireStringArray(operation: string, value: unknown, detail: string): string[] {
  if (!Array.isArray(value)) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail,
    });
  }
  return value.map((entry, index) => {
    const normalized = asString(entry);
    if (!normalized) {
      throw new AgentsVxappControlPlaneError({
        operation,
        detail: `${detail} Invalid string at index ${index}.`,
      });
    }
    return normalized;
  });
}

function requireObjectArray(operation: string, value: unknown, detail: string): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail,
    });
  }
  return value.map((entry, index) => {
    const object = asObject(entry);
    if (!object) {
      throw new AgentsVxappControlPlaneError({
        operation,
        detail: `${detail} Invalid object at index ${index}.`,
      });
    }
    return object;
  });
}

function validateOwnerEnvelope(operation: string, payload: JsonRecord, exportPath: string): void {
  requireString(operation, payload.authorityStore, `Invalid authorityStore in '${exportPath}'.`);
  requireString(operation, payload.authoritySource, `Invalid authoritySource in '${exportPath}'.`);
  if (payload.legacyFallbackUsed !== false) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail: `Owner export '${exportPath}' must set legacyFallbackUsed to false.`,
    });
  }
}

function readOwnerExportPayload(
  fileSystem: FileSystem.FileSystem,
  exportPath: string,
  operation: string,
): Effect.Effect<JsonRecord, AgentsVxappControlPlaneError, never> {
  return Effect.gen(function* () {
    const exists = yield* fileSystem
      .exists(exportPath)
      .pipe(
        mapFileSystemError(operation, `Failed to inspect vxapp owner export at '${exportPath}'.`),
      );
    if (!exists) {
      return yield* new AgentsVxappControlPlaneError({
        operation,
        detail: `Missing vxapp owner export at '${exportPath}'.`,
      });
    }

    const raw = yield* fileSystem
      .readFileString(exportPath)
      .pipe(mapFileSystemError(operation, `Failed to read vxapp owner export at '${exportPath}'.`));
    const parsed = parseJsonText(operation, raw);
    return requireObject(
      operation,
      parsed,
      `vxapp owner export at '${exportPath}' must be a JSON object.`,
    );
  });
}

function buildBindingAuthorityExport(
  payload: JsonRecord,
  exportPath: string,
  operation: string,
): AgentsVxappBindingAuthorityExport {
  validateOwnerEnvelope(operation, payload, exportPath);
  const jasper = requireObject(
    operation,
    payload.jasper,
    "binding-authority.json is missing jasper.",
  );
  const currentThread = requireObject(
    operation,
    jasper.currentThread,
    "binding-authority.json is missing jasper.currentThread.",
  );
  const project = requireObject(
    operation,
    jasper.project,
    "binding-authority.json is missing jasper.project.",
  );
  const currentThreadId = requireString(
    operation,
    currentThread.id,
    "binding-authority.json is missing jasper.currentThread.id.",
  );
  const currentThreadProgramId = requireString(
    operation,
    currentThread.programId,
    "binding-authority.json is missing jasper.currentThread.programId.",
  );
  const currentThreadProjectId = requireString(
    operation,
    currentThread.projectId,
    "binding-authority.json is missing jasper.currentThread.projectId.",
  );
  const currentSessionRootThreadId = requireString(
    operation,
    project.currentSessionRootThreadId,
    "binding-authority.json is missing jasper.project.currentSessionRootThreadId.",
  );

  if (currentThreadId !== currentSessionRootThreadId) {
    throw new AgentsVxappControlPlaneError({
      operation,
      detail:
        "binding-authority.json currentThread.id must match jasper.project.currentSessionRootThreadId.",
    });
  }

  return {
    authorityStore: requireString(
      operation,
      payload.authorityStore,
      "binding-authority.json is missing authorityStore.",
    ),
    authoritySource: requireString(
      operation,
      payload.authoritySource,
      "binding-authority.json is missing authoritySource.",
    ),
    legacyFallbackUsed: false as const,
    diagnostics: payload.diagnostics ?? null,
    jasper: {
      ...jasper,
      currentThread: {
        ...currentThread,
        id: currentThreadId,
        programId: currentThreadProgramId,
        projectId: currentThreadProjectId,
      },
      project: {
        ...project,
        currentSessionRootThreadId,
      },
    },
  };
}

function buildProgramAuthorityExport(
  payload: JsonRecord,
  exportPath: string,
  operation: string,
): AgentsVxappProgramAuthorityExport {
  validateOwnerEnvelope(operation, payload, exportPath);
  return {
    authorityStore: requireString(
      operation,
      payload.authorityStore,
      "program-authority.json is missing authorityStore.",
    ),
    authoritySource: requireString(
      operation,
      payload.authoritySource,
      "program-authority.json is missing authoritySource.",
    ),
    legacyFallbackUsed: false as const,
    action: requireString(operation, payload.action, "program-authority.json is missing action."),
    enabled: requireBoolean(
      operation,
      payload.enabled,
      "program-authority.json is missing enabled.",
    ),
    mode: requireString(operation, payload.mode, "program-authority.json is missing mode."),
  };
}

function buildNotificationSummaryExport(
  payload: JsonRecord,
  exportPath: string,
  operation: string,
): AgentsVxappNotificationSummaryExport {
  validateOwnerEnvelope(operation, payload, exportPath);
  return {
    authorityStore: requireString(
      operation,
      payload.authorityStore,
      "notification-summary.json is missing authorityStore.",
    ),
    authoritySource: requireString(
      operation,
      payload.authoritySource,
      "notification-summary.json is missing authoritySource.",
    ),
    legacyFallbackUsed: false as const,
    notifications: requireObjectArray(
      operation,
      payload.notifications,
      "notification-summary.json is missing notifications.",
    ),
    attention: requireObjectArray(
      operation,
      payload.attention,
      "notification-summary.json is missing attention.",
    ),
  };
}

function buildAttentionSummaryExport(
  payload: JsonRecord,
  exportPath: string,
  operation: string,
): AgentsVxappAttentionSummaryExport {
  validateOwnerEnvelope(operation, payload, exportPath);
  return {
    authorityStore: requireString(
      operation,
      payload.authorityStore,
      "attention-summary.json is missing authorityStore.",
    ),
    authoritySource: requireString(
      operation,
      payload.authoritySource,
      "attention-summary.json is missing authoritySource.",
    ),
    legacyFallbackUsed: false as const,
    attention: requireObjectArray(
      operation,
      payload.attention,
      "attention-summary.json is missing attention.",
    ),
    resolvedAttention: requireObjectArray(
      operation,
      payload.resolvedAttention,
      "attention-summary.json is missing resolvedAttention.",
    ),
    passiveNotifications: requireObjectArray(
      operation,
      payload.passiveNotifications,
      "attention-summary.json is missing passiveNotifications.",
    ),
  };
}

function buildWatchSummaryExport(
  payload: JsonRecord,
  exportPath: string,
  operation: string,
): AgentsVxappWatchSummaryExport {
  validateOwnerEnvelope(operation, payload, exportPath);
  return {
    authorityStore: requireString(
      operation,
      payload.authorityStore,
      "watch-summary.json is missing authorityStore.",
    ),
    authoritySource: requireString(
      operation,
      payload.authoritySource,
      "watch-summary.json is missing authoritySource.",
    ),
    legacyFallbackUsed: false as const,
    enabledPrograms: requireStringArray(
      operation,
      payload.enabledPrograms,
      "watch-summary.json is missing enabledPrograms.",
    ),
    state: requireObject(operation, payload.state, "watch-summary.json is missing state."),
    classification:
      typeof payload.classification === "string" || payload.classification === null
        ? (payload.classification as string | null)
        : null,
    recommendedAction:
      typeof payload.recommendedAction === "string" || payload.recommendedAction === null
        ? (payload.recommendedAction as string | null)
        : null,
    program:
      payload.program === null
        ? null
        : requireObject(
            operation,
            payload.program,
            "watch-summary.json has an invalid program payload.",
          ),
    currentOrchestratorThread:
      payload.currentOrchestratorThread === null
        ? null
        : requireObject(
            operation,
            payload.currentOrchestratorThread,
            "watch-summary.json has an invalid currentOrchestratorThread payload.",
          ),
    wakeDecision:
      payload.wakeDecision === null
        ? null
        : requireObject(
            operation,
            payload.wakeDecision,
            "watch-summary.json has an invalid wakeDecision payload.",
          ),
  };
}

async function runOwnerJsonCommand(input: {
  commandPath: string;
  args: readonly string[];
  operation: string;
}): Promise<unknown> {
  const result = await runProcess(
    input.commandPath,
    ["--compatibility-mode", "--json", ...input.args],
    {
      allowNonZeroExit: true,
      cwd: AGENTS_VXAPP_ROOT,
      maxBufferBytes: OWNER_COMMAND_MAX_BUFFER_BYTES,
      outputMode: "truncate",
      timeoutMs: OWNER_COMMAND_TIMEOUT_MS,
    },
  );

  const stdout = result.stdout.trim();
  const parsed = parseJsonText(input.operation, stdout);
  if (result.code !== 0) {
    throw new AgentsVxappControlPlaneError({
      operation: input.operation,
      detail: ownerErrorDetail(parsed, `${path.basename(input.commandPath)} failed.`),
    });
  }
  return parsed;
}

function slugifyTitle(title: string): string {
  const lowered = title.trim().toLowerCase();
  const chunks: string[] = [];
  let active = "";

  for (const char of lowered) {
    if (/^[a-z0-9._-]$/.test(char)) {
      active += char;
      continue;
    }
    if (active.length > 0) {
      chunks.push(active);
      active = "";
    }
  }
  if (active.length > 0) {
    chunks.push(active);
  }
  const slug = chunks
    .map((chunk) => chunk.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
  return slug || "todo";
}

function validateTodoId(todoId: string): boolean {
  return TODO_ID_ALLOWED.test(todoId);
}

function normalizePlanLink(input: JsonRecord, linkedAtFallback: string): JsonRecord | null {
  const repo = asString(input.repo);
  const planKey = asString(input.planKey);
  if (!repo || !planKey) {
    return null;
  }
  return {
    repo,
    planKey,
    phase: typeof input.phase === "string" ? input.phase : null,
    step: typeof input.step === "string" ? input.step : null,
    linkedAt: asString(input.linkedAt) ?? linkedAtFallback,
  };
}

function planLinkKey(input: {
  repo: string;
  planKey: string;
  phase: string | null;
  step: string | null;
}): string {
  return [input.repo, input.planKey, input.phase ?? "", input.step ?? ""].join("::");
}

function normalizeTodoSnapshot(todo: JsonRecord, agent: string): ServerAgentsVxappTodoSnapshot {
  const todoId = asString(todo.todoId) ?? "todo";
  const filePath =
    asString(todo.filePath) ?? path.join(AGENTS_VXAPP_TODO_ROOT, agent, `${todoId}.json`);
  return {
    todoId,
    agent,
    programId: asString(todo.programId) ? ProgramId.makeUnsafe(String(todo.programId)) : null,
    title: asString(todo.title) ?? todoId,
    summary: typeof todo.summary === "string" ? todo.summary : null,
    nextAction: typeof todo.nextAction === "string" ? todo.nextAction : null,
    status: asString(todo.status) ?? "active",
    priority: asString(todo.priority) ?? "normal",
    filePath,
    owner: asObject(todo.owner),
    planLinks: asObjectArray(todo.planLinks).flatMap((link) => {
      const normalized = normalizePlanLink(link, asString(todo.updatedAt) ?? nowIso());
      return normalized
        ? [
            {
              repo: String(normalized.repo),
              planKey: String(normalized.planKey),
              phase: typeof normalized.phase === "string" ? normalized.phase : null,
              step: typeof normalized.step === "string" ? normalized.step : null,
              linkedAt: asString(normalized.linkedAt),
            },
          ]
        : [];
    }),
    notes: Array.isArray(todo.notes) ? todo.notes : [],
    createdAt: asString(todo.createdAt) ?? nowIso(),
    updatedAt: asString(todo.updatedAt) ?? nowIso(),
  };
}

function normalizeProgramSnapshot(program: JsonRecord): ServerAgentsVxappProgramSnapshot {
  const id = asString(program.id) ?? crypto.randomUUID();
  const resolvedStatus = resolveProgramCurrentStatus({
    closeout: program.closeout,
    currentStatus: program.currentStatus,
    status: program.status,
  });
  const status = normalizeProgramStatus(resolvedStatus);
  if (status === null) {
    throw new AgentsVxappControlPlaneError({
      operation: "programs.snapshot",
      detail:
        resolvedStatus === null
          ? `Program '${id}' is missing a valid contract-backed status.`
          : `Program '${id}' has invalid status '${resolvedStatus}'.`,
    });
  }
  return {
    id: ProgramId.makeUnsafe(id),
    title: asString(program.title) ?? id,
    objective: typeof program.objective === "string" ? program.objective : null,
    status,
    baseStatus: asString(program.baseStatus),
    currentStatus: resolvedStatus,
    executiveProjectId: asString(program.executiveProjectId)
      ? ProjectId.makeUnsafe(String(program.executiveProjectId))
      : null,
    executiveThreadId: asString(program.executiveThreadId)
      ? ThreadId.makeUnsafe(String(program.executiveThreadId))
      : null,
    currentOrchestratorThreadId: asString(program.currentOrchestratorThreadId)
      ? ThreadId.makeUnsafe(String(program.currentOrchestratorThreadId))
      : null,
    metadata: asObject(program.metadata),
    closeout: asObject(program.closeout),
    createdAt: asString(program.createdAt) ?? nowIso(),
    updatedAt: asString(program.updatedAt) ?? nowIso(),
    completedAt: asString(program.completedAt),
    deletedAt: asString(program.deletedAt),
  };
}

function normalizeCurrentTodoRow(
  row: AgentsVxappSqliteRow,
): ServerAgentsVxappCurrentTodoProjection | null {
  const agent = asString(row.agent);
  const programId = asString(row.programId);
  const todoId = asString(row.todoId);
  const createdAt = asString(row.createdAt);
  const updatedAt = asString(row.updatedAt);
  if (!agent || !programId || !todoId || !createdAt || !updatedAt) {
    return null;
  }
  let ambiguity: JsonRecord | null = null;
  const ambiguityJson = asString(row.ambiguityJson);
  if (ambiguityJson) {
    const parsed = parseJsonText("currentTodoProjection.decode", ambiguityJson);
    ambiguity = asObject(parsed);
  }
  return {
    agent,
    programId: ProgramId.makeUnsafe(programId),
    todoId,
    ambiguity,
    createdAt,
    updatedAt,
  };
}

async function queryCurrentTodoRows(): Promise<ServerAgentsVxappCurrentTodoProjection[]> {
  return withAgentsVxappSqliteReadonly((queryAll) =>
    queryAll(`
      SELECT
        agent AS "agent",
        program_id AS "programId",
        todo_id AS "todoId",
        ambiguity_json AS "ambiguityJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM agent_current_todos
      ORDER BY updated_at DESC
    `)
      .map(normalizeCurrentTodoRow)
      .filter((row): row is ServerAgentsVxappCurrentTodoProjection => row !== null),
  );
}

async function listTodoAgents(): Promise<string[]> {
  try {
    const directoryEntries = await import("node:fs/promises").then((fs) =>
      fs.readdir(AGENTS_VXAPP_TODO_ROOT, { withFileTypes: true }),
    );
    return directoryEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function listTodosForAgent(agent: string): Promise<ServerAgentsVxappTodoSnapshot[]> {
  const fs = await import("node:fs/promises");
  const agentDir = path.join(AGENTS_VXAPP_TODO_ROOT, agent);
  let directoryEntries: Array<{ isFile: () => boolean; name: string }>;
  try {
    directoryEntries = (await fs.readdir(agentDir, {
      encoding: "utf8",
      withFileTypes: true,
    })) as Array<{ isFile: () => boolean; name: string }>;
  } catch {
    return [];
  }

  const todoFileNames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));

  return Promise.all(
    todoFileNames.map(async (fileName) => {
      const filePath = path.join(agentDir, fileName);
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = parseJsonText(`todos.read.${agent}.${fileName}`, raw);
      const todo = asObject(parsed);
      if (!todo) {
        throw new AgentsVxappControlPlaneError({
          operation: `todos.read.${agent}.${fileName}`,
          detail: `Todo file '${fileName}' for agent '${agent}' is invalid JSON.`,
        });
      }
      return normalizeTodoSnapshot({ ...todo, filePath }, agent);
    }),
  );
}

async function listPrograms(): Promise<ServerAgentsVxappProgramSnapshot[]> {
  const payload = await runOwnerJsonCommand({
    commandPath: CONTROL_PLANE_OWNER_PATH,
    args: ["programs-list"],
    operation: "programs.list",
  });
  if (!Array.isArray(payload)) {
    throw new AgentsVxappControlPlaneError({
      operation: "programs.list",
      detail: "Program owner returned an invalid program list.",
    });
  }
  const fs = await import("node:fs/promises");
  const hydratedPayload = await Promise.all(
    payload
      .filter(
        (entry): entry is JsonRecord =>
          entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
      .map((entry) =>
        hydrateProgramSnapshotFromCloseoutFile(entry, (filePath) => fs.readFile(filePath, "utf8")),
      ),
  );
  return hydratedPayload
    .filter(
      (entry): entry is JsonRecord =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry),
    )
    .map(normalizeProgramSnapshot);
}

async function syncTodoProjection(agent: string): Promise<void> {
  await runOwnerJsonCommand({
    commandPath: TODO_OWNER_PATH,
    args: ["current", "--agent", agent],
    operation: `todos.sync.${agent}`,
  });
}

function buildTodoFilePath(agent: string, todoId: string): string {
  return path.join(AGENTS_VXAPP_TODO_ROOT, agent, `${todoId}.json`);
}

async function loadTodoFile(
  fileSystem: FileSystem.FileSystem,
  agent: string,
  todoId: string,
): Promise<JsonRecord> {
  const raw = await Effect.runPromise(
    fileSystem.readFileString(buildTodoFilePath(agent, todoId)).pipe(
      Effect.mapError(
        () =>
          new AgentsVxappControlPlaneError({
            operation: "todo.read",
            detail: `Todo '${todoId}' for agent '${agent}' was not found.`,
          }),
      ),
    ),
  );
  const parsed = parseJsonText("todo.read", raw);
  const todo = asObject(parsed);
  if (!todo) {
    throw new AgentsVxappControlPlaneError({
      operation: "todo.read",
      detail: `Todo '${todoId}' for agent '${agent}' is invalid JSON.`,
    });
  }
  return todo;
}

function nextPlanLinks(input: {
  existing: JsonRecord;
  requestedPlanLinks: readonly JsonRecord[];
  updatedAt: string;
}): JsonRecord[] {
  const existingByKey = new Map<string, JsonRecord>();
  for (const link of asObjectArray(input.existing.planLinks)) {
    const normalized = normalizePlanLink(link, input.updatedAt);
    if (!normalized) {
      continue;
    }
    existingByKey.set(
      planLinkKey({
        repo: String(normalized.repo),
        planKey: String(normalized.planKey),
        phase: typeof normalized.phase === "string" ? normalized.phase : null,
        step: typeof normalized.step === "string" ? normalized.step : null,
      }),
      normalized,
    );
  }

  return input.requestedPlanLinks.flatMap((link) => {
    const normalized = normalizePlanLink(link, input.updatedAt);
    if (!normalized) {
      return [];
    }
    const key = planLinkKey({
      repo: String(normalized.repo),
      planKey: String(normalized.planKey),
      phase: typeof normalized.phase === "string" ? normalized.phase : null,
      step: typeof normalized.step === "string" ? normalized.step : null,
    });
    const existing = existingByKey.get(key);
    return [
      {
        repo: String(normalized.repo),
        planKey: String(normalized.planKey),
        phase: typeof normalized.phase === "string" ? normalized.phase : null,
        step: typeof normalized.step === "string" ? normalized.step : null,
        linkedAt: asString(existing?.linkedAt) ?? asString(normalized.linkedAt) ?? input.updatedAt,
      },
    ];
  });
}

const makeAgentsVxappControlPlane = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;

  const loadOwnerExport = <T>(input: {
    readonly exportPath: string;
    readonly operation: string;
    readonly detail: string;
    readonly build: (payload: JsonRecord) => T;
  }) =>
    readOwnerExportPayload(fileSystem, input.exportPath, input.operation).pipe(
      Effect.flatMap((payload) =>
        Effect.try({
          try: () => input.build(payload),
          catch: (cause) => toControlPlaneError(input.operation, input.detail, cause),
        }),
      ),
    );

  const getBindingAuthorityExport: AgentsVxappControlPlaneShape["getBindingAuthorityExport"] = () =>
    loadOwnerExport<AgentsVxappBindingAuthorityExport>({
      exportPath: BINDING_AUTHORITY_EXPORT_PATH,
      operation: "ownerProjectionAuthority.bindingAuthority.getSnapshot",
      detail: `Failed to read vxapp binding authority export at '${BINDING_AUTHORITY_EXPORT_PATH}'.`,
      build: (payload) =>
        buildBindingAuthorityExport(
          payload,
          BINDING_AUTHORITY_EXPORT_PATH,
          "ownerProjectionAuthority.bindingAuthority.getSnapshot",
        ),
    });

  const getProgramAuthorityExport: AgentsVxappControlPlaneShape["getProgramAuthorityExport"] = () =>
    loadOwnerExport<AgentsVxappProgramAuthorityExport>({
      exportPath: PROGRAM_AUTHORITY_EXPORT_PATH,
      operation: "ownerProjectionAuthority.programAuthority.getSnapshot",
      detail: `Failed to read vxapp program authority export at '${PROGRAM_AUTHORITY_EXPORT_PATH}'.`,
      build: (payload) =>
        buildProgramAuthorityExport(
          payload,
          PROGRAM_AUTHORITY_EXPORT_PATH,
          "ownerProjectionAuthority.programAuthority.getSnapshot",
        ),
    });

  const getAttentionSummaryExport: AgentsVxappControlPlaneShape["getAttentionSummaryExport"] = () =>
    loadOwnerExport<AgentsVxappAttentionSummaryExport>({
      exportPath: ATTENTION_SUMMARY_EXPORT_PATH,
      operation: "ownerProjectionAuthority.attentionSummary.getSnapshot",
      detail: `Failed to read vxapp attention summary export at '${ATTENTION_SUMMARY_EXPORT_PATH}'.`,
      build: (payload) =>
        buildAttentionSummaryExport(
          payload,
          ATTENTION_SUMMARY_EXPORT_PATH,
          "ownerProjectionAuthority.attentionSummary.getSnapshot",
        ),
    });

  const getNotificationSummaryExport: AgentsVxappControlPlaneShape["getNotificationSummaryExport"] =
    () =>
      loadOwnerExport<AgentsVxappNotificationSummaryExport>({
        exportPath: NOTIFICATION_SUMMARY_EXPORT_PATH,
        operation: "ownerProjectionAuthority.notificationSummary.getSnapshot",
        detail: `Failed to read vxapp notification summary export at '${NOTIFICATION_SUMMARY_EXPORT_PATH}'.`,
        build: (payload) =>
          buildNotificationSummaryExport(
            payload,
            NOTIFICATION_SUMMARY_EXPORT_PATH,
            "ownerProjectionAuthority.notificationSummary.getSnapshot",
          ),
      });

  const getWatchSummaryExport: AgentsVxappControlPlaneShape["getWatchSummaryExport"] = () =>
    loadOwnerExport<AgentsVxappWatchSummaryExport>({
      exportPath: WATCH_SUMMARY_EXPORT_PATH,
      operation: "ownerProjectionAuthority.watchSummary.getSnapshot",
      detail: `Failed to read vxapp watch summary export at '${WATCH_SUMMARY_EXPORT_PATH}'.`,
      build: (payload) =>
        buildWatchSummaryExport(
          payload,
          WATCH_SUMMARY_EXPORT_PATH,
          "ownerProjectionAuthority.watchSummary.getSnapshot",
        ),
    });

  const getProjectionAuthoritySnapshot: AgentsVxappControlPlaneShape["getProjectionAuthoritySnapshot"] =
    () =>
      Effect.gen(function* () {
        const exportPath = process.env[AGENTS_VXAPP_OWNER_EXPORT_PATH_ENV]?.trim();
        if (!exportPath) {
          return yield* new AgentsVxappControlPlaneError({
            operation: "ownerProjectionAuthority.getSnapshot",
            detail:
              "Missing vxapp owner export path. Configure T3_AGENTS_VXAPP_OWNER_EXPORT_PATH after agents-vxapp Phases 08-10 land.",
          });
        }

        const raw = yield* fileSystem
          .readFileString(exportPath)
          .pipe(
            mapFileSystemError(
              "ownerProjectionAuthority.getSnapshot",
              `Failed to read vxapp owner export at '${exportPath}'.`,
            ),
          );
        const parsed = parseJsonText("ownerProjectionAuthority.getSnapshot", raw);
        const payload = asObject(parsed);
        if (!payload) {
          return yield* new AgentsVxappControlPlaneError({
            operation: "ownerProjectionAuthority.getSnapshot",
            detail: "vxapp owner export payload must be a JSON object.",
          });
        }

        return {
          contractFamily: asString(payload.contractFamily),
          contractVersion: asString(payload.contractVersion),
          exportPath,
          fetchedAt: nowIso(),
          payload,
        };
      });

  const getSnapshot: AgentsVxappControlPlaneShape["getSnapshot"] = (_input) =>
    Effect.gen(function* () {
      const [programs, agents] = yield* Effect.all([
        tryPromiseAs({
          operation: "programs.list",
          detail: "Failed to list Programs.",
          try: () => listPrograms(),
        }),
        tryPromiseAs({
          operation: "todos.agents",
          detail: "Failed to scan TODO agents.",
          try: () => listTodoAgents(),
        }),
      ]);

      const todos = (yield* Effect.forEach(agents, (agent) =>
        tryPromiseAs({
          operation: `todos.list.${agent}`,
          detail: `Failed to list TODOs for ${agent}.`,
          try: () => listTodosForAgent(agent),
        }),
      )).flat();

      const currentTodos = yield* tryPromiseAs({
        operation: "todos.current-projections",
        detail: "Failed to query current TODO projections.",
        try: () => queryCurrentTodoRows(),
      });

      return {
        fetchedAt: nowIso(),
        dbPath: AGENTS_VXAPP_DB_PATH,
        todoRootPath: AGENTS_VXAPP_TODO_ROOT,
        agents,
        programs,
        todos,
        currentTodos,
      } satisfies ServerGetAgentsVxappControlPlaneSnapshotResult;
    });

  const createProgram: AgentsVxappControlPlaneShape["createProgram"] = (input) =>
    tryPromiseAs({
      operation: "programs.create",
      detail: "Failed to create Program.",
      try: async () => {
        const args = [
          "programs-create",
          "--title",
          input.title,
          "--executive-project",
          input.executiveProjectId,
          "--executive-thread",
          input.executiveThreadId,
        ];
        if (typeof input.objective === "string") {
          args.push("--objective", input.objective);
        }
        if (input.currentOrchestratorThreadId) {
          args.push("--current-orchestrator", input.currentOrchestratorThreadId);
        }
        if (input.status) {
          args.push("--status", input.status);
        }
        if (input.scope) {
          args.push("--scope-json", JSON.stringify(input.scope));
        }
        const payload = await runOwnerJsonCommand({
          commandPath: CONTROL_PLANE_OWNER_PATH,
          args,
          operation: "programs.create",
        });
        const result = asObject(payload);
        if (!result) {
          throw new AgentsVxappControlPlaneError({
            operation: "programs.create",
            detail: "Program owner returned an invalid create result.",
          });
        }
        return result satisfies ServerAgentsVxappOwnerMutationResult;
      },
    });

  const updateProgram: AgentsVxappControlPlaneShape["updateProgram"] = (input) =>
    tryPromiseAs({
      operation: "programs.update",
      detail: "Failed to update Program.",
      try: async () => {
        if (input.executiveProjectId === null || input.executiveThreadId === null) {
          throw new AgentsVxappControlPlaneError({
            operation: "programs.update",
            detail: "Clearing executive assignment is not supported by the current Program owner.",
          });
        }

        const mutationResult: JsonRecord = {
          action: "updated",
          ok: true,
          programId: input.programId,
        };
        const hasMetadataChange =
          input.title !== undefined ||
          input.objective !== undefined ||
          input.executiveProjectId !== undefined ||
          input.executiveThreadId !== undefined ||
          input.currentOrchestratorThreadId !== undefined ||
          input.clearCurrentOrchestratorThreadId === true;

        if (hasMetadataChange) {
          const args = ["programs-update", "--program", input.programId];
          if (typeof input.title === "string" && input.title.trim().length > 0) {
            args.push("--title", input.title);
          }
          if (typeof input.objective === "string" && input.objective.trim().length > 0) {
            args.push("--objective", input.objective);
          }
          if (input.executiveProjectId) {
            args.push("--executive-project", input.executiveProjectId);
          }
          if (input.executiveThreadId) {
            args.push("--executive-thread", input.executiveThreadId);
          }
          if (input.clearCurrentOrchestratorThreadId) {
            args.push("--clear-current-orchestrator");
          } else if (input.currentOrchestratorThreadId) {
            args.push("--current-orchestrator", input.currentOrchestratorThreadId);
          }
          mutationResult.metadata = asObject(
            await runOwnerJsonCommand({
              commandPath: CONTROL_PLANE_OWNER_PATH,
              args,
              operation: "programs.update",
            }),
          );
        }

        if (input.scope) {
          mutationResult.scope = asObject(
            await runOwnerJsonCommand({
              commandPath: CONTROL_PLANE_OWNER_PATH,
              args: [
                "programs-update-scope",
                "--program",
                input.programId,
                "--scope-json",
                JSON.stringify(input.scope),
              ],
              operation: "programs.updateScope",
            }),
          );
        }

        return mutationResult satisfies ServerAgentsVxappOwnerMutationResult;
      },
    });

  const deleteProgram: AgentsVxappControlPlaneShape["deleteProgram"] = (input) =>
    tryPromiseAs({
      operation: "programs.delete",
      detail: "Failed to delete Program.",
      try: async () => {
        const payload = await runOwnerJsonCommand({
          commandPath: CONTROL_PLANE_OWNER_PATH,
          args: ["programs-delete", "--program", input.programId],
          operation: "programs.delete",
        });
        const result = asObject(payload);
        if (!result) {
          throw new AgentsVxappControlPlaneError({
            operation: "programs.delete",
            detail: "Program owner returned an invalid delete result.",
          });
        }
        return result satisfies ServerAgentsVxappOwnerMutationResult;
      },
    });

  const setProgramLifecycle: AgentsVxappControlPlaneShape["setProgramLifecycle"] = (input) =>
    tryPromiseAs({
      operation: `programs.lifecycle.${input.action}`,
      detail: "Failed to update Program lifecycle.",
      try: async () => {
        let args: string[];
        switch (input.action) {
          case "set-status":
            if (!input.nextStatus) {
              throw new AgentsVxappControlPlaneError({
                operation: "programs.lifecycle",
                detail: "Program status updates require a next status.",
              });
            }
            args = [
              "programs-set-status",
              "--program",
              input.programId,
              "--status",
              input.nextStatus,
            ];
            break;
          case "founder-review-ready":
            args = ["programs-founder-review-ready", "--program", input.programId];
            break;
          case "complete":
            args = ["programs-complete", "--program", input.programId];
            break;
          case "cancel":
            if (!input.reason || input.reason.trim().length === 0) {
              throw new AgentsVxappControlPlaneError({
                operation: "programs.lifecycle",
                detail: "Cancelling a Program requires a reason.",
              });
            }
            args = ["programs-cancel", "--program", input.programId, "--reason", input.reason];
            if (input.supersededByProgramId) {
              args.push("--superseded-by-program", input.supersededByProgramId);
            }
            break;
        }

        const payload = await runOwnerJsonCommand({
          commandPath: CONTROL_PLANE_OWNER_PATH,
          args,
          operation: `programs.lifecycle.${input.action}`,
        });
        const result = asObject(payload);
        if (!result) {
          throw new AgentsVxappControlPlaneError({
            operation: `programs.lifecycle.${input.action}`,
            detail: "Program owner returned an invalid lifecycle result.",
          });
        }
        return result satisfies ServerAgentsVxappOwnerMutationResult;
      },
    });

  const createTodo: AgentsVxappControlPlaneShape["createTodo"] = (input) =>
    Effect.gen(function* () {
      const title = input.title.trim();
      if (title.length === 0) {
        return yield* new AgentsVxappControlPlaneError({
          operation: "todos.create",
          detail: "Todo title is required.",
        });
      }

      const todoId = (input.todoId?.trim() || slugifyTitle(title)).trim();
      if (!validateTodoId(todoId)) {
        return yield* new AgentsVxappControlPlaneError({
          operation: "todos.create",
          detail: "Todo id may contain only letters, numbers, dot, underscore, and dash.",
        });
      }

      const targetPath = buildTodoFilePath(input.agent, todoId);
      const exists = yield* fileSystem.exists(targetPath).pipe(
        mapFileSystemError("todos.create", "Failed to inspect TODO path."),
        Effect.orElseSucceed(() => false),
      );
      if (exists) {
        return yield* new AgentsVxappControlPlaneError({
          operation: "todos.create",
          detail: `Todo '${todoId}' already exists for agent '${input.agent}'.`,
        });
      }

      const timestamp = nowIso();
      const planLinks = nextPlanLinks({
        existing: {},
        requestedPlanLinks: (input.planLinks ?? []).map((link) => ({
          repo: link.repo,
          planKey: link.planKey,
          phase: link.phase ?? null,
          step: link.step ?? null,
        })),
        updatedAt: timestamp,
      });

      const payload: JsonRecord = {
        schema_version: "1.0",
        entity_family: "todo",
        todoId,
        owner: { agent: input.agent },
        programId: input.programId ?? null,
        title,
        summary: input.summary ?? "",
        status: input.status ?? "active",
        priority: input.priority ?? "normal",
        nextAction: input.nextAction ?? "",
        planLinks,
        notes: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      yield* fileSystem
        .makeDirectory(path.dirname(targetPath), { recursive: true })
        .pipe(mapFileSystemError("todos.create", "Failed to create TODO directory."));
      yield* fileSystem
        .writeFileString(targetPath, `${JSON.stringify(payload, null, 2)}\n`)
        .pipe(mapFileSystemError("todos.create", "Failed to write TODO file."));
      yield* tryPromiseAs({
        operation: "todos.create.sync",
        detail: "Failed to sync TODO projection.",
        try: () => syncTodoProjection(input.agent),
      });

      return {
        ok: true,
        action: "create",
        todoId,
        filePath: targetPath,
        todo: normalizeTodoSnapshot({ ...payload, filePath: targetPath }, input.agent),
      } satisfies ServerAgentsVxappOwnerMutationResult;
    });

  const updateTodo: AgentsVxappControlPlaneShape["updateTodo"] = (input) =>
    Effect.gen(function* () {
      const current = yield* tryPromiseAs({
        operation: "todos.update",
        detail: "Failed to load TODO.",
        try: () => loadTodoFile(fileSystem, input.agent, input.todoId),
      });

      const updatedAt = nowIso();
      const updated: JsonRecord = { ...current, updatedAt };
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (title.length === 0) {
          return yield* new AgentsVxappControlPlaneError({
            operation: "todos.update",
            detail: "Todo title cannot be empty.",
          });
        }
        updated.title = title;
      }
      if (input.programId !== undefined) {
        updated.programId = input.programId ?? null;
      }
      if (input.summary !== undefined) {
        updated.summary = input.summary;
      }
      if (input.nextAction !== undefined) {
        updated.nextAction = input.nextAction;
      }
      if (input.status !== undefined) {
        updated.status = input.status;
      }
      if (input.priority !== undefined) {
        updated.priority = input.priority;
      }
      if (input.planLinks !== undefined) {
        updated.planLinks = nextPlanLinks({
          existing: current,
          requestedPlanLinks: input.planLinks.map((link) => ({
            repo: link.repo,
            planKey: link.planKey,
            phase: link.phase ?? null,
            step: link.step ?? null,
          })),
          updatedAt,
        });
      }

      const filePath = buildTodoFilePath(input.agent, input.todoId);
      yield* fileSystem
        .writeFileString(filePath, `${JSON.stringify(updated, null, 2)}\n`)
        .pipe(mapFileSystemError("todos.update", "Failed to write TODO file."));
      yield* tryPromiseAs({
        operation: "todos.update.sync",
        detail: "Failed to sync TODO projection.",
        try: () => syncTodoProjection(input.agent),
      });

      return {
        ok: true,
        action: "update",
        todoId: input.todoId,
        filePath,
        todo: normalizeTodoSnapshot({ ...updated, filePath }, input.agent),
      } satisfies ServerAgentsVxappOwnerMutationResult;
    });

  const deleteTodo: AgentsVxappControlPlaneShape["deleteTodo"] = (input) =>
    Effect.gen(function* () {
      const filePath = buildTodoFilePath(input.agent, input.todoId);
      const exists = yield* fileSystem.exists(filePath).pipe(
        mapFileSystemError("todos.delete", "Failed to inspect TODO path."),
        Effect.orElseSucceed(() => false),
      );
      if (!exists) {
        return yield* new AgentsVxappControlPlaneError({
          operation: "todos.delete",
          detail: `Todo '${input.todoId}' for agent '${input.agent}' was not found.`,
        });
      }
      yield* fileSystem
        .remove(filePath)
        .pipe(mapFileSystemError("todos.delete", "Failed to delete TODO file."));
      yield* tryPromiseAs({
        operation: "todos.delete.sync",
        detail: "Failed to sync TODO projection.",
        try: () => syncTodoProjection(input.agent),
      });
      return {
        ok: true,
        action: "delete",
        todoId: input.todoId,
        agent: input.agent,
      } satisfies ServerAgentsVxappOwnerMutationResult;
    });

  return {
    getBindingAuthorityExport,
    getProgramAuthorityExport,
    getAttentionSummaryExport,
    getNotificationSummaryExport,
    getWatchSummaryExport,
    getProjectionAuthoritySnapshot,
    getSnapshot,
    createProgram,
    updateProgram,
    deleteProgram,
    setProgramLifecycle,
    createTodo,
    updateTodo,
    deleteTodo,
  } satisfies AgentsVxappControlPlaneShape;
});

export const AgentsVxappControlPlaneLive = Layer.effect(
  AgentsVxappControlPlane,
  makeAgentsVxappControlPlane,
);
