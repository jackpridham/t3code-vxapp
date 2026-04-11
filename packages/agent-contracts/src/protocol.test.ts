import { assert, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { Schema } from "effect";

import {
  AgentClientMessage,
  AgentProtocolMeta,
  AgentServerResponse,
  AgentServerPush,
  ConfirmationRequiredPayload,
  RenderTableBlock,
  RenderBlockPayload,
  WS_CHANNELS,
  WS_METHODS,
  WS_METHOD_LIST,
} from "./protocol";

const decodeClientMessage = Schema.decodeUnknownSync(AgentClientMessage);
const decodeTableBlock = Schema.decodeUnknownSync(RenderTableBlock);
const decodeRenderBlock = Schema.decodeUnknownSync(RenderBlockPayload);
const decodeServerPush = Schema.decodeUnknownSync(AgentServerPush);
const decodeConfirmationRequired = Schema.decodeUnknownSync(ConfirmationRequiredPayload);
const decodeConfirmationRequiredPush = Schema.decodeUnknownSync(
  Schema.Struct({
    metadata: AgentProtocolMeta,
    channel: Schema.Literal(WS_CHANNELS.confirmationRequired),
    data: ConfirmationRequiredPayload,
  }),
);
const decodeServerResponse = Schema.decodeUnknownSync(AgentServerResponse);
const decodeMeta = Schema.decodeUnknownSync(AgentProtocolMeta);

const baseMetadata = {
  protocolVersion: 1,
  sessionId: "session-1",
  conversationId: "conversation-1",
  turnId: "turn-1",
  eventId: "event-1",
  sequence: 1,
  timestamp: "2026-04-12T00:00:00.000Z",
};

const baseMetadataTemplate = { ...baseMetadata };

const clientMessageExample = JSON.parse(
  readFileSync(
    new URL("../artifacts/examples/client-message.example.json", import.meta.url),
    "utf8",
  ),
);
const renderTableExample = JSON.parse(
  readFileSync(
    new URL("../artifacts/examples/render-block-table.example.json", import.meta.url),
    "utf8",
  ),
);

it("decodes all approved client WS methods", () => {
  const metadata = baseMetadataTemplate;
  const methodPayloads: Record<string, object> = {
    [WS_METHODS.connect]: { tenantId: "tenant-1", authToken: "auth-token" },
    [WS_METHODS.sendMessage]: { message: "Show me recurring quotes this month" },
    [WS_METHODS.getCapabilities]: { includeOptional: true },
    [WS_METHODS.commandResult]: { commandId: "command-1", status: "accepted" },
    [WS_METHODS.confirmationDecision]: {
      operationId: "op-1",
      approved: true,
    },
    [WS_METHODS.contextSnapshot]: { routeName: "dashboard.quotes" },
  };

  for (const method of WS_METHOD_LIST) {
    const parsed = decodeClientMessage({
      id: `req-${method}`,
      metadata,
      payload: { _tag: method, ...methodPayloads[method] },
    });

    assert.strictEqual(parsed.payload._tag, method);
  }
});

it("rejects unknown client request _tag values", () => {
  assert.throws(() => {
    decodeClientMessage({
      id: "req-unknown",
      metadata: baseMetadataTemplate,
      payload: {
        _tag: "agent.invalid",
        message: "Unknown method",
      },
    } as never);
  });
});

it("decodes all approved push channels", () => {
  const renderBlockPushPayload = renderTableExample.data;
  const pushPayloads: Record<string, object> = {
    [WS_CHANNELS.sessionWelcome]: {},
    [WS_CHANNELS.assistantDelta]: { delta: "typing" },
    [WS_CHANNELS.assistantMessage]: { message: "done", status: "complete" },
    [WS_CHANNELS.uiCommandRequested]: {
      commandId: "command-1",
      commandType: "navigate",
      args: { route: "/quotes" },
    },
    [WS_CHANNELS.uiCommandResult]: {
      commandId: "command-1",
      commandType: "navigate",
      status: "ok",
      result: { route: "/quotes" },
    },
    [WS_CHANNELS.toolCallStarted]: {
      commandId: "tool-1",
      tool: "quote.list",
      correlationId: "corr-1",
    },
    [WS_CHANNELS.toolCallResult]: {
      commandId: "tool-1",
      tool: "quote.list",
      status: "ok",
      result: { quotes: [] },
    },
    [WS_CHANNELS.renderBlock]: renderBlockPushPayload,
    [WS_CHANNELS.confirmationRequired]: {
      operationId: "op-1",
      message: "Approve recurring quotes export?",
    },
    [WS_CHANNELS.confirmationDecision]: {
      operationId: "op-1",
      approved: true,
    },
    [WS_CHANNELS.mutationPreview]: {
      operationId: "op-1",
      changes: { count: 4 },
    },
    [WS_CHANNELS.sessionStatus]: {
      state: "running",
    },
    [WS_CHANNELS.sessionError]: {
      code: "bad_request",
      message: "Invalid request body",
    },
  };

  for (const [channel, payload] of Object.entries(pushPayloads)) {
    const parsed = decodeServerPush({
      metadata: {
        ...baseMetadataTemplate,
        eventId: `evt-${channel}`,
        sequence: 2,
      },
      channel,
      data: payload,
    });

    assert.strictEqual(parsed.channel, channel);
  }
});

it("rejects mismatched channel and payload data", () => {
  assert.throws(() => {
    decodeServerPush({
      metadata: { ...baseMetadataTemplate, eventId: "evt-bad-mix-1", sequence: 3 },
      channel: WS_CHANNELS.renderBlock,
      data: {
        message: "not a render block",
      },
    });
  });

  assert.throws(() => {
    decodeServerPush({
      metadata: { ...baseMetadataTemplate, eventId: "evt-bad-mix-2", sequence: 4 },
      channel: WS_CHANNELS.assistantMessage,
      data: {
        schema: { columns: ["id", "name"] },
        rows: [{ id: "x-1" }],
      },
    } as never);
  });
});

it("decodes all RenderBlockPayload variants", () => {
  const message = decodeRenderBlock({ kind: "message", markdown: "Hello" });
  assert.strictEqual(message.kind, "message");

  const table = decodeRenderBlock({
    kind: "table",
    schema: { columns: ["id"] },
    rows: [{ id: "row-1" }],
    actions: [{ action: "open", label: "Open" }],
  });
  assert.strictEqual(table.kind, "table");
  assert.deepStrictEqual((table as { schema: Record<string, unknown> }).schema, {
    columns: ["id"],
  });

  const form = decodeRenderBlock({ kind: "form", formId: "f1", draft: { amount: 42 } });
  assert.strictEqual(form.kind, "form");

  const component = decodeRenderBlock({ kind: "component", componentId: "cmp-1", props: { a: 1 } });
  assert.strictEqual(component.kind, "component");

  const progress = decodeRenderBlock({ kind: "progress", state: "running", label: "Loading" });
  assert.strictEqual(progress.kind, "progress");

  const chart = decodeRenderBlock({
    kind: "chart",
    chartType: "bars",
    schema: { columns: ["period", "value"] },
    data: { points: [{ period: "Q1", value: 2 }] },
  });
  assert.strictEqual(chart.kind, "chart");
  assert.deepStrictEqual((chart as { deferred?: boolean }).deferred, undefined);
});

it("accepts optional metadata additions and optional render payload fields", () => {
  const withCorrelation = decodeClientMessage({
    id: "req-metadata-opt",
    metadata: {
      ...baseMetadataTemplate,
      correlationId: "corr-id-1",
      idempotencyKey: "idempotent-1",
      eventId: "event-meta-1",
      sequence: 5,
    },
    payload: { _tag: WS_METHODS.sendMessage, message: "Hello" },
  });
  assert.strictEqual(withCorrelation.payload._tag, WS_METHODS.sendMessage);

  const tableWithActions = decodeRenderBlock({
    kind: "table",
    schema: { columns: ["id"] },
    rows: [{ id: "q-1" }],
    actions: [{ action: "open", label: "Open" }],
  });
  assert.strictEqual((tableWithActions as { actions?: Array<unknown> }).actions?.length, 1);

  const chartWithDeferred = decodeRenderBlock({
    kind: "chart",
    chartType: "line",
    schema: { x: "month", y: "count" },
    data: { series: [1, 2] },
    deferred: true,
  });
  assert.strictEqual((chartWithDeferred as { deferred?: boolean }).deferred, true);
});

it("rejects malformed protocol metadata", () => {
  const { eventId: _eventIdOmitted, ...metadataWithoutEventId } = baseMetadata;

  assert.throws(() => {
    decodeMeta({
      ...baseMetadata,
      protocolVersion: undefined,
    } as never);
  });
  assert.throws(() => {
    decodeMeta({
      ...baseMetadata,
      protocolVersion: 2,
    });
  });
  assert.throws(() => {
    decodeMeta({
      ...baseMetadata,
      eventId: undefined,
    } as never);
  });
  assert.throws(() => {
    decodeMeta({
      ...baseMetadata,
      sessionId: "",
    } as never);
  });

  assert.throws(() => {
    decodeClientMessage({
      id: "req-bad-meta",
      metadata: { ...baseMetadata, protocolVersion: 2 },
      payload: { _tag: WS_METHODS.sendMessage, message: "x" },
    } as never);
  });
  assert.throws(() => {
    decodeClientMessage({
      id: "req-bad-meta2",
      metadata: {
        ...baseMetadata,
        eventId: "",
      },
      payload: { _tag: WS_METHODS.sendMessage, message: "x" },
    } as never);
  });
  assert.throws(() => {
    decodeClientMessage({
      id: "req-bad-meta3",
      metadata: { ...baseMetadata, sequence: -1 },
      payload: { _tag: WS_METHODS.sendMessage, message: "x" },
    } as never);
  });
  assert.throws(() => {
    decodeClientMessage({
      id: "",
      metadata: baseMetadata,
      payload: { _tag: WS_METHODS.sendMessage, message: "x" },
    } as never);
  });

  assert.throws(() => {
    decodeClientMessage({
      id: "req-bad-meta4",
      metadata: metadataWithoutEventId as never,
      payload: { _tag: WS_METHODS.sendMessage, message: "x" },
    } as never);
  });
});

it("decodes fixture JSON examples", () => {
  const decodedClientMessage = decodeClientMessage(clientMessageExample);
  assert.strictEqual(decodedClientMessage.id, "req-1");

  const decodedPush = decodeServerPush(renderTableExample);
  assert.strictEqual(decodedPush.channel, WS_CHANNELS.renderBlock);
  assert.strictEqual((decodedPush.data as { kind: string }).kind, "table");
});

it("rejects server responses with invalid error code literals", () => {
  assert.throws(() => {
    decodeServerResponse({
      id: "response-5",
      metadata: {
        protocolVersion: 1,
        sessionId: "session-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
        eventId: "event-7",
        sequence: 7,
        timestamp: "2026-04-12T00:00:06.000Z",
      },
      error: {
        code: "fatal_error" as never,
        message: "Unexpected",
      },
    });
  });
});

it("preserves permissive result payload type on success responses", () => {
  const response = decodeServerResponse({
    id: "response-8",
    metadata: {
      protocolVersion: 1,
      sessionId: "session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventId: "event-8",
      sequence: 8,
      timestamp: "2026-04-12T00:00:07.000Z",
    },
    result: {
      nested: { quotes: [{ id: "q-1", value: 99 }] },
      runtimeMeta: { request: { page: 1 }, items: [] },
    },
  });

  assert.deepStrictEqual(response.result, {
    nested: { quotes: [{ id: "q-1", value: 99 }] },
    runtimeMeta: { request: { page: 1 }, items: [] },
  });
});

it("accepts client assistant message request with protocol metadata", () => {
  const parsed = decodeClientMessage({
    id: "req-1",
    metadata: {
      protocolVersion: 1,
      sessionId: "session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventId: "event-1",
      sequence: 1,
      timestamp: "2026-04-12T00:00:00.000Z",
    },
    payload: {
      _tag: WS_METHODS.sendMessage,
      message: "Show me recurring quotes this month",
    },
  });

  assert.strictEqual(parsed.payload._tag, WS_METHODS.sendMessage);
  assert.strictEqual(parsed.metadata.protocolVersion, 1);
});

it("accepts table render push blocks", () => {
  const push = decodeTableBlock({
    kind: "table",
    schema: {
      columns: ["id", "total"],
    },
    rows: [{ id: "q-1", total: 100 }],
  });

  assert.strictEqual(push.kind, "table");
  assert.deepStrictEqual(push.schema, { columns: ["id", "total"] });
});

it("accepts confirmation-required event payload and push envelope", () => {
  const requested = decodeConfirmationRequired({
    operationId: "op-1",
    message: "Approve create 3 invoices?",
    preview: {
      invoices: 3,
    },
  });

  const requestedChannel = decodeConfirmationRequiredPush({
    metadata: {
      protocolVersion: 1,
      sessionId: "session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventId: "event-2",
      sequence: 2,
      timestamp: "2026-04-12T00:00:01.000Z",
    },
    channel: WS_CHANNELS.confirmationRequired,
    data: requested,
  });

  assert.strictEqual(requestedChannel.channel, WS_CHANNELS.confirmationRequired);
  assert.strictEqual(requestedChannel.data.operationId, "op-1");
});

it("accepts server response with success payload", () => {
  const response = decodeServerResponse({
    id: "response-1",
    metadata: {
      protocolVersion: 1,
      sessionId: "session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventId: "event-3",
      sequence: 3,
      timestamp: "2026-04-12T00:00:02.000Z",
    },
    result: {
      status: "ok",
    },
  });

  assert.strictEqual(response.id, "response-1");
  assert.strictEqual((response as { result: { status: string } }).result.status, "ok");
});

it("accepts server response with error payload", () => {
  const response = decodeServerResponse({
    id: "response-2",
    metadata: {
      protocolVersion: 1,
      sessionId: "session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      eventId: "event-4",
      sequence: 4,
      timestamp: "2026-04-12T00:00:03.000Z",
    },
    error: {
      code: "bad_request",
      message: "Invalid request body",
    },
  });

  assert.strictEqual(response.id, "response-2");
  assert.strictEqual((response as { error: { code: string } }).error.code, "bad_request");
});

it("rejects server responses containing both result and error", () => {
  let threw = false;
  try {
    decodeServerResponse({
      id: "response-4",
      metadata: {
        protocolVersion: 1,
        sessionId: "session-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
        eventId: "event-6",
        sequence: 6,
        timestamp: "2026-04-12T00:00:05.000Z",
      },
      result: {
        status: "ok",
      },
      error: {
        code: "bad_request",
        message: "Malformed request",
      },
    });
  } catch {
    threw = true;
  }

  assert.isTrue(threw);
});

it("rejects server responses with neither result nor error", () => {
  let threw = false;
  try {
    decodeServerResponse({
      id: "response-3",
      metadata: {
        protocolVersion: 1,
        sessionId: "session-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
        eventId: "event-5",
        sequence: 5,
        timestamp: "2026-04-12T00:00:04.000Z",
      },
    });
  } catch {
    threw = true;
  }

  assert.isTrue(threw);
});
