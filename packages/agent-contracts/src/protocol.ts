import { Schema, Struct } from "effect";

import {
  CommandId,
  ConversationId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  RequestId,
  RuntimeSessionId,
  TenantId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";

export const AI_AGENT_PROTOCOL_VERSION = 1;

export const WS_METHODS = {
  connect: "agent.connect",
  sendMessage: "assistant.message",
  getCapabilities: "agent.getCapabilities",
  commandResult: "ui.command.result",
  confirmationDecision: "confirmation.decision",
  contextSnapshot: "client.context.snapshot",
} as const;

export const WS_METHOD_LIST = [
  WS_METHODS.connect,
  WS_METHODS.sendMessage,
  WS_METHODS.getCapabilities,
  WS_METHODS.commandResult,
  WS_METHODS.confirmationDecision,
  WS_METHODS.contextSnapshot,
] as const;
export type WsMethod = (typeof WS_METHOD_LIST)[number];

export const WS_CHANNELS = {
  sessionWelcome: "session.welcome",
  assistantDelta: "assistant.delta",
  assistantMessage: "assistant.message",
  uiCommandRequested: "ui.command.requested",
  uiCommandResult: "ui.command.result",
  toolCallStarted: "tool.call.started",
  toolCallResult: "tool.call.result",
  renderBlock: "render.block",
  confirmationRequired: "confirmation.required",
  confirmationDecision: "confirmation.decision",
  mutationPreview: "mutation.preview",
  sessionStatus: "session.status",
  sessionError: "session.error",
} as const;

export const WS_CHANNEL_LIST = [
  WS_CHANNELS.sessionWelcome,
  WS_CHANNELS.assistantDelta,
  WS_CHANNELS.assistantMessage,
  WS_CHANNELS.uiCommandRequested,
  WS_CHANNELS.uiCommandResult,
  WS_CHANNELS.toolCallStarted,
  WS_CHANNELS.toolCallResult,
  WS_CHANNELS.renderBlock,
  WS_CHANNELS.confirmationRequired,
  WS_CHANNELS.confirmationDecision,
  WS_CHANNELS.mutationPreview,
  WS_CHANNELS.sessionStatus,
  WS_CHANNELS.sessionError,
] as const;
export type WsChannel = (typeof WS_CHANNEL_LIST)[number];

const tagPayload = <const Tag extends string, const Fields extends Schema.Struct.Fields>(
  tag: Tag,
  schema: Schema.Struct<Fields>,
) =>
  schema.mapFields(
    Struct.assign({
      _tag: Schema.tag(tag),
    }),
    { unsafePreserveChecks: true },
  );

export const AgentProtocolMeta = Schema.Struct({
  protocolVersion: Schema.Literal(AI_AGENT_PROTOCOL_VERSION),
  sessionId: RuntimeSessionId,
  conversationId: ConversationId,
  turnId: TurnId,
  eventId: EventId,
  sequence: NonNegativeInt,
  timestamp: IsoDateTime,
  correlationId: Schema.optional(TrimmedNonEmptyString),
  idempotencyKey: Schema.optional(TrimmedNonEmptyString),
});
export type AgentProtocolMeta = typeof AgentProtocolMeta.Type;

// -- Client-side request shapes -----------------------------------------------

export const ClientConnectRequest = tagPayload(
  WS_METHODS.connect,
  Schema.Struct({
    tenantId: TenantId,
    authToken: TrimmedNonEmptyString,
    capabilities: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  }),
);

export const ClientCapabilitiesRequest = tagPayload(
  WS_METHODS.getCapabilities,
  Schema.Struct({
    includeOptional: Schema.optional(Schema.Boolean),
  }),
);

export const ClientMessageRequest = tagPayload(
  WS_METHODS.sendMessage,
  Schema.Struct({
    message: TrimmedNonEmptyString,
    attachments: Schema.optional(Schema.Array(Schema.Unknown)),
  }),
);

export const ClientCommandResultRequest = tagPayload(
  WS_METHODS.commandResult,
  Schema.Struct({
    commandId: CommandId,
    status: Schema.Union([Schema.Literal("accepted"), Schema.Literal("rejected")]),
    payload: Schema.optional(Schema.Unknown),
  }),
);

export const ClientConfirmationDecisionRequest = tagPayload(
  WS_METHODS.confirmationDecision,
  Schema.Struct({
    operationId: TrimmedNonEmptyString,
    approved: Schema.Boolean,
    explanation: Schema.optional(TrimmedNonEmptyString),
  }),
);

export const ClientContextSnapshotRequest = tagPayload(
  WS_METHODS.contextSnapshot,
  Schema.Struct({
    routeName: TrimmedNonEmptyString,
    routeParams: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    query: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);

export const AgentClientRequestBody = Schema.Union([
  ClientConnectRequest,
  ClientCapabilitiesRequest,
  ClientMessageRequest,
  ClientCommandResultRequest,
  ClientConfirmationDecisionRequest,
  ClientContextSnapshotRequest,
]);
export type AgentClientRequestBody = typeof AgentClientRequestBody.Type;

export const AgentClientMessage = Schema.Struct({
  id: RequestId,
  metadata: AgentProtocolMeta,
  payload: AgentClientRequestBody,
});
export type AgentClientMessage = typeof AgentClientMessage.Type;

// -- Command/result/render/tool schema primitives --------------------------------

export const UiCommandRequestPayload = Schema.Struct({
  commandId: CommandId,
  commandType: TrimmedNonEmptyString,
  args: Schema.Unknown,
});

export const UiCommandResultPayload = Schema.Struct({
  commandId: CommandId,
  commandType: TrimmedNonEmptyString,
  status: Schema.Union([Schema.Literal("ok"), Schema.Literal("failed"), Schema.Literal("skipped")]),
  result: Schema.optional(Schema.Unknown),
});

export const ToolCallStartedPayload = Schema.Struct({
  commandId: CommandId,
  tool: TrimmedNonEmptyString,
  correlationId: Schema.optional(TrimmedNonEmptyString),
  details: Schema.optional(Schema.Unknown),
});

export const ToolCallResultPayload = Schema.Struct({
  commandId: CommandId,
  tool: TrimmedNonEmptyString,
  status: Schema.Union([Schema.Literal("ok"), Schema.Literal("error")]),
  result: Schema.Unknown,
});

export const ConfirmationRequiredPayload = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  preview: Schema.optional(Schema.Unknown),
});

export const ConfirmationDecisionPayload = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  approved: Schema.Boolean,
  explanation: Schema.optional(TrimmedNonEmptyString),
});

