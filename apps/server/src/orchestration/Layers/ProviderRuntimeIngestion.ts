import {
  ApprovalRequestId,
  type AssistantDeliveryMode,
  CommandId,
  EventId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationProposedPlanId,
  CheckpointRef,
  isToolLifecycleItemType,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { Cache, Cause, Duration, Effect, Layer, Option, Stream } from "effect";
import { projectThinkingActivitiesFromRuntimeEvent } from "@t3tools/orchestration-core/provider-thinking-activities";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProviderSessionDirectoryLive } from "../../provider/Layers/ProviderSessionDirectory.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../../persistence/Layers/ProviderSessionRuntime.ts";
import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProjectHooksService } from "../../projectHooks/Services/ProjectHooksService.ts";
import { notifyOrchestratorChatMessage } from "../orchestratorNotify.ts";

const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;
const providerCommandId = (event: ProviderRuntimeEvent, tag: string): CommandId =>
  CommandId.makeUnsafe(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`);

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.T3CODE_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

type RuntimeIngestionInput =
  | {
      source: "runtime";
      event: ProviderRuntimeEvent;
    }
  | {
      source: "domain";
      event: TurnStartRequestedDomainEvent;
    };

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.makeUnsafe(String(value));
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : ApprovalRequestId.makeUnsafe(value);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function readRuntimePayloadRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readRuntimePayloadTurnId(value: unknown): TurnId | null {
  const record = readRuntimePayloadRecord(value);
  if (!record) {
    return null;
  }
  return typeof record.activeTurnId === "string" ? TurnId.makeUnsafe(record.activeTurnId) : null;
}

function readRuntimePayloadLastError(value: unknown): string | null {
  const record = readRuntimePayloadRecord(value);
  if (!record) {
    return null;
  }
  return typeof record.lastError === "string" ? record.lastError : null;
}

function isLifecycleStateEvent(
  event: ProviderRuntimeEvent,
): event is Extract<
  ProviderRuntimeEvent,
  { type: "session.started" | "thread.started" | "session.state.changed" }
> {
  return (
    event.type === "session.started" ||
    event.type === "thread.started" ||
    event.type === "session.state.changed"
  );
}

function runtimeModeForThread(thread: OrchestrationReadModel["threads"][number]) {
  return thread.session?.runtimeMode ?? thread.runtimeMode ?? "full-access";
}

function persistedSessionBindingPruneReason(
  thread: OrchestrationReadModel["threads"][number] | undefined,
): "missing-thread" | "archived-thread" | "deleted-thread" | null {
  if (!thread) {
    return "missing-thread";
  }
  if (thread.deletedAt !== null) {
    return "deleted-thread";
  }
  if (thread.archivedAt !== null) {
    return "archived-thread";
  }
  return null;
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined): string | undefined {
  const trimmed = planMarkdown?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`;
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId);
  }
  if (event.itemId) {
    return `plan:${threadId}:item:${event.itemId}`;
  }
  return `plan:${threadId}:event:${event.eventId}`;
}

function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
): ThreadTokenUsageSnapshot | undefined {
  if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) {
    return undefined;
  }
  return event.payload.usage;
}

