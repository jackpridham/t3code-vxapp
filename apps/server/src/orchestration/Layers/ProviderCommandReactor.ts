import {
  type ChatAttachment,
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationEvent,
  type ProviderSessionRuntimeStatus,
  type OrchestrationThread,
  ProviderKind,
  type OrchestrationSession,
  ThreadId,
  type ProviderSession,
  ProviderInteractionMode,
  type ProviderInteractionMode as ProviderInteractionModeType,
  RuntimeMode,
  type RuntimeMode as RuntimeModeType,
  type TurnId,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { threadHasLiveActiveTurn } from "@t3tools/orchestration-core/command-invariants";
import { Cache, Cause, Data, Duration, Effect, Equal, Layer, Option, Schema, Stream } from "effect";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { ProviderAdapterRequestError, ProviderServiceError } from "../../provider/Errors.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { TextGeneration } from "../../git/Services/TextGeneration.ts";
import { ProviderSessionDirectoryLive } from "../../provider/Layers/ProviderSessionDirectory.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  resolveLocalThreadErrorPresentation,
  type LocalThreadErrorPresentation,
} from "../localThreadErrorPresentation.ts";
import {
  AgentsVxappExternalRoleAuthority,
  buildExternalRoleAuthorityIndex,
} from "../../extensions/vxapp/Services/AgentsVxappExternalRoleAuthority.ts";
import { isAgentsVxappWorktreePath } from "../../extensions/vxapp/agentsVxappAuthorityPaths.ts";
import {
  requestAgentsVxappApprovalResponse,
  requestAgentsVxappThreadEventIngest,
  requestAgentsVxappUserInputResponse,
} from "../../extensions/vxapp/providerHarnessBridge.ts";

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.archived"
      | "thread.deleted"
      | "thread.runtime-mode-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.turn-diff-completed"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-set"
      | "thread.session-stop-requested";
  }
>;

function resolveProviderLocalThreadErrorPresentation(input: {
  readonly thread: OrchestrationThread;
  readonly latestTurnState: Parameters<
    typeof resolveLocalThreadErrorPresentation
  >[0]["latestTurnState"];
  readonly sessionStatus: Parameters<
    typeof resolveLocalThreadErrorPresentation
  >[0]["sessionStatus"];
  readonly sessionLastError: string | null;
  readonly worktreeAuthority: Parameters<typeof isAgentsVxappWorktreePath>[1];
}): LocalThreadErrorPresentation {
  if (isAgentsVxappWorktreePath(input.thread.worktreePath, input.worktreeAuthority)) {
    return {
      hasActiveError: input.thread.hasActiveError,
      activeError: input.thread.activeError,
      historicalError: input.thread.historicalError,
      errorPresentationSource: input.thread.errorPresentationSource,
    };
  }
  return resolveLocalThreadErrorPresentation({
    archivedAt: input.thread.archivedAt,
    deletedAt: input.thread.deletedAt,
    latestTurnState: input.latestTurnState,
    sessionStatus: input.sessionStatus,
    sessionLastError: input.sessionLastError,
  });
}

type SessionBoundaryFence = {
  readonly session: OrchestrationSession;
  readonly runtimeStatus: "running" | "stopped" | "error";
  readonly recentTerminalTurnIds: ReadonlyArray<TurnId>;
};

type OwnerProviderRequestStatus = "ready" | "blocked";

type OwnerThreadTurnStartProviderRequest = {
  readonly kind: "thread.turn.start";
  readonly requestId: string;
  readonly threadId: ThreadId;
  readonly message: string;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
};