export const MutationPreviewPayload = Schema.Struct({
  operationId: TrimmedNonEmptyString,
  changes: Schema.Record(Schema.String, Schema.Unknown),
});

export const AssistantDeltaPayload = Schema.Struct({
  delta: TrimmedNonEmptyString,
});

export const AssistantMessagePayload = Schema.Struct({
  message: TrimmedNonEmptyString,
  status: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("complete"),
    Schema.Literal("failed"),
  ]),
});

export const SessionStatusPayload = Schema.Struct({
  state: Schema.Union([
    Schema.Literal("starting"),
    Schema.Literal("running"),
    Schema.Literal("error"),
    Schema.Literal("closed"),
  ]),
  message: Schema.optional(TrimmedNonEmptyString),
});

export const SessionErrorPayload = Schema.Struct({
  code: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  details: Schema.optional(Schema.Unknown),
});

export const RenderMessageBlock = Schema.Struct({
  kind: Schema.Literal("message"),
  markdown: TrimmedNonEmptyString,
});

export const RenderTableBlock = Schema.Struct({
  kind: Schema.Literal("table"),
  schema: Schema.Record(Schema.String, Schema.Unknown),
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  actions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        action: TrimmedNonEmptyString,
        label: TrimmedNonEmptyString,
      }),
    ),
  ),
});

export const RenderFormBlock = Schema.Struct({
  kind: Schema.Literal("form"),
  formId: TrimmedNonEmptyString,
  draft: Schema.Record(Schema.String, Schema.Unknown),
});

export const RenderComponentBlock = Schema.Struct({
  kind: Schema.Literal("component"),
  componentId: TrimmedNonEmptyString,
  props: Schema.Record(Schema.String, Schema.Unknown),
});

export const RenderProgressBlock = Schema.Struct({
  kind: Schema.Literal("progress"),
  state: Schema.Union([
    Schema.Literal("running"),
    Schema.Literal("complete"),
    Schema.Literal("failed"),
  ]),
  label: TrimmedNonEmptyString,
  percent: Schema.optional(NonNegativeInt),
});