function normalizeRuntimeTurnState(
  value: string | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "ready":
      return "ready";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

function isSettledSessionStatus(
  status: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error",
): boolean {
  return (
    status === "ready" || status === "interrupted" || status === "stopped" || status === "error"
  );
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | undefined {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return undefined;
  }
}

function isMutationRequestKind(
  requestKind: "command" | "file-read" | "file-change" | undefined,
): boolean {
  return requestKind === "command" || requestKind === "file-change";
}

interface ToolExecutionContext {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly auditReference?: string;
  readonly toolUseId?: string;
}

function readToolExecutionContext(
  raw: ProviderRuntimeEvent["raw"] | undefined,
): ToolExecutionContext {
  const payload =
    raw && typeof raw.payload === "object" && raw.payload !== null && !Array.isArray(raw.payload)
      ? (raw.payload as Record<string, unknown>)
      : undefined;
  if (!payload) {
    return {};
  }

  const auditReference =
    typeof payload.auditReference === "string"
      ? payload.auditReference
      : typeof payload.auditRef === "string"
        ? payload.auditRef
        : typeof payload.audit_reference === "string"
          ? payload.audit_reference
          : typeof payload.auditId === "string"
            ? payload.auditId
            : undefined;

  return {
    ...(typeof payload.tenantId === "string" ? { tenantId: payload.tenantId } : {}),
    ...(typeof payload.userId === "string" ? { userId: payload.userId } : {}),
    ...(auditReference ? { auditReference } : {}),
    ...(typeof payload.toolUseId === "string" ? { toolUseId: payload.toolUseId } : {}),
  };
}

function withToolExecutionContext(
  payload: Record<string, unknown>,
  event: ProviderRuntimeEvent,
): Record<string, unknown> {
  return {
    ...payload,
    ...readToolExecutionContext(event.raw),
  };
}

function makeDerivedActivityId(eventId: EventId, suffix: string): EventId {
  return EventId.makeUnsafe(`${eventId}:${suffix}`);
}

function toolCallLifecycleKind(
  lifecycle: "started" | "updated" | "completed" | "progress" | "permission_denied",
  status?: string,
): string {
  switch (lifecycle) {
    case "started":
      return "tool_call_started";
    case "updated":
    case "progress":
      return "tool_call_progress";
    case "completed":
      return status === "failed" ? "tool_call_failed" : "tool_call_result";
    case "permission_denied":
      return "permission_denied";
  }
}

function uiCommandLifecycleSummary(
  status: "completed" | "failed" | "rejected" | "timed_out" | "requested",
  command: string,
): string {
  switch (status) {
    case "requested":
      return `UI command requested: ${command}`;
    case "completed":
      return `UI command completed: ${command}`;
    case "failed":
      return `UI command failed: ${command}`;
    case "rejected":
      return `UI command rejected: ${command}`;
    case "timed_out":
      return `UI command timed out: ${command}`;
  }
}

function renderBlockSummary(block: { readonly type: string; readonly title?: string }): string {
  switch (block.type) {
    case "table":
      return `Render block requested: ${block.title ?? "table"}`;
    case "native":
      return `Render block requested: ${block.title ?? "native"}`;
    case "status":
      return `Render block requested: ${block.title ?? "status"}`;
    default:
      return "Render block requested";
  }
}

function renderBlockTone(block: {
  readonly type: string;
  readonly level?: string;
}): "info" | "error" {
  if (block.type === "status" && block.level === "error") {
    return "error";
  }
  return "info";
}

function makeToolLifecycleActivities(input: {
  readonly event: Extract<
    ProviderRuntimeEvent,
    { type: "item.started" | "item.updated" | "item.completed" }
  >;
  readonly lifecycle: "started" | "updated" | "completed";
  readonly maybeSequence: { readonly sequence?: number };
}): ReadonlyArray<OrchestrationThreadActivity> {
  const { event, lifecycle, maybeSequence } = input;
  if (!isToolLifecycleItemType(event.payload.itemType)) {
    return [];
  }

  const payload = withToolExecutionContext(
    {
      itemType: event.payload.itemType,
      ...(event.payload.status ? { status: event.payload.status } : {}),
      ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
      ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
    },
    event,
  );

  const genericKind =
    lifecycle === "started"
      ? "tool.started"
      : lifecycle === "updated"
        ? "tool.updated"
        : "tool.completed";
  const genericSummary =
    lifecycle === "started"
      ? `${event.payload.title ?? "Tool"} started`
      : lifecycle === "updated"
        ? (event.payload.title ?? "Tool updated")
        : (event.payload.title ?? "Tool");
  const specificKind = toolCallLifecycleKind(lifecycle, event.payload.status);
  const specificSummary =
    lifecycle === "started"
      ? `${event.payload.title ?? "Tool"} started`
      : lifecycle === "updated"
        ? `${event.payload.title ?? "Tool"} progressing`
        : event.payload.status === "failed"
          ? `${event.payload.title ?? "Tool"} failed`
          : `${event.payload.title ?? "Tool"} result`;

  const genericActivity = {
    id: event.eventId,
    createdAt: event.createdAt,
    tone: "tool",
    kind: genericKind,
    summary: genericSummary,
    payload,
    turnId: toTurnId(event.turnId) ?? null,
    ...maybeSequence,
  } satisfies OrchestrationThreadActivity;
  const specificActivity = {
    id: makeDerivedActivityId(event.eventId, specificKind),
    createdAt: event.createdAt,
    tone: "tool",
    kind: specificKind,
    summary: specificSummary,
    payload,
    turnId: toTurnId(event.turnId) ?? null,
    ...maybeSequence,
  } satisfies OrchestrationThreadActivity;

  return [genericActivity, specificActivity];
}

function runtimeEventToActivities(
  event: ProviderRuntimeEvent,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = (() => {
    const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number };
    return eventWithSequence.sessionSequence !== undefined
      ? { sequence: eventWithSequence.sessionSequence }
      : {};
  })();
  const thinkingActivities = projectThinkingActivitiesFromRuntimeEvent(
    maybeSequence.sequence === undefined
      ? { event }
      : {
          event,
          sequence: maybeSequence.sequence,
        },
  );
  if (thinkingActivities.length > 0) {
    return thinkingActivities;
  }
  switch (event.type) {
    case "request.opened": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      const isMutationRequest = isMutationRequestKind(requestKind);
      const preview =
        isMutationRequest && typeof event.payload.detail === "string"
          ? truncateDetail(event.payload.detail)
          : undefined;
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.requested",
          summary: isMutationRequest
            ? "Mutation preview requested"
            : requestKind === "file-read"
              ? "File-read approval requested"
              : requestKind === "file-change"
                ? "Mutation preview requested"
                : "Approval requested",
          payload: withToolExecutionContext(
            {
              requestId: toApprovalRequestId(event.requestId),
              ...(requestKind ? { requestKind } : {}),
              requestType: event.payload.requestType,
              ...(event.requestId ? { operationId: event.requestId } : {}),
              ...(preview ? { preview } : {}),
              ...(isMutationRequest ? { confirmationRequired: true } : {}),
              ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            },
            event,
          ),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      const isMutationRequest = isMutationRequestKind(requestKind);
      const isAcceptedDecision =
        event.payload.decision === "accept" || event.payload.decision === "acceptForSession";
      const isRejectedDecision =
        event.payload.decision === "decline" || event.payload.decision === "cancel";
      const payload = {
        requestId: toApprovalRequestId(event.requestId),
        ...(requestKind ? { requestKind } : {}),
        requestType: event.payload.requestType,
        ...(event.requestId ? { operationId: event.requestId } : {}),
        ...(event.payload.decision ? { decision: event.payload.decision } : {}),
      };
      const approvalResolved = {
        id: event.eventId,
        createdAt: event.createdAt,
        tone: "approval",
        kind: "approval.resolved",
        summary: isMutationRequest
          ? isAcceptedDecision
            ? "Mutation confirmed"
            : isRejectedDecision
              ? "Mutation rejected"
              : "Mutation confirmation resolved"
          : "Approval resolved",
        payload: withToolExecutionContext(payload, event),
        turnId: toTurnId(event.turnId) ?? null,
        ...maybeSequence,
      } satisfies OrchestrationThreadActivity;
      const deniedActivity = isRejectedDecision
        ? ({
            id: makeDerivedActivityId(event.eventId, "permission_denied"),
            createdAt: event.createdAt,
            tone: "approval",
            kind: "permission_denied",
            summary: "Permission denied",
            payload: withToolExecutionContext(
              {
                ...payload,
                decision: event.payload.decision,
              },
              event,
            ),
            turnId: toTurnId(event.turnId) ?? null,
            ...maybeSequence,
          } satisfies OrchestrationThreadActivity)
        : null;
      return deniedActivity ? [approvalResolved, deniedActivity] : [approvalResolved];
    }

    case "tool.progress": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.progress",
          summary: event.payload.summary ?? event.payload.toolName ?? "Tool progressing",
          payload: withToolExecutionContext(
            {
              ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
              ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
              ...(event.payload.summary ? { summary: event.payload.summary } : {}),
              ...(event.payload.elapsedSeconds !== undefined
                ? { elapsedSeconds: event.payload.elapsedSeconds }
                : {}),
            },
            event,
          ),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
        {
          id: makeDerivedActivityId(event.eventId, "tool_call_progress"),
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool_call_progress",
          summary: event.payload.summary ?? event.payload.toolName ?? "Tool progressing",
          payload: withToolExecutionContext(
            {
              ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
              ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
              ...(event.payload.summary ? { summary: event.payload.summary } : {}),
              ...(event.payload.elapsedSeconds !== undefined
                ? { elapsedSeconds: event.payload.elapsedSeconds }
                : {}),
            },
            event,
          ),
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Runtime error",
          payload: {
            message: truncateDetail(event.payload.message),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          summary: "Runtime warning",
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.plan.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.resolved",
          summary: "User input submitted",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted",
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      return makeToolLifecycleActivities({
        event,
        lifecycle: "updated",
        maybeSequence,
      });
    }

    case "item.completed": {
      return makeToolLifecycleActivities({
        event,
        lifecycle: "completed",
        maybeSequence,
      });
    }

    case "item.started": {
      return makeToolLifecycleActivities({
        event,
        lifecycle: "started",
        maybeSequence,
      });
    }
  }

  const runtimeEventType = event.type as string;
  if (runtimeEventType === "ui.command.requested") {
    const uiCommandEvent = event as unknown as {
      readonly eventId: EventId;
      readonly createdAt: string;
      readonly turnId?: TurnId;
      readonly payload: {
        readonly command: {
          readonly name: string;
        };
        readonly args: Record<string, unknown>;
      };
    };
    const commandName = uiCommandEvent.payload.command.name;
    const commandArgs = uiCommandEvent.payload.args;
    const summary =
      commandName === "navigate.toRoute" && typeof commandArgs["routeName"] === "string"
        ? `Navigation intent requested: ${commandArgs["routeName"]}`
        : commandName === "component.mountResult" && typeof commandArgs["componentId"] === "string"
          ? `Result mount intent requested: ${commandArgs["componentId"]}`
          : uiCommandLifecycleSummary("requested", commandName);
    return [
      {
        id: uiCommandEvent.eventId,
        createdAt: uiCommandEvent.createdAt,
        tone: "tool",
        kind: "ui.command.requested",
        summary,
        payload: withToolExecutionContext({ ...(event.payload as Record<string, unknown>) }, event),
        turnId: toTurnId(uiCommandEvent.turnId) ?? null,
        ...maybeSequence,
      },
    ];
  }

  if (runtimeEventType === "ui.command.result") {
    const uiCommandEvent = event as unknown as {
      readonly eventId: EventId;
      readonly createdAt: string;
      readonly turnId?: TurnId;
      readonly payload: {
        readonly command: string;
        readonly status: "completed" | "failed" | "rejected" | "timed_out";
      };
    };
    const tone =
      uiCommandEvent.payload.status === "completed"
        ? "info"
        : uiCommandEvent.payload.status === "rejected"
          ? "approval"
          : "error";
    return [
      {
        id: uiCommandEvent.eventId,
        createdAt: uiCommandEvent.createdAt,
        tone,
        kind: "ui.command.result",
        summary: uiCommandLifecycleSummary(
          uiCommandEvent.payload.status,
          uiCommandEvent.payload.command,
        ),
        payload: withToolExecutionContext({ ...(event.payload as Record<string, unknown>) }, event),
        turnId: toTurnId(uiCommandEvent.turnId) ?? null,
        ...maybeSequence,
      },
    ];
  }

  if (runtimeEventType === "tool.summary") {
    const toolSummaryEvent = event as unknown as {
      readonly eventId: EventId;
      readonly createdAt: string;
      readonly turnId?: TurnId;
      readonly payload: {
        readonly summary: string;
        readonly precedingToolUseIds?: ReadonlyArray<string>;
      };
    };
    return [
      {
        id: toolSummaryEvent.eventId,
        createdAt: toolSummaryEvent.createdAt,
        tone: "info",
        kind: "tool.summary",
        summary: toolSummaryEvent.payload.summary,
        payload: withToolExecutionContext(
          {
            summary: toolSummaryEvent.payload.summary,
            ...(toolSummaryEvent.payload.precedingToolUseIds &&
            toolSummaryEvent.payload.precedingToolUseIds.length > 0
              ? { precedingToolUseIds: toolSummaryEvent.payload.precedingToolUseIds }
              : {}),
          },
          event,
        ),
        turnId: toTurnId(toolSummaryEvent.turnId) ?? null,
        ...maybeSequence,
      },
    ];
  }

  if (runtimeEventType === "agent.render_block") {
    const renderBlockEvent = event as unknown as {
      readonly eventId: EventId;
      readonly createdAt: string;
      readonly turnId?: TurnId;
      readonly payload: {
        readonly requestId: string;
        readonly block: {
          readonly type: string;
          readonly title?: string;
          readonly level?: string;
        };
      };
    };
    return [
      {
        id: renderBlockEvent.eventId,
        createdAt: renderBlockEvent.createdAt,
        tone: renderBlockTone(renderBlockEvent.payload.block),
        kind: "agent.render_block",
        summary: renderBlockSummary(renderBlockEvent.payload.block),
        payload: withToolExecutionContext({ ...(event.payload as Record<string, unknown>) }, event),
        turnId: toTurnId(renderBlockEvent.turnId) ?? null,
        ...maybeSequence,
      },
    ];
  }

  return [];
}

