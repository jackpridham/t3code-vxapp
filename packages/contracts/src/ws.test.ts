import assertNode from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ORCHESTRATION_WS_CHANNELS, ORCHESTRATION_WS_METHODS } from "./orchestration";
import { WebSocketRequest, WsResponse, WS_CHANNELS, WS_METHODS } from "./ws";

const decodeWebSocketRequest = Schema.decodeUnknownEffect(WebSocketRequest as never) as (
  input: unknown,
) => Effect.Effect<Schema.Schema.Type<typeof WebSocketRequest>, Schema.SchemaError, never>;
const decodeWsResponse = Schema.decodeUnknownEffect(WsResponse as never) as (
  input: unknown,
) => Effect.Effect<Schema.Schema.Type<typeof WsResponse>, Schema.SchemaError, never>;

function assertNoForbiddenSchemaLiterals(filePath: string, schemaNames: readonly string[]) {
  const source = fs.readFileSync(filePath, "utf8");

  for (const schemaName of schemaNames) {
    const escaped = schemaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const literalPattern = new RegExp(
      `(?:export\\s+)?const\\s+${escaped}\\s*=\\s*Schema\\.Literal[s]?\\(`,
      "m",
    );
    assertNode.ok(
      !literalPattern.test(source),
      `forbidden Schema literal declaration for ${schemaName} found in ${filePath}`,
    );
    const typeLiteralUnionPattern = new RegExp(
      `(?:export\\s+)?type\\s+${escaped}\\s*=\\s*(?!typeof\\b)[^;]*["'][^"']+["'][^;]*;`,
      "m",
    );
    assertNode.ok(
      !typeLiteralUnionPattern.test(source),
      `forbidden TypeScript literal-union declaration for ${schemaName} found in ${filePath}`,
    );
    const schemaCastPattern = new RegExp(
      `(?:export\\s+)?const\\s+${escaped}\\s*=\\s*.+as\\s+Schema\\.Schema<${escaped}>`,
      "m",
    );
    assertNode.ok(
      !schemaCastPattern.test(source),
      `forbidden schema cast declaration for ${schemaName} found in ${filePath}`,
    );
  }
}

it.effect("accepts getTurnDiff requests when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
      },
    });
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
  }),
);

it.effect(
  "accepts getFileDiff requests when path is present and fromTurnCount <= toTurnCount",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeWebSocketRequest({
        id: "req-file-diff-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getFileDiff,
          threadId: "thread-1",
          path: "src/index.ts",
          fromTurnCount: 0,
          toTurnCount: 2,
        },
      });
      assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getFileDiff);
    }),
);

it.effect("accepts bounded orchestration read requests", () =>
  Effect.gen(function* () {
    const bootstrapSummaryRequest = yield* decodeWebSocketRequest({
      id: "req-bootstrap-summary-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getBootstrapSummary,
      },
    });
    assert.strictEqual(
      bootstrapSummaryRequest.body._tag,
      ORCHESTRATION_WS_METHODS.getBootstrapSummary,
    );

    const parsed = yield* decodeWebSocketRequest({
      id: "req-readiness-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getProjectByWorkspace,
        workspaceRoot: "/tmp/workspace",
      },
    });

    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getProjectByWorkspace);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getProjectByWorkspace) {
      assert.strictEqual(parsed.body.workspaceRoot, "/tmp/workspace");
    }
  }),
);

it.effect("accepts owner-backed Programs/TODOs websocket requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-programs-todos-1",
      body: {
        _tag: WS_METHODS.serverGetAgentsVxappProgramsTodosSnapshot,
        page: 2,
        limit: 20,
      },
    });

    assert.strictEqual(parsed.body._tag, WS_METHODS.serverGetAgentsVxappProgramsTodosSnapshot);
    if (parsed.body._tag === WS_METHODS.serverGetAgentsVxappProgramsTodosSnapshot) {
      assert.strictEqual(parsed.body.page, 2);
      assert.strictEqual(parsed.body.limit, 20);
    }
  }),
);

it.effect("rejects getTurnDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWebSocketRequest({
        id: "req-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
          threadId: "thread-1",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects getFileDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWebSocketRequest({
        id: "req-file-diff-invalid-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getFileDiff,
          threadId: "thread-1",
          path: "src/index.ts",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims websocket request id and nested orchestration ids", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: " req-1 ",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: " thread-1 ",
        fromTurnCount: 0,
        toTurnCount: 0,
      },
    });
    assert.strictEqual(parsed.id, "req-1");
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
      assert.strictEqual(parsed.body.threadId, "thread-1");
    }
  }),
);

it.effect("accepts git.preparePullRequestThread requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-pr-1",
      body: {
        _tag: WS_METHODS.gitPreparePullRequestThread,
        cwd: "/repo",
        reference: "#42",
        mode: "worktree",
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.gitPreparePullRequestThread);
  }),
);

it.effect("accepts transport-only owner mutation request strings on websocket routes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWebSocketRequest({
      id: "req-owner-mutation-1",
      body: {
        _tag: WS_METHODS.serverSetAgentsVxappProgramLifecycle,
        programId: "program-1",
        action: "owner-action/custom",
        nextStatus: "owner-status/custom",
        reason: "Owner-defined lifecycle transition",
      },
    });

    assert.strictEqual(parsed.body._tag, WS_METHODS.serverSetAgentsVxappProgramLifecycle);
    if (parsed.body._tag === WS_METHODS.serverSetAgentsVxappProgramLifecycle) {
      assert.strictEqual(parsed.body.action, "owner-action/custom");
      assert.strictEqual(parsed.body.nextStatus, "owner-status/custom");
    }
  }),
);

it.effect("accepts typed websocket push envelopes with sequence", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.type, "push");
    assert.strictEqual(parsed.sequence, 1);
    assert.strictEqual(parsed.channel, WS_CHANNELS.serverWelcome);
  }),
);

it.effect("accepts git.actionProgress push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.gitActionProgress,
      data: {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.gitActionProgress);
  }),
);

it.effect("accepts server.providersUpdated push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWsResponse({
      type: "push",
      sequence: 4,
      channel: WS_CHANNELS.serverProvidersUpdated,
      data: {
        providers: [],
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.serverProvidersUpdated);
  }),
);

it.effect("rejects push envelopes when channel payload does not match the channel schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWsResponse({
        type: "push",
        sequence: 2,
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: {
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it("does not define forbidden agentic Schema literal values in server.ts", () => {
  assertNoForbiddenSchemaLiterals(path.resolve(import.meta.dirname, "server.ts"), [
    "ServerSetAgentsVxappProgramLifecycleInput",
  ]);
});
