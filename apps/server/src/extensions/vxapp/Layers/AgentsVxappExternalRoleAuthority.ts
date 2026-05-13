import path from "node:path";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationThreadErrorPresentationSource,
  type OrchestrationLatestTurn,
  type OrchestrationProject,
  type OrchestrationProjectKind,
  type OrchestrationSession,
  type OrchestrationThreadSummary,
  type ProgramId,
  type ProjectId,
  type ProviderKind,
  type ThreadId,
  type ThreadLabel,
  type TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { runProcess } from "../../../processRunner.ts";
import { AGENTS_VXAPP_ROOT } from "../agentsVxappSqlite.ts";
import {
  AgentsVxappExternalRoleAuthority,
  AgentsVxappExternalRoleAuthorityError,
  type AgentsVxappExternalRoleAuthorityShape,
  type AgentsVxappExternalRoleAuthoritySnapshot,
} from "../Services/AgentsVxappExternalRoleAuthority.ts";

const CONTROL_PLANE_OWNER_PATH = path.join(
  AGENTS_VXAPP_ROOT,
  "scripts/tools/t3-control-plane-owner",
);
const OWNER_COMMAND_TIMEOUT_MS = 30_000;
const OWNER_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const isAgentsVxappExternalRoleAuthorityError = Schema.is(AgentsVxappExternalRoleAuthorityError);

type JsonRecord = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function ownerErrorDetail(payload: unknown, fallback: string): string {
  const object = asRecord(payload);
  const error = asRecord(object?.error);
  const message =
    asString(error?.message) ??
    asString(object?.message) ??
    asString(object?.detail) ??
    asString(object?.stderr);
  return message ?? fallback;
}

function parseJsonText(operation: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AgentsVxappExternalRoleAuthorityError({
      operation,
      detail: error instanceof Error ? error.message : "Command returned invalid JSON.",
    });
  }
}

async function runOwnerJsonCommand(input: {
  args: readonly string[];
  operation: string;
}): Promise<unknown> {
  const result = await runProcess(
    CONTROL_PLANE_OWNER_PATH,
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
    throw new AgentsVxappExternalRoleAuthorityError({
      operation: input.operation,
      detail: ownerErrorDetail(parsed, "t3-control-plane-owner failed."),
    });
  }
  return parsed;
}

function normalizeProviderKind(value: unknown): ProviderKind | null {
  const provider = asString(value);
  if (provider === "codex" || provider === "claudeAgent") {
    return provider;
  }
  if (provider === "claude" || provider === "claude-code") {
    return "claudeAgent";
  }
  return null;
}