const make = Effect.fn("make")(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const providerSessionDirectory = yield* ProviderSessionDirectory;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverSettingsService = yield* ServerSettingsService;
  const projectHooksService = yield* ProjectHooksService;

  const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(new Set<MessageId>()),
  });

  const bufferedAssistantTextByMessageId = yield* Cache.make<MessageId, string>({
    capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
    lookup: () => Effect.succeed(""),
  });

  const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>({
    capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
    lookup: () => Effect.succeed({ text: "", createdAt: "" }),
  });

  const isGitRepoForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return false;
    }
    const workspaceCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });
    if (!workspaceCwd) {
      return false;
    }
    return isGitRepository(workspaceCwd);
  });

  const rememberAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.add(messageId);
              return nextIds;
            },
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            if (nextIds.size === 0) {
              return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
            }
            return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map((existingIds) =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
      ),
    );

  const clearAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap(
        Effect.fn("appendBufferedAssistantText")(function* (existingText) {
          const nextText = Option.match(existingText, {
            onNone: () => delta,
            onSome: (text) => `${text}${delta}`,
          });
          if (nextText.length <= MAX_BUFFERED_ASSISTANT_CHARS) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, nextText);
            return "";
          }

          // Safety valve: flush full buffered text as an assistant delta to cap memory.
          yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
          return nextText;
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existingText) =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.getOrElse(existingText, () => "")),
        ),
      ),
    );

  const clearBufferedAssistantText = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ""}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(bufferedProposedPlanById, planId);

  const clearAssistantMessageState = (messageId: MessageId) =>
    clearBufferedAssistantText(messageId);

  const finalizeAssistantMessage = Effect.fn("finalizeAssistantMessage")(function* (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    fallbackText?: string;
  }) {
    const bufferedText = yield* takeBufferedAssistantText(input.messageId);
    const text =
      bufferedText.length > 0
        ? bufferedText
        : (input.fallbackText?.trim().length ?? 0) > 0
          ? input.fallbackText!
          : "";

    if (text.length > 0) {
      yield* orchestrationEngine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: providerCommandId(input.event, input.finalDeltaCommandTag),
        threadId: input.threadId,
        messageId: input.messageId,
        delta: text,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      });
    }

    yield* orchestrationEngine.dispatch({
      type: "thread.message.assistant.complete",
      commandId: providerCommandId(input.event, input.commandTag),
      threadId: input.threadId,
      messageId: input.messageId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      createdAt: input.createdAt,
    });
    const readModel = yield* orchestrationEngine.getReadModel();
    const finalizedThread = readModel.threads.find((thread) => thread.id === input.threadId);
    const finalizedMessage = finalizedThread?.messages.find(
      (message) => message.id === input.messageId,
    );
    if (finalizedThread && finalizedMessage) {
      yield* notifyOrchestratorChatMessage({
        thread: finalizedThread,
        message: finalizedMessage,
      });
    }
    yield* clearAssistantMessageState(input.messageId);
  });

  const upsertProposedPlan = Effect.fn("upsertProposedPlan")(function* (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    planMarkdown: string | undefined;
    createdAt: string;
    updatedAt: string;
  }) {
    const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
    if (!planMarkdown) {
      return;
    }

    const existingPlan = input.threadProposedPlans.find((entry) => entry.id === input.planId);
    yield* orchestrationEngine.dispatch({
      type: "thread.proposed-plan.upsert",
      commandId: providerCommandId(input.event, "proposed-plan-upsert"),
      threadId: input.threadId,
      proposedPlan: {
        id: input.planId,
        turnId: input.turnId ?? null,
        planMarkdown,
        implementedAt: existingPlan?.implementedAt ?? null,
        implementationThreadId: existingPlan?.implementationThreadId ?? null,
        createdAt: existingPlan?.createdAt ?? input.createdAt,
        updatedAt: input.updatedAt,
      },
      createdAt: input.updatedAt,
    });
  });

  const finalizeBufferedProposedPlan = Effect.fn("finalizeBufferedProposedPlan")(function* (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    fallbackMarkdown?: string;
    updatedAt: string;
  }) {
    const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
    const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
    const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
    const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
    if (!planMarkdown) {
      return;
    }

    yield* upsertProposedPlan({
      event: input.event,
      threadId: input.threadId,
      threadProposedPlans: input.threadProposedPlans,
      planId: input.planId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      planMarkdown,
      createdAt:
        bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
          ? bufferedPlan.createdAt
          : input.updatedAt,
      updatedAt: input.updatedAt,
    });
    yield* clearBufferedProposedPlan(input.planId);
  });

  const clearTurnStateForSession = Effect.fn("clearTurnStateForSession")(function* (
    threadId: ThreadId,
  ) {
    const prefix = `${threadId}:`;
    const proposedPlanPrefix = `plan:${threadId}:`;
    const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
    const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
    yield* Effect.forEach(
      turnKeys,
      Effect.fn(function* (key) {
        if (!key.startsWith(prefix)) {
          return;
        }

        const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
        if (Option.isSome(messageIds)) {
          yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
            concurrency: 1,
          }).pipe(Effect.asVoid);
        }

        yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
      }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
    yield* Effect.forEach(
      proposedPlanKeys,
      (key) =>
        key.startsWith(proposedPlanPrefix)
          ? Cache.invalidate(bufferedProposedPlanById, key)
          : Effect.void,
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ) {
    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pendingTurnStart)) {
      return null;
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
    if (sourceThreadId === null || sourcePlanId === null) {
      return null;
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const;
  });

  const getExpectedProviderTurnIdForThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessions = yield* providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.activeTurnId;
  });

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fnUntraced(function* (
    threadId: ThreadId,
    eventTurnId: TurnId | undefined,
  ) {
    if (eventTurnId === undefined) {
      return null;
    }

    const expectedTurnId = yield* getExpectedProviderTurnIdForThread(threadId);
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null;
    }

    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fnUntraced(function* (
    sourceThreadId: ThreadId,
    sourcePlanId: OrchestrationProposedPlanId,
    implementationThreadId: ThreadId,
    implementedAt: string,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const sourceThread = readModel.threads.find((entry) => entry.id === sourceThreadId);
    const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
    if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
      return;
    }

    yield* orchestrationEngine.dispatch({
      type: "thread.proposed-plan.upsert",
      commandId: CommandId.makeUnsafe(
        `provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}`,
      ),
      threadId: sourceThread.id,
      proposedPlan: {
        ...sourcePlan,
        implementedAt,
        implementationThreadId,
        updatedAt: implementedAt,
      },
      createdAt: implementedAt,
    });
  });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === event.threadId);
    if (!thread) return;

    const now = event.createdAt;
    const eventTurnId = toTurnId(event.turnId);
    const bindingOption = yield* providerSessionDirectory.getBinding(thread.id);
    const runtimeBinding = Option.getOrUndefined(bindingOption);
    const runtimeBindingActiveTurnId = readRuntimePayloadTurnId(runtimeBinding?.runtimePayload);
    const activeTurnId = thread.session?.activeTurnId ?? runtimeBindingActiveTurnId ?? null;
    const lifecycleEventTurnId =
      event.type === "turn.completed" && eventTurnId === undefined
        ? (activeTurnId ?? undefined)
        : eventTurnId;
    const currentSessionUpdatedAt = thread.session?.updatedAt ?? null;
    const olderThanCurrentSession =
      currentSessionUpdatedAt !== null && currentSessionUpdatedAt.localeCompare(now) > 0;
    const settledSessionWouldRegress =
      olderThanCurrentSession &&
      thread.session !== null &&
      thread.session.activeTurnId === null &&
      isSettledSessionStatus(thread.session.status) &&
      (event.type === "session.started" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        (event.type === "session.state.changed" &&
          (event.payload.state === "starting" ||
            event.payload.state === "running" ||
            event.payload.state === "waiting")));

    const conflictsWithActiveTurn =
      activeTurnId !== null &&
      lifecycleEventTurnId !== undefined &&
      !sameId(activeTurnId, lifecycleEventTurnId);
    const missingTurnForActiveTurn = activeTurnId !== null && lifecycleEventTurnId === undefined;

    const shouldApplyThreadLifecycle = (() => {
      if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
        return true;
      }
      if (settledSessionWouldRegress) {
        return false;
      }
      switch (event.type) {
        case "session.exited":
          return true;
        case "session.started":
        case "thread.started":
          return true;
        case "turn.started":
          return !conflictsWithActiveTurn;
        case "turn.completed":
          if (conflictsWithActiveTurn || missingTurnForActiveTurn) {
            return false;
          }
          // Only the active turn may close the lifecycle state.
          if (activeTurnId !== null && lifecycleEventTurnId !== undefined) {
            return sameId(activeTurnId, lifecycleEventTurnId);
          }
          // If no active turn is tracked, accept completion scoped to this thread.
          return true;
        default:
          return true;
      }
    })();
    const acceptedTurnStartedSourcePlan =
      event.type === "turn.started" && shouldApplyThreadLifecycle
        ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId)
        : null;

    if (
      event.type === "session.started" ||
      event.type === "session.state.changed" ||
      event.type === "session.exited" ||
      event.type === "thread.started" ||
      event.type === "turn.started" ||
      event.type === "turn.completed"
    ) {
      const nextActiveTurnId =
        event.type === "turn.started"
          ? (eventTurnId ?? null)
          : event.type === "turn.completed" || event.type === "session.exited"
            ? null
            : isLifecycleStateEvent(event)
              ? (activeTurnId ?? runtimeBindingActiveTurnId ?? null)
              : activeTurnId;
      const status = (() => {
        switch (event.type) {
          case "session.state.changed":
            return orchestrationSessionStatusFromRuntimeState(event.payload.state);
          case "turn.started":
            return "running";
          case "session.exited":
            return "stopped";
          case "turn.completed":
            return normalizeRuntimeTurnState(event.payload.state) === "failed" ? "error" : "ready";
          case "session.started":
          case "thread.started":
            // Provider thread/session start notifications can arrive during an
            // active turn; preserve turn-running state in that case.
            return (activeTurnId ?? runtimeBindingActiveTurnId) !== null ? "running" : "ready";
        }
      })();
      const lastError =
        event.type === "session.state.changed" && event.payload.state === "error"
          ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
          : event.type === "turn.completed" &&
              normalizeRuntimeTurnState(event.payload.state) === "failed"
            ? (event.payload.errorMessage ?? thread.session?.lastError ?? "Turn failed")
            : status === "ready"
              ? null
              : (thread.session?.lastError ?? null);
      const runtimeStatus =
        event.type === "session.exited"
          ? "stopped"
          : status === "error"
            ? "error"
            : status === "ready"
              ? "ready"
              : "running";

      if (shouldApplyThreadLifecycle) {
        if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) {
          yield* markSourceProposedPlanImplemented(
            acceptedTurnStartedSourcePlan.sourceThreadId,
            acceptedTurnStartedSourcePlan.sourcePlanId,
            thread.id,
            now,
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("provider runtime ingestion failed to mark source proposed plan", {
                eventId: event.eventId,
                eventType: event.type,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId: providerCommandId(event, "thread-session-set"),
          threadId: thread.id,
          session: {
            threadId: thread.id,
            status,
            providerName: event.provider,
            runtimeMode: thread.session?.runtimeMode ?? "full-access",
            activeTurnId: nextActiveTurnId,
            lastError,
            updatedAt: now,
          },
          createdAt: now,
        });
        yield* providerSessionDirectory.upsert({
          threadId: thread.id,
          provider: event.provider,
          runtimeMode: runtimeModeForThread(thread),
          status: runtimeStatus,
          runtimePayload: {
            activeTurnId: nextActiveTurnId,
            lastError,
            lastRuntimeEvent: event.type,
            lastRuntimeEventAt: now,
          },
        });

        if (event.type === "turn.completed") {
          yield* projectHooksService.handleTurnCompleted(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("provider runtime ingestion failed to run project hooks", {
                eventId: event.eventId,
                threadId: event.threadId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        }
      }
    }

    const assistantDelta =
      event.type === "content.delta" && event.payload.streamKind === "assistant_text"
        ? event.payload.delta
        : undefined;
    const proposedPlanDelta =
      event.type === "turn.proposed.delta" ? event.payload.delta : undefined;

    if (assistantDelta && assistantDelta.length > 0) {
      const assistantMessageId = MessageId.makeUnsafe(
        `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
      );
      const turnId = lifecycleEventTurnId;
      if (turnId) {
        yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
      }

      const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
        serverSettingsService.getSettings,
        (settings) => (settings.enableAssistantStreaming ? "streaming" : "buffered"),
      );
      if (assistantDeliveryMode === "buffered") {
        const spillChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
        if (spillChunk.length > 0) {
          yield* orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: providerCommandId(event, "assistant-delta-buffer-spill"),
            threadId: thread.id,
            messageId: assistantMessageId,
            delta: spillChunk,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      } else {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: providerCommandId(event, "assistant-delta"),
          threadId: thread.id,
          messageId: assistantMessageId,
          delta: assistantDelta,
          ...(turnId ? { turnId } : {}),
          createdAt: now,
        });
      }
    }

    if (proposedPlanDelta && proposedPlanDelta.length > 0) {
      const planId = proposedPlanIdFromEvent(event, thread.id);
      yield* appendBufferedProposedPlan(planId, proposedPlanDelta, now);
    }

    const assistantCompletion =
      event.type === "item.completed" && event.payload.itemType === "assistant_message"
        ? {
            messageId: MessageId.makeUnsafe(
              `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
            ),
            fallbackText: event.payload.detail,
          }
        : undefined;
    const proposedPlanCompletion =
      event.type === "turn.proposed.completed"
        ? {
            planId: proposedPlanIdFromEvent(event, thread.id),
            turnId: toTurnId(event.turnId),
            planMarkdown: event.payload.planMarkdown,
          }
        : undefined;

    if (assistantCompletion) {
      const assistantMessageId = assistantCompletion.messageId;
      const turnId = toTurnId(event.turnId);
      const existingAssistantMessage = thread.messages.find(
        (entry) => entry.id === assistantMessageId,
      );
      const shouldApplyFallbackCompletionText =
        !existingAssistantMessage || existingAssistantMessage.text.length === 0;
      if (turnId) {
        yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
      }

      yield* finalizeAssistantMessage({
        event,
        threadId: thread.id,
        messageId: assistantMessageId,
        ...(turnId ? { turnId } : {}),
        createdAt: now,
        commandTag: "assistant-complete",
        finalDeltaCommandTag: "assistant-delta-finalize",
        ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
          ? { fallbackText: assistantCompletion.fallbackText }
          : {}),
      });

      if (turnId) {
        yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId);
      }
    }

    if (proposedPlanCompletion) {
      yield* finalizeBufferedProposedPlan({
        event,
        threadId: thread.id,
        threadProposedPlans: thread.proposedPlans,
        planId: proposedPlanCompletion.planId,
        ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
        fallbackMarkdown: proposedPlanCompletion.planMarkdown,
        updatedAt: now,
      });
    }

    if (event.type === "turn.completed") {
      const turnId = lifecycleEventTurnId;
      if (turnId) {
        const assistantMessageIds = yield* getAssistantMessageIdsForTurn(thread.id, turnId);
        yield* Effect.forEach(
          assistantMessageIds,
          (assistantMessageId) =>
            finalizeAssistantMessage({
              event,
              threadId: thread.id,
              messageId: assistantMessageId,
              turnId,
              createdAt: now,
              commandTag: "assistant-complete-finalize",
              finalDeltaCommandTag: "assistant-delta-finalize-fallback",
            }),
          { concurrency: 1 },
        ).pipe(Effect.asVoid);
        yield* clearAssistantMessageIdsForTurn(thread.id, turnId);

        yield* finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          threadProposedPlans: thread.proposedPlans,
          planId: proposedPlanIdForTurn(thread.id, turnId),
          turnId,
          updatedAt: now,
        });
      }
    }

    if (event.type === "session.exited") {
      yield* clearTurnStateForSession(thread.id);
    }

    if (event.type === "runtime.error") {
      const runtimeErrorMessage = event.payload.message;

      const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
        ? true
        : !settledSessionWouldRegress &&
          (activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId));

      if (shouldApplyRuntimeError) {
        yield* orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId: providerCommandId(event, "runtime-error-session-set"),
          threadId: thread.id,
          session: {
            threadId: thread.id,
            status: "error",
            providerName: event.provider,
            runtimeMode: thread.session?.runtimeMode ?? "full-access",
            activeTurnId: eventTurnId ?? null,
            lastError: runtimeErrorMessage,
            updatedAt: now,
          },
          createdAt: now,
        });
        yield* providerSessionDirectory.upsert({
          threadId: thread.id,
          provider: event.provider,
          runtimeMode: runtimeModeForThread(thread),
          status: "error",
          runtimePayload: {
            activeTurnId: eventTurnId ?? null,
            lastError: runtimeErrorMessage,
            lastRuntimeEvent: event.type,
            lastRuntimeEventAt: now,
          },
        });
      }
    }

    if (event.type === "thread.metadata.updated" && event.payload.name) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: providerCommandId(event, "thread-meta-update"),
        threadId: thread.id,
        title: event.payload.name,
      });
    }

    if (event.type === "turn.diff.updated") {
      const turnId = toTurnId(event.turnId);
      if (turnId && (yield* isGitRepoForThread(thread.id))) {
        // Skip if a checkpoint already exists for this turn. A real
        // (non-placeholder) capture from CheckpointReactor should not
        // be clobbered, and dispatching a duplicate placeholder for the
        // same turnId would produce an unstable checkpointTurnCount.
        if (thread.checkpoints.some((c) => c.turnId === turnId)) {
          // Already tracked; no-op.
        } else {
          const assistantMessageId = MessageId.makeUnsafe(
            `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
          );
          const maxTurnCount = thread.checkpoints.reduce(
            (max, c) => Math.max(max, c.checkpointTurnCount),
            0,
          );
          yield* orchestrationEngine.dispatch({
            type: "thread.turn.checkpoint.record",
            commandId: providerCommandId(event, "thread-turn-checkpoint-record"),
            threadId: thread.id,
            turnId,
            completedAt: now,
            checkpointRef: CheckpointRef.makeUnsafe(`provider-diff:${event.eventId}`),
            status: "missing",
            files: [],
            assistantMessageId,
            checkpointTurnCount: maxTurnCount + 1,
            createdAt: now,
          });
        }
      }
    }

    const activities = runtimeEventToActivities(event);
    yield* Effect.forEach(activities, (activity) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: providerCommandId(event, "thread-activity-append"),
        threadId: thread.id,
        activity,
        createdAt: activity.createdAt,
      }),
    ).pipe(Effect.asVoid);
  });

  const processDomainEvent = (_event: TurnStartRequestedDomainEvent) => Effect.void;

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const reconcilePersistedSessionsOnStart = Effect.gen(function* () {
    const readModel = yield* orchestrationEngine.getReadModel();
    const threadIds = yield* providerSessionDirectory.listThreadIds();

    yield* Effect.forEach(
      threadIds,
      (threadId) =>
        Effect.gen(function* () {
          const bindingOption = yield* providerSessionDirectory.getBinding(threadId);
          if (Option.isNone(bindingOption)) {
            return;
          }

          const binding = bindingOption.value;
          if (
            binding.status !== "ready" &&
            binding.status !== "stopped" &&
            binding.status !== "error"
          ) {
            return;
          }

          const thread = readModel.threads.find((entry) => entry.id === threadId);
          const pruneReason = persistedSessionBindingPruneReason(thread);
          if (pruneReason) {
            yield* providerSessionDirectory.remove(threadId);
            return;
          }

          if (!thread) {
            return;
          }

          const currentSession = thread.session;
          const nextActiveTurnId =
            binding.status === "ready" || binding.status === "stopped"
              ? null
              : readRuntimePayloadTurnId(binding.runtimePayload);
          const nextStatus =
            binding.status === "ready"
              ? "ready"
              : binding.status === "stopped"
                ? "stopped"
                : "error";
          const nextLastError = readRuntimePayloadLastError(binding.runtimePayload);

          const alreadyMatches =
            currentSession?.status === nextStatus &&
            sameId(currentSession.activeTurnId, nextActiveTurnId) &&
            (currentSession.lastError ?? null) === nextLastError;
          if (alreadyMatches) {
            return;
          }

          const createdAt = new Date().toISOString();
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.makeUnsafe(
              `provider:startup-reconcile:${threadId}:${crypto.randomUUID()}`,
            ),
            threadId,
            session: {
              threadId,
              status: nextStatus,
              providerName: binding.provider,
              runtimeMode: binding.runtimeMode ?? currentSession?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              lastError: nextLastError,
              updatedAt: createdAt,
            },
            createdAt,
          });
        }),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("provider runtime ingestion failed to reconcile persisted sessions", {
        cause: Cause.pretty(cause),
      }),
    ),
  );

  const start: ProviderRuntimeIngestionShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) =>
        worker.enqueue({ source: "runtime", event }),
      ),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.turn-start-requested") {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );
    yield* reconcilePersistedSessionsOnStart;
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make(),
).pipe(
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(
    ProviderSessionDirectoryLive.pipe(Layer.provideMerge(ProviderSessionRuntimeRepositoryLive)),
  ),
);