type OwnerProviderRequestPayload = {
  readonly providerRequestStatus: OwnerProviderRequestStatus;
  readonly providerRequest?: unknown;
  readonly ownerRequestId?: unknown;
  readonly ownerDiagnostics?: unknown;
  readonly providerThreadId?: unknown;
  readonly providerTurnId?: unknown;
  readonly failureCode?: unknown;
  readonly failureMessage?: unknown;
  readonly legacyFallbackUsed?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ownerProviderRequestPayload(value: unknown): OwnerProviderRequestPayload | null {
  const record = asRecord(value);
  const providerRequestStatus = record ? asNonEmptyString(record.providerRequestStatus) : null;
  if (providerRequestStatus !== "ready" && providerRequestStatus !== "blocked") {
    return null;
  }
  return {
    providerRequestStatus,
    providerRequest: record?.providerRequest,
    ownerRequestId: record?.ownerRequestId,
    ownerDiagnostics: record?.ownerDiagnostics,
    providerThreadId: record?.providerThreadId,
    providerTurnId: record?.providerTurnId,
    failureCode: record?.failureCode,
    failureMessage: record?.failureMessage,
    legacyFallbackUsed: record?.legacyFallbackUsed,
  };
}

function ownerProviderRequestDiagnostic(payload: OwnerProviderRequestPayload): string {
  const failureCode = asNonEmptyString(payload.failureCode);
  const failureMessage = asNonEmptyString(payload.failureMessage);
  if (failureCode && failureMessage) {
    return `${failureCode}: ${failureMessage}`;
  }
  return failureMessage ?? failureCode ?? "Owner provider request was blocked.";
}

function ownerProviderRequestId(payload: OwnerProviderRequestPayload): string | null {
  const providerRequest = asRecord(payload.providerRequest);
  return asNonEmptyString(providerRequest?.requestId) ?? asNonEmptyString(payload.ownerRequestId);
}

function ownerProviderThreadId(
  payload: OwnerProviderRequestPayload,
  fallbackThreadId: ThreadId,
): ThreadId {
  return ThreadId.makeUnsafe(asNonEmptyString(payload.providerThreadId) ?? fallbackThreadId);
}

function decodeOwnerThreadTurnStartProviderRequest(
  value: unknown,
): OwnerThreadTurnStartProviderRequest | null {
  const record = asRecord(value);
  if (!record || record.kind !== "thread.turn.start") {
    return null;
  }
  const requestId = asNonEmptyString(record.requestId);
  const threadId = asNonEmptyString(record.threadId);
  const message = asNonEmptyString(record.message);
  if (!requestId || !threadId || !message) {
    return null;
  }
  return {
    kind: "thread.turn.start",
    requestId,
    threadId: ThreadId.makeUnsafe(threadId),
    message,
    ...(Schema.is(RuntimeMode)(record.runtimeMode) ? { runtimeMode: record.runtimeMode } : {}),
    ...(Schema.is(ProviderInteractionMode)(record.interactionMode)
      ? { interactionMode: record.interactionMode }
      : {}),
  };
}

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): ProviderSessionRuntimeStatus {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

function ownerThreadSessionSetProvenance(
  occurredAt: string,
): Readonly<Record<"source" | "eventType" | "occurredAt", string>> {
  return {
    source: "t3code-vxapp.provider-command-reactor",
    eventType: "thread.session-set",
    occurredAt,
  };
}

function buildStoppedOwnerThreadSessionPayload(input: {
  readonly thread: OrchestrationThread;
  readonly updatedAt: string;
}) {
  return {
    status: "stopped" as const,
    providerName: input.thread.session?.providerName ?? null,
    runtimeMode: input.thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: input.thread.session?.lastError ?? null,
    updatedAt: input.updatedAt,
  };
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const SESSION_BOUNDARY_FENCE_TERMINAL_TURN_MAX = 4;
const DEFAULT_RUNTIME_MODE: RuntimeModeType = "full-access";
const WORKTREE_BRANCH_PREFIX = "t3code";
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(`^${WORKTREE_BRANCH_PREFIX}\\/[0-9a-f]{8}$`);
const DEFAULT_THREAD_TITLE = "New thread";
const INSTRUCTION_SURFACE_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;
const INSTRUCTION_FINGERPRINT_KEY = "instructionFingerprint";

function runtimePayloadInstructionFingerprint(value: unknown): string | null {
  const record = asRecord(value);
  return asNonEmptyString(record?.[INSTRUCTION_FINGERPRINT_KEY]);
}

function computeEffectiveInstructionFingerprint(cwd: string | undefined): string | null {
  const normalizedCwd = toNonEmptyProviderInput(cwd);
  if (!normalizedCwd) {
    return null;
  }
  const hash = createHash("sha256");
  const seen = new Set<string>();
  let currentDir = path.resolve(normalizedCwd);
  while (!seen.has(currentDir)) {
    seen.add(currentDir);
    for (const filename of INSTRUCTION_SURFACE_FILENAMES) {
      const filePath = path.join(currentDir, filename);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      hash.update(filePath);
      hash.update("\u0000");
      hash.update(fs.readFileSync(filePath));
      hash.update("\u0000");
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return hash.digest("hex");
}

function ensureThreadHasNoLiveActiveTurn(
  thread: {
    readonly id: ThreadId;
    readonly session: OrchestrationSession | null;
  },
  source: string,
) {
  const activeTurnId = thread.session?.activeTurnId ?? null;
  if (!threadHasLiveActiveTurn(thread) || activeTurnId === null) {
    return Effect.void;
  }

  return Effect.fail(
    new Error(
      `Cannot start a new provider turn from ${source}; thread '${thread.id}' already has active turn '${activeTurnId}'.`,
    ),
  );
}

function canReplaceThreadTitle(currentTitle: string, titleSeed?: string): boolean {
  const trimmedCurrentTitle = currentTitle.trim();
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) {
    return true;
  }

  const trimmedTitleSeed = titleSeed?.trim();
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function ownerErrorDetail(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "detail" in error &&
    typeof (error as { detail?: unknown }).detail === "string"
  ) {
    return (error as { detail: string }).detail;
  }
  return error instanceof Error ? error.message : "agents-vxapp owner command failed.";
}

class OwnerCommandFailure extends Data.TaggedError("OwnerCommandFailure")<{
  readonly detail: string;
}> {}

function isTemporaryWorktreeBranch(branch: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(branch.trim().toLowerCase());
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const providerSessionDirectory = yield* ProviderSessionDirectory;
  const git = yield* GitCore;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();
  const sessionBoundaryFences = new Map<string, SessionBoundaryFence>();
  const getWorktreeAuthority = () =>
    Effect.serviceOption(AgentsVxappExternalRoleAuthority).pipe(
      Effect.flatMap((externalRoleAuthorityOption) =>
        Option.match(externalRoleAuthorityOption, {
          onNone: () => Effect.succeed<null>(null),
          onSome: (externalRoleAuthority) =>
            Effect.all({
              runtimePaths: externalRoleAuthority.getRuntimePaths(),
              externalSnapshot: externalRoleAuthority.getSnapshot(),
            }).pipe(
              Effect.map(({ runtimePaths, externalSnapshot }) => ({
                runtimePaths,
                authoritativeWorktreePaths:
                  buildExternalRoleAuthorityIndex(externalSnapshot).worktreePaths,
              })),
            ),
        }),
      ),
    );

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed"
      | "provider.thread.status.sync.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
    readonly ownerRequestId?: string | null;
    readonly transportStatus?: "failed" | "rejected";
    readonly providerThreadId?: ThreadId;
    readonly providerTurnId?: string | null;
    readonly error?: string;
    readonly ownerDiagnostics?: unknown;
    readonly legacyFallbackUsed?: unknown;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("provider-failure-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: input.kind,
        summary: input.summary,
        payload: {
          detail: input.detail,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(input.ownerRequestId ? { ownerRequestId: input.ownerRequestId } : {}),
          ...(input.transportStatus ? { transportStatus: input.transportStatus } : {}),
          ...(input.providerThreadId ? { providerThreadId: input.providerThreadId } : {}),
          ...(input.providerTurnId !== undefined ? { providerTurnId: input.providerTurnId } : {}),
          ...(input.error ? { error: input.error } : {}),
          ...(input.ownerDiagnostics !== undefined
            ? { ownerDiagnostics: input.ownerDiagnostics }
            : {}),
          ...(input.legacyFallbackUsed !== undefined
            ? { legacyFallbackUsed: input.legacyFallbackUsed }
            : {}),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly errorPresentation: LocalThreadErrorPresentation;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: serverCommandId("provider-session-set"),
      threadId: input.threadId,
      session: input.session,
      ...input.errorPresentation,
      createdAt: input.createdAt,
    });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.threads.find((entry) => entry.id === threadId);
  });

  const synchronizeAuthoritativeSessionState = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly runtimeStatus: "running" | "stopped" | "error";
    readonly runtimeEvent: string;
    readonly recentTerminalTurnId?: TurnId;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }

    const providerName = thread.session?.providerName ?? thread.modelSelection.provider;
    const runtimeProvider =
      providerName === "claudeAgent" || thread.modelSelection.provider === "claudeAgent"
        ? "claudeAgent"
        : "codex";
    const runtimeMode = input.session.runtimeMode ?? thread.runtimeMode ?? DEFAULT_RUNTIME_MODE;

    const worktreeAuthority = yield* getWorktreeAuthority();
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...input.session,
        threadId: input.threadId,
        providerName,
        runtimeMode,
      },
      errorPresentation: resolveProviderLocalThreadErrorPresentation({
        thread,
        latestTurnState: thread.latestTurn?.state ?? null,
        sessionStatus: input.session.status,
        sessionLastError: input.session.lastError,
        worktreeAuthority,
      }),
      createdAt: input.session.updatedAt,
    });

    yield* providerSessionDirectory.upsert({
      threadId: input.threadId,
      provider: runtimeProvider,
      runtimeMode,
      status: input.runtimeStatus,
      runtimePayload: {
        activeTurnId: input.session.activeTurnId,
        lastError: input.session.lastError,
        lastRuntimeEvent: input.runtimeEvent,
        lastRuntimeEventAt: input.session.updatedAt,
      },
    });

    const existingFence = sessionBoundaryFences.get(input.threadId);
    const recentTerminalTurnIds = input.recentTerminalTurnId
      ? [
          input.recentTerminalTurnId,
          ...(existingFence?.recentTerminalTurnIds ?? []).filter(
            (turnId) => !sameId(turnId, input.recentTerminalTurnId),
          ),
        ].slice(0, SESSION_BOUNDARY_FENCE_TERMINAL_TURN_MAX)
      : (existingFence?.recentTerminalTurnIds ?? []);

    sessionBoundaryFences.set(input.threadId, {
      session: {
        ...input.session,
        threadId: input.threadId,
        providerName,
        runtimeMode,
      },
      runtimeStatus: input.runtimeStatus,
      recentTerminalTurnIds,
    });
  });

  const ensureSessionForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly runtimeMode?: RuntimeModeType;
    },
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = options?.runtimeMode ?? thread.runtimeMode;
    const currentProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName,
    )
      ? thread.session.providerName
      : undefined;
    const requestedModelSelection = options?.modelSelection;
    const threadProvider: ProviderKind = currentProvider ?? thread.modelSelection.provider;
    if (
      requestedModelSelection !== undefined &&
      requestedModelSelection.provider !== threadProvider
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: threadProvider,
        method: "thread.turn.start",
        detail: `Thread '${threadId}' is bound to provider '${threadProvider}' and cannot switch to '${requestedModelSelection.provider}'.`,
      });
    }
    const preferredProvider: ProviderKind = currentProvider ?? threadProvider;
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });
    const desiredInstructionFingerprint = computeEffectiveInstructionFingerprint(effectiveCwd);

    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const persistInstructionFingerprint = (
      session: ProviderSession,
      instructionFingerprint: string | null,
    ) =>
      providerSessionDirectory.upsert({
        threadId,
        provider: session.provider,
        runtimeMode: session.runtimeMode,
        status: mapProviderSessionStatusToOrchestrationStatus(session.status),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: {
          [INSTRUCTION_FINGERPRINT_KEY]: instructionFingerprint,
        },
      });

    const clearPersistedResumeCursor = (provider: ProviderKind) =>
      providerSessionDirectory.upsert({
        threadId,
        provider,
        resumeCursor: null,
      });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderKind;
      readonly clearPersistedResumeCursor?: boolean;
    }) =>
      Effect.gen(function* () {
        const providerForSession = input?.provider ?? preferredProvider;
        if (input?.clearPersistedResumeCursor && providerForSession !== undefined) {
          yield* clearPersistedResumeCursor(providerForSession);
        }
        const session = yield* providerService.startSession(threadId, {
          threadId,
          projectId: thread.projectId,
          ...(providerForSession ? { provider: providerForSession } : {}),
          ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
          modelSelection: desiredModelSelection,
          ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
          runtimeMode: desiredRuntimeMode,
        });
        yield* persistInstructionFingerprint(session, desiredInstructionFingerprint);
        return session;
      });

    const bindSessionToThread = (session: ProviderSession) =>
      getWorktreeAuthority().pipe(
        Effect.flatMap((worktreeAuthority) =>
          setThreadSession({
            threadId,
            session: {
              threadId,
              status: mapProviderSessionStatusToOrchestrationStatus(session.status),
              providerName: session.provider,
              runtimeMode: desiredRuntimeMode,
              // Provider turn ids are not orchestration turn ids.
              activeTurnId: null,
              lastError: session.lastError ?? null,
              updatedAt: session.updatedAt,
            },
            errorPresentation: resolveProviderLocalThreadErrorPresentation({
              thread,
              latestTurnState: thread.latestTurn?.state ?? null,
              sessionStatus: mapProviderSessionStatusToOrchestrationStatus(session.status),
              sessionLastError: session.lastError ?? null,
              worktreeAuthority,
            }),
            createdAt,
          }),
        ),
      );

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" ? thread.id : null;
    const persistedBinding = Option.getOrUndefined(
      yield* providerSessionDirectory.getBinding(threadId),
    );
    const persistedInstructionFingerprint = runtimePayloadInstructionFingerprint(
      persistedBinding?.runtimePayload,
    );
    const instructionFingerprintChanged =
      persistedInstructionFingerprint !== desiredInstructionFingerprint;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const providerChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.provider !== currentProvider;
      const activeSession = yield* resolveActiveSession(existingSessionThreadId);
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const sessionModelSwitch =
        currentProvider === undefined
          ? "in-session"
          : (yield* providerService.getCapabilities(currentProvider)).sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "restart-session";
      const previousModelSelection = threadModelSelections.get(threadId);
      const shouldRestartForModelSelectionChange =
        currentProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);
      const shouldRestartForInstructionChange = instructionFingerprintChanged;

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !providerChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange &&
        !shouldRestartForInstructionChange
      ) {
        return existingSessionThreadId;
      }

      const resumeCursor =
        providerChanged || shouldRestartForModelChange || shouldRestartForInstructionChange
          ? undefined
          : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider,
        desiredProvider: desiredModelSelection.provider,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        providerChanged,
        modelChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        persistedInstructionFingerprint,
        desiredInstructionFingerprint,
        shouldRestartForInstructionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession({
        ...(resumeCursor !== undefined ? { resumeCursor } : {}),
        clearPersistedResumeCursor: shouldRestartForInstructionChange,
      });
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToThread(restartedSession);
      return restartedSession.threadId;
    }

    const startedSession = yield* startProviderSession({
      clearPersistedResumeCursor: instructionFingerprintChanged,
    });
    yield* bindSessionToThread(startedSession);
    return startedSession.threadId;
  });

  const sendTurnForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly runtimeMode?: RuntimeModeType;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    yield* ensureThreadHasNoLiveActiveTurn(thread, "sendTurnForThread:preflight");
    yield* ensureSessionForThread(
      input.threadId,
      input.createdAt,
      input.modelSelection !== undefined || input.runtimeMode !== undefined
        ? {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            ...(input.runtimeMode !== undefined ? { runtimeMode: input.runtimeMode } : {}),
          }
        : {},
    );
    const preparedThread = (yield* resolveThread(input.threadId)) ?? thread;
    yield* ensureThreadHasNoLiveActiveTurn(preparedThread, "sendTurnForThread:pre-send");
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, input.modelSelection);
    }
    const normalizedInput = toNonEmptyProviderInput(input.messageText);
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : (yield* providerService.getCapabilities(activeSession.provider)).sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported"
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    const startedTurn = yield* providerService.sendTurn({
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    });
    const authoritativeTurnId = startedTurn.turnId;

    const refreshedThread = yield* resolveThread(input.threadId);
    const currentSession = refreshedThread?.session ?? thread.session;
    if (
      currentSession?.status === "running" &&
      ((authoritativeTurnId === null && currentSession.activeTurnId === null) ||
        (authoritativeTurnId !== null &&
          currentSession.activeTurnId !== null &&
          sameId(currentSession.activeTurnId, authoritativeTurnId)))
    ) {
      return;
    }

    yield* synchronizeAuthoritativeSessionState({
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: "running",
        providerName:
          currentSession?.providerName ?? activeSession?.provider ?? thread.modelSelection.provider,
        runtimeMode: currentSession?.runtimeMode ?? thread.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: authoritativeTurnId,
        lastError: null,
        updatedAt: input.createdAt,
      },
      runtimeStatus: "running",
      runtimeEvent: "provider-command-reactor.sendTurn",
    });
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* serverSettingsService.getSettings;

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* git.renameBranch({
        cwd,
        oldBranch,
        newBranch: targetBranch,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateThreadTitleForFirstTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly titleSeed?: string;
  }) {
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* serverSettingsService.getSettings;

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: input.cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const thread = yield* resolveThread(input.threadId);
      if (!thread) return;
      if (!canReplaceThreadTitle(thread.title, input.titleSeed)) {
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("thread-title-rename"),
        threadId: input.threadId,
        title: generated.title,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename thread title", {
          threadId: input.threadId,
          cwd: input.cwd,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const processTurnStartRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const ownerPayload = ownerProviderRequestPayload(event.payload);
    if (ownerPayload) {
      if (ownerPayload.providerRequestStatus === "blocked") {
        const detail = ownerProviderRequestDiagnostic(ownerPayload);
        yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.start.failed",
          summary: "Owner provider request blocked",
          detail,
          turnId: null,
          createdAt: event.payload.createdAt,
          ownerRequestId: ownerProviderRequestId(ownerPayload),
          transportStatus: "rejected",
          providerThreadId: ownerProviderThreadId(ownerPayload, event.payload.threadId),
          providerTurnId: asNonEmptyString(ownerPayload.providerTurnId),
          error: detail,
          ownerDiagnostics: ownerPayload.ownerDiagnostics,
          legacyFallbackUsed: ownerPayload.legacyFallbackUsed,
        });
        return;
      }

      const providerRequest = decodeOwnerThreadTurnStartProviderRequest(
        ownerPayload.providerRequest,
      );
      if (!providerRequest) {
        const detail =
          "Owner providerRequestStatus was ready, but providerRequest.kind was not thread.turn.start or required fields were missing.";
        yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.start.failed",
          summary: "Owner provider request failed closed",
          detail,
          turnId: null,
          createdAt: event.payload.createdAt,
          ownerRequestId: ownerProviderRequestId(ownerPayload),
          transportStatus: "rejected",
          providerThreadId: ownerProviderThreadId(ownerPayload, event.payload.threadId),
          providerTurnId: asNonEmptyString(ownerPayload.providerTurnId),
          error: detail,
          ownerDiagnostics: ownerPayload.ownerDiagnostics,
          legacyFallbackUsed: ownerPayload.legacyFallbackUsed,
        });
        return;
      }

      yield* sendTurnForThread({
        threadId: providerRequest.threadId,
        messageText: providerRequest.message,
        ...(providerRequest.runtimeMode !== undefined
          ? { runtimeMode: providerRequest.runtimeMode }
          : {}),
        ...(providerRequest.interactionMode !== undefined
          ? { interactionMode: providerRequest.interactionMode }
          : {}),
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: providerRequest.threadId,
            kind: "provider.turn.start.failed",
            summary: "Owner provider request failed",
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: providerRequest.requestId,
            ownerRequestId: providerRequest.requestId,
            transportStatus: "failed",
            providerThreadId: providerRequest.threadId,
            providerTurnId: asNonEmptyString(ownerPayload.providerTurnId),
            error: Cause.pretty(cause),
            ownerDiagnostics: ownerPayload.ownerDiagnostics,
            legacyFallbackUsed: ownerPayload.legacyFallbackUsed,
          }),
        ),
      );
      return;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const isFirstUserMessageTurn =
      thread.messages.filter((entry) => entry.role === "user").length === 1;
    if (isFirstUserMessageTurn) {
      const generationCwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: (yield* orchestrationEngine.getReadModel()).projects,
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        ...generationInput,
      }).pipe(Effect.forkScoped);

      if (canReplaceThreadTitle(thread.title, event.payload.titleSeed)) {
        yield* maybeGenerateThreadTitleForFirstTurn({
          threadId: event.payload.threadId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    yield* sendTurnForThread({
      threadId: event.payload.threadId,
      messageText: message.text,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.catchCause((cause) =>
        appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.start.failed",
          summary: "Provider turn start failed",
          detail: Cause.pretty(cause),
          turnId: null,
          createdAt: event.payload.createdAt,
        }),
      ),
    );
  });

  const processTurnInterruptRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService.interruptTurn({ threadId: event.payload.threadId });
  });

  const processTurnDiffCompleted = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-diff-completed" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread?.session) {
      return;
    }

    if (!sameId(thread.session.activeTurnId, event.payload.turnId)) {
      return;
    }

    if (thread.session.status === "running") {
      return;
    }

    const sessionStatus = event.payload.status === "error" ? "error" : "ready";
    const lastError =
      sessionStatus === "error"
        ? (thread.session.lastError ?? "Turn completed with errors.")
        : null;

    yield* synchronizeAuthoritativeSessionState({
      threadId: event.payload.threadId,
      session: {
        threadId: event.payload.threadId,
        status: sessionStatus,
        providerName: thread.session.providerName ?? thread.modelSelection.provider,
        runtimeMode: thread.session.runtimeMode ?? thread.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError,
        updatedAt: event.payload.completedAt,
      },
      runtimeStatus: sessionStatus === "error" ? "error" : "stopped",
      runtimeEvent: "thread.turn-diff-completed",
      recentTerminalTurnId: event.payload.turnId,
    });
  });

  const processObservedSessionSet = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-set" }>,
  ) {
    const fence = sessionBoundaryFences.get(event.payload.threadId);
    if (!fence) {
      return;
    }

    const session = event.payload.session;
    const isKnownTerminalTurn =
      session.activeTurnId !== null &&
      fence.recentTerminalTurnIds.some((turnId) => sameId(turnId, session.activeTurnId));
    const isOlderThanFence = session.updatedAt < fence.session.updatedAt;

    if (isKnownTerminalTurn || isOlderThanFence) {
      if (
        session.status === fence.session.status &&
        sameId(session.activeTurnId, fence.session.activeTurnId) &&
        session.updatedAt === fence.session.updatedAt &&
        (session.lastError ?? null) === (fence.session.lastError ?? null)
      ) {
        return;
      }

      yield* synchronizeAuthoritativeSessionState({
        threadId: event.payload.threadId,
        session: fence.session,
        runtimeStatus: fence.runtimeStatus,
        runtimeEvent: "provider-command-reactor.session-boundary-fence",
      });
      return;
    }

    if (session.status !== "running" || session.activeTurnId === null) {
      return;
    }

    sessionBoundaryFences.set(event.payload.threadId, {
      session,
      runtimeStatus: "running",
      recentTerminalTurnIds: fence.recentTerminalTurnIds,
    });
  });

  const processApprovalResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    const ownerAccepted = yield* Effect.tryPromise({
      try: () =>
        requestAgentsVxappApprovalResponse({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          decision: event.payload.decision,
          resolvedAt: event.payload.createdAt,
        }),
      catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
    }).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.approval.respond.failed",
          summary: "Provider approval response failed",
          detail: ownerErrorDetail(error),
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        }).pipe(Effect.as(false)),
      ),
    );

    if (!ownerAccepted) {
      return;
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.approval.respond.failed",
              summary: "Provider approval response failed",
              detail: isUnknownPendingApprovalRequestError(cause)
                ? stalePendingRequestDetail("approval", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            });

            if (!isUnknownPendingApprovalRequestError(cause)) return;
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    const ownerAccepted = yield* Effect.tryPromise({
      try: () =>
        requestAgentsVxappUserInputResponse({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
          resolvedAt: event.payload.createdAt,
        }),
      catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
    }).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: ownerErrorDetail(error),
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        }).pipe(Effect.as(false)),
      ),
    );

    if (!ownerAccepted) {
      return;
    }

    yield* providerService
      .respondToUserInput({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        answers: event.payload.answers,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.user-input.respond.failed",
            summary: "Provider user input response failed",
            detail: isUnknownPendingUserInputRequestError(cause)
              ? stalePendingRequestDetail("user-input", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processSessionStopRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    if (thread.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    const worktreeAuthority = yield* getWorktreeAuthority();
    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      errorPresentation: resolveProviderLocalThreadErrorPresentation({
        thread,
        latestTurnState: thread.latestTurn?.state ?? null,
        sessionStatus: "stopped",
        sessionLastError: thread.session?.lastError ?? null,
        worktreeAuthority,
      }),
      createdAt: now,
    });
    if (isAgentsVxappWorktreePath(thread.worktreePath, worktreeAuthority)) {
      yield* Effect.tryPromise({
        try: () =>
          requestAgentsVxappThreadEventIngest({
            threadId: thread.id,
            session: buildStoppedOwnerThreadSessionPayload({
              thread,
              updatedAt: now,
            }),
            ownerProvenance: ownerThreadSessionSetProvenance(now),
          }),
        catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
      }).pipe(
        Effect.catchTag("OwnerCommandFailure", (error) =>
          appendProviderFailureActivity({
            threadId: thread.id,
            kind: "provider.thread.status.sync.failed",
            summary: "Provider thread session sync failed",
            detail: error.detail,
            turnId: null,
            createdAt: now,
          }),
        ),
      );
    }
    sessionBoundaryFences.delete(thread.id);
  });

  const processThreadArchived = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.archived" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    const archivedAt = event.payload.archivedAt;
    if (thread?.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    if (thread) {
      const worktreeAuthority = yield* getWorktreeAuthority();
      yield* setThreadSession({
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "stopped",
          providerName: thread.session?.providerName ?? null,
          runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          activeTurnId: null,
          lastError: thread.session?.lastError ?? null,
          updatedAt: archivedAt,
        },
        errorPresentation: resolveProviderLocalThreadErrorPresentation({
          thread,
          latestTurnState: thread.latestTurn?.state ?? null,
          sessionStatus: "stopped",
          sessionLastError: thread.session?.lastError ?? null,
          worktreeAuthority,
        }),
        createdAt: archivedAt,
      });
      if (isAgentsVxappWorktreePath(thread.worktreePath, worktreeAuthority)) {
        yield* Effect.tryPromise({
          try: () =>
            requestAgentsVxappThreadEventIngest({
              threadId: thread.id,
              session: buildStoppedOwnerThreadSessionPayload({
                thread,
                updatedAt: archivedAt,
              }),
              ownerProvenance: ownerThreadSessionSetProvenance(archivedAt),
            }),
          catch: (error) => new OwnerCommandFailure({ detail: ownerErrorDetail(error) }),
        }).pipe(
          Effect.catchTag("OwnerCommandFailure", (error) =>
            appendProviderFailureActivity({
              threadId: thread.id,
              kind: "provider.thread.status.sync.failed",
              summary: "Provider thread session sync failed",
              detail: error.detail,
              turnId: null,
              createdAt: archivedAt,
            }),
          ),
        );
      }
    }

    yield* providerSessionDirectory.remove(event.payload.threadId);
    sessionBoundaryFences.delete(event.payload.threadId);
  });

  const processThreadDeleted = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.deleted" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (thread?.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    yield* providerSessionDirectory.remove(event.payload.threadId);
    sessionBoundaryFences.delete(event.payload.threadId);
  });

  const processDomainEvent = (event: ProviderIntentEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.archived":
          yield* processThreadArchived(event);
          return;
        case "thread.deleted":
          yield* processThreadDeleted(event);
          return;
        case "thread.runtime-mode-set": {
          const thread = yield* resolveThread(event.payload.threadId);
          if (!thread?.session || thread.session.status === "stopped") {
            return;
          }
          const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
          yield* ensureSessionForThread(
            event.payload.threadId,
            event.occurredAt,
            cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
          );
          return;
        }
        case "thread.turn-start-requested":
          yield* processTurnStartRequested(event);
          return;
        case "thread.turn-interrupt-requested":
          yield* processTurnInterruptRequested(event);
          return;
        case "thread.turn-diff-completed":
          yield* processTurnDiffCompleted(event);
          return;
        case "thread.approval-response-requested":
          yield* processApprovalResponseRequested(event);
          return;
        case "thread.user-input-response-requested":
          yield* processUserInputResponseRequested(event);
          return;
        case "thread.session-set":
          yield* processObservedSessionSet(event);
          return;
        case "thread.session-stop-requested":
          yield* processSessionStopRequested(event);
          return;
      }
    });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        event.type === "thread.archived" ||
        event.type === "thread.deleted" ||
        event.type === "thread.runtime-mode-set" ||
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.turn-interrupt-requested" ||
        event.type === "thread.turn-diff-completed" ||
        event.type === "thread.approval-response-requested" ||
        event.type === "thread.user-input-response-requested" ||
        event.type === "thread.session-set" ||
        event.type === "thread.session-stop-requested"
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make).pipe(
  Layer.provideMerge(
    ProviderSessionDirectoryLive.pipe(Layer.provideMerge(ProviderSessionRuntimeRepositoryLive)),
  ),
);