export const RenderChartBlock = Schema.Struct({
  kind: Schema.Literal("chart"),
  chartType: TrimmedNonEmptyString,
  schema: Schema.Record(Schema.String, Schema.Unknown),
  data: Schema.Record(Schema.String, Schema.Unknown),
  deferred: Schema.optional(Schema.Boolean),
});

export const RenderBlockPayload = Schema.Union([
  RenderMessageBlock,
  RenderTableBlock,
  RenderFormBlock,
  RenderComponentBlock,
  RenderProgressBlock,
  RenderChartBlock,
]);
export type RenderBlockPayload = typeof RenderBlockPayload.Type;

// -- Server-side push envelope -----------------------------------------------

export const SessionWelcomePayload = Schema.Struct({
  message: Schema.optional(TrimmedNonEmptyString),
  capabilities: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  resumeSupported: Schema.optional(Schema.Boolean),
});

export const AgentServerPushBody = Schema.Union([
  AssistantDeltaPayload,
  AssistantMessagePayload,
  UiCommandRequestPayload,
  UiCommandResultPayload,
  ToolCallStartedPayload,
  ToolCallResultPayload,
  RenderBlockPayload,
  ConfirmationRequiredPayload,
  ConfirmationDecisionPayload,
  MutationPreviewPayload,
  SessionWelcomePayload,
  SessionStatusPayload,
  SessionErrorPayload,
]);
export type AgentServerPushBody = typeof AgentServerPushBody.Type;

export const ServerPushMessage = <
  const Channel extends WsChannel,
  Payload extends Schema.Schema<any>,
>(
  channel: Channel,
  payload: Payload,
) =>
  Schema.Struct({
    metadata: AgentProtocolMeta,
    channel: Schema.Literal(channel),
    data: payload,
  });

export const AgentServerPush = Schema.Union([
  ServerPushMessage(WS_CHANNELS.sessionWelcome, SessionWelcomePayload),
  ServerPushMessage(WS_CHANNELS.assistantDelta, AssistantDeltaPayload),
  ServerPushMessage(WS_CHANNELS.assistantMessage, AssistantMessagePayload),
  ServerPushMessage(WS_CHANNELS.uiCommandRequested, UiCommandRequestPayload),
  ServerPushMessage(WS_CHANNELS.uiCommandResult, UiCommandResultPayload),
  ServerPushMessage(WS_CHANNELS.toolCallStarted, ToolCallStartedPayload),
  ServerPushMessage(WS_CHANNELS.toolCallResult, ToolCallResultPayload),
  ServerPushMessage(WS_CHANNELS.renderBlock, RenderBlockPayload),
  ServerPushMessage(WS_CHANNELS.confirmationRequired, ConfirmationRequiredPayload),
  ServerPushMessage(WS_CHANNELS.confirmationDecision, ConfirmationDecisionPayload),
  ServerPushMessage(WS_CHANNELS.mutationPreview, MutationPreviewPayload),
  ServerPushMessage(WS_CHANNELS.sessionStatus, SessionStatusPayload),
  ServerPushMessage(WS_CHANNELS.sessionError, SessionErrorPayload),
]);
export type AgentServerPush = typeof AgentServerPush.Type;

export const AgentServerError = Schema.Struct({
  code: Schema.Union([
    Schema.Literal("bad_request"),
    Schema.Literal("authentication_failed"),
    Schema.Literal("permission_denied"),
    Schema.Literal("rate_limited"),
    Schema.Literal("internal_error"),
    Schema.Literal("unreachable_dep"),
  ]),
  message: TrimmedNonEmptyString,
  details: Schema.optional(Schema.Unknown),
});

export const AgentServerResponseSuccess = Schema.Struct({
  id: RequestId,
  metadata: AgentProtocolMeta,
  result: Schema.Unknown,
  error: Schema.optional(Schema.Never),
});

export const AgentServerResponseError = Schema.Struct({
  id: RequestId,
  metadata: AgentProtocolMeta,
  result: Schema.optional(Schema.Never),
  error: AgentServerError,
});

export const AgentServerResponse = Schema.Union([
  AgentServerResponseSuccess,
  AgentServerResponseError,
]);
export type AgentServerResponse = typeof AgentServerResponse.Type;