function normalizeThreadLabels(value: unknown): ThreadLabel[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is ThreadLabel => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

function extractPrefixedLabelValue(labels: readonly string[], prefix: string): string | null {
  const entry = labels.find((label) => label.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function resolveModelSelection(input: {
  labels: readonly string[];
  session: JsonRecord | null;
}): ModelSelection {
  const provider =
    normalizeProviderKind(input.session?.providerName) ??
    normalizeProviderKind(extractPrefixedLabelValue(input.labels, "provider:")) ??
    "codex";
  const model =
    extractPrefixedLabelValue(input.labels, "model:") ?? DEFAULT_MODEL_BY_PROVIDER[provider];
  return {
    provider,
    model,
  };
}

function mapLatestTurn(value: unknown): OrchestrationLatestTurn | null {
  const latestTurn = asRecord(value);
  const turnId = asString(latestTurn?.id);
  const state = asString(latestTurn?.status);
  const requestedAt = asString(latestTurn?.requestedAt);
  if (
    !turnId ||
    !requestedAt ||
    (state !== "running" && state !== "interrupted" && state !== "completed" && state !== "error")
  ) {
    return null;
  }
  return {
    turnId: turnId as TurnId,
    state,
    requestedAt,
    startedAt: asString(latestTurn?.startedAt),
    completedAt: asString(latestTurn?.completedAt),
    assistantMessageId: null,
  };
}

function mapSession(input: {
  session: JsonRecord | null;
  threadId: ThreadId;
}): OrchestrationSession | null {
  const status = asString(input.session?.status);
  const updatedAt = asString(input.session?.updatedAt);
  if (
    !status ||
    !updatedAt ||
    !["idle", "starting", "running", "ready", "interrupted", "stopped", "error"].includes(status)
  ) {
    return null;
  }
  return {
    threadId: input.threadId,
    status: status as OrchestrationSession["status"],
    providerName: normalizeProviderKind(input.session?.providerName),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: (asString(input.session?.activeTurnId) as TurnId | null) ?? null,
    lastError: asString(input.session?.lastError),
    updatedAt,
  };
}

function mapThreadErrorPresentation(input: JsonRecord): {
  hasActiveError: boolean;
  activeError: string | null;
  historicalError: string | null;
  errorPresentationSource: OrchestrationThreadErrorPresentationSource;
} {
  const hasActiveError = input.hasActiveError;
  const activeError = asString(input.activeError);
  const historicalError = asString(input.historicalError);
  const errorPresentationSource = asString(input.errorPresentationSource);
  if (
    typeof hasActiveError !== "boolean" ||
    (errorPresentationSource !== "none" &&
      errorPresentationSource !== "active_session_last_error" &&
      errorPresentationSource !== "active_runtime_failure" &&
      errorPresentationSource !== "historical_session_last_error")
  ) {
    throw new Error("agents-vxapp thread payload is missing authoritative error presentation fields.");
  }
  if (hasActiveError && activeError === null) {
    throw new Error("agents-vxapp thread payload declared an active error without activeError.");
  }
  return {
    hasActiveError,
    activeError,
    historicalError,
    errorPresentationSource,
  };
}

function normalizeProjectKind(value: unknown): OrchestrationProjectKind {
  const kind = asString(value);
  return kind === "executive" || kind === "orchestrator" || kind === "project" ? kind : "project";
}

function mapThreadSummary(input: {
  roleRoot: JsonRecord;
  roleWorkspaceRoot: string | null;
}): OrchestrationThreadSummary | null {
  const currentThread = asRecord(input.roleRoot.currentThread);
  if (!currentThread) {
    return null;
  }
  const threadId = asString(currentThread.id) as ThreadId | null;
  const projectId = asString(currentThread.projectId) as ProjectId | null;
  const title = asString(currentThread.title);
  const createdAt = asString(currentThread.createdAt);
  const updatedAt = asString(currentThread.updatedAt);
  if (!threadId || !projectId || !title || !createdAt || !updatedAt) {
    return null;
  }
  const session = asRecord(currentThread.session);
  const labels = normalizeThreadLabels(currentThread.labels);
  const errorPresentation = mapThreadErrorPresentation(currentThread);
  return {
    id: threadId,
    projectId,
    title,
    labels,
    modelSelection: resolveModelSelection({ labels, session }),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: asString(currentThread.branch),
    worktreePath:
      asString(currentThread.worktreePath) ??
      asString(currentThread.workspaceRoot) ??
      input.roleWorkspaceRoot,
    latestTurn: mapLatestTurn(currentThread.latestTurn),
    createdAt,
    updatedAt,
    archivedAt: asString(currentThread.archivedAt),
    deletedAt: asString(currentThread.deletedAt),
    session: mapSession({ session, threadId }),
    orchestratorProjectId: undefined,
    orchestratorThreadId:
      (asString(currentThread.orchestratorThreadId) as ThreadId | null) ?? undefined,
    parentThreadId: (asString(currentThread.parentThreadId) as ThreadId | null) ?? undefined,
    spawnRole:
      currentThread.spawnRole === "orchestrator" ||
      currentThread.spawnRole === "worker" ||
      currentThread.spawnRole === "supervisor"
        ? currentThread.spawnRole
        : undefined,
    spawnedBy: asString(currentThread.spawnedBy) ?? undefined,
    workflowId: asString(currentThread.workflowId) ?? undefined,
    programId: (asString(currentThread.programId) as ProgramId | null) ?? undefined,
    executiveProjectId:
      (asString(currentThread.executiveProjectId) as ProjectId | null) ?? undefined,
    executiveThreadId: (asString(currentThread.executiveThreadId) as ThreadId | null) ?? undefined,
    ...errorPresentation,
  };
}

function mapProject(input: {
  roleRoot: JsonRecord;
  roleWorkspaceRoot: string | null;
  threadSummary: OrchestrationThreadSummary | null;
}): OrchestrationProject | null {
  const project = asRecord(input.roleRoot.project);
  if (!project) {
    return null;
  }
  const projectId = asString(project.id) as ProjectId | null;
  const title = asString(project.title) ?? input.roleWorkspaceRoot?.split("/").at(-1) ?? null;
  const workspaceRoot = asString(project.workspaceRoot) ?? input.roleWorkspaceRoot;
  const createdAt = asString(project.createdAt);
  const updatedAt = asString(project.updatedAt);
  if (!projectId || !title || !workspaceRoot || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id: projectId,
    title,
    workspaceRoot,
    kind: normalizeProjectKind(project.kind),
    sidebarParentProjectId: (asString(project.sidebarParentProjectId) as ProjectId | null) ?? null,
    currentSessionRootThreadId:
      ((asString(project.currentSessionRootThreadId) ??
        input.threadSummary?.id ??
        null) as ThreadId | null) ?? null,
    defaultModelSelection: input.threadSummary?.modelSelection ?? null,
    scripts: [],
    hooks: [],
    createdAt,
    updatedAt,
    deletedAt: asString(project.deletedAt),
  };
}

function collectRoleRootEntries(payload: unknown): JsonRecord[] {
  const result = asRecord(asRecord(payload)?.result);
  return ["cto", "jasper"]
    .map((key) => asRecord(result?.[key]))
    .filter((entry): entry is JsonRecord => entry !== null);
}

function buildSnapshot(payload: unknown): AgentsVxappExternalRoleAuthoritySnapshot {
  const projects: OrchestrationProject[] = [];
  const threadSummaries: OrchestrationThreadSummary[] = [];

  for (const roleRoot of collectRoleRootEntries(payload)) {
    const workspaceRoot = asString(roleRoot.workspaceRoot);
    const threadSummary = mapThreadSummary({ roleRoot, roleWorkspaceRoot: workspaceRoot });
    if (threadSummary) {
      threadSummaries.push(threadSummary);
    }
    const project = mapProject({ roleRoot, roleWorkspaceRoot: workspaceRoot, threadSummary });
    if (project) {
      projects.push(project);
    }
  }

  return {
    projects,
    threadSummaries,
  };
}

const makeAgentsVxappExternalRoleAuthority = Effect.succeed({
  getSnapshot: () =>
    Effect.tryPromise({
      try: async () =>
        buildSnapshot(
          await runOwnerJsonCommand({
            args: ["cto-status"],
            operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
          }),
        ),
      catch: (cause) =>
        isAgentsVxappExternalRoleAuthorityError(cause)
          ? cause
          : new AgentsVxappExternalRoleAuthorityError({
              operation: "AgentsVxappExternalRoleAuthority.getSnapshot",
              detail:
                cause instanceof Error
                  ? cause.message
                  : "Failed to load external role authority snapshot.",
            }),
    }),
} satisfies AgentsVxappExternalRoleAuthorityShape);

export const AgentsVxappExternalRoleAuthorityLive = Layer.effect(
  AgentsVxappExternalRoleAuthority,
  makeAgentsVxappExternalRoleAuthority,
);
