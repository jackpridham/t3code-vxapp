import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { AgentsVxappMutationRequest, AgentsVxappOwnerResultEnvelope } from "./agentsVxappAuthority";

const decodeEffect = <TSchema extends Schema.Schema<any>>(schema: TSchema) =>
  Schema.decodeUnknownEffect(schema as never) as (
    input: unknown,
  ) => Effect.Effect<Schema.Schema.Type<TSchema>, Schema.SchemaError, never>;

const decodeMutationRequest = decodeEffect(AgentsVxappMutationRequest);
const decodeOwnerResultEnvelope = decodeEffect(AgentsVxappOwnerResultEnvelope);
const authoritySourcePath = path.resolve(import.meta.dirname, "agentsVxappAuthority.ts");

it.effect("rejects owner result envelopes when required fields are missing", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeOwnerResultEnvelope({
        ok: true,
        contract_version: "v1",
        command: "owner-command",
        meta: {},
        result: {
          contractFamily: "agents-vxapp-t3code-authority",
          contractVersion: "v1",
          authorityStore: "sqlite",
          authoritySource: "snapshot",
          legacyFallbackUsed: false,
          surface: "programs",
          payload: {},
          display: {},
          options: {},
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts arbitrary owner transport strings and opaque payload records", () =>
  Effect.gen(function* () {
    const request = yield* decodeMutationRequest({
      command: "owner-command-2026-05",
      surface: "surface/any-string",
      payload: {
        nested: { accepted: true },
        count: 2,
      },
    });

    const envelope = yield* decodeOwnerResultEnvelope({
      ok: false,
      contract_family: "agents-vxapp-t3code-authority",
      contract_version: "v1",
      command: "owner-command-2026-05",
      meta: {
        request_id: "req-1",
      },
      error: {
        code: "owner-hard-fail/custom",
        message: "owner rejected the request",
        details: {
          authoritySurface: "surface/any-string",
          authorityStore: "owner-store/custom",
          authoritySource: "owner-source/custom",
          ownerCommand: "owner-command-2026-05",
          legacyFallbackUsed: false,
        },
      },
    });

    const success = yield* decodeOwnerResultEnvelope({
      ok: true,
      contract_family: "agents-vxapp-t3code-authority",
      contract_version: "v1",
      command: "owner-command-2026-05",
      meta: {},
      result: {
        contractFamily: "agents-vxapp-t3code-authority",
        contractVersion: "v1",
        authorityStore: "owner-store/custom",
        authoritySource: "owner-source/custom",
        legacyFallbackUsed: false,
        surface: "surface/any-string",
        payload: {
          status: "owner-defined-status",
          kind: "owner-defined-kind",
        },
        display: {
          label: "Owner Display",
          tone: "danger-amber",
          heading: "Owner Heading",
          summary: "Owner supplied summary",
          sortKey: "002",
          metadata: {
            badge: "custom",
          },
        },
        options: {
          arbitrary: true,
        },
      },
    });

    assert.strictEqual(request.command, "owner-command-2026-05");
    assert.strictEqual(request.surface, "surface/any-string");
    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.error.code, "owner-hard-fail/custom");
    assert.strictEqual(success.ok, true);
    assert.strictEqual(success.result.display.tone, "danger-amber");
    assert.deepStrictEqual(success.result.payload, {
      status: "owner-defined-status",
      kind: "owner-defined-kind",
    });
  }),
);

it.effect("requires legacyFallbackUsed and enforces it as a boolean", () =>
  Effect.gen(function* () {
    const missing = yield* Effect.exit(
      decodeOwnerResultEnvelope({
        ok: true,
        contract_family: "agents-vxapp-t3code-authority",
        contract_version: "v1",
        command: "owner-command",
        meta: {},
        result: {
          contractFamily: "agents-vxapp-t3code-authority",
          contractVersion: "v1",
          authorityStore: "sqlite",
          authoritySource: "snapshot",
          surface: "programs",
          payload: {},
          display: {},
          options: {},
        },
      }),
    );

    const wrongType = yield* Effect.exit(
      decodeOwnerResultEnvelope({
        ok: true,
        contract_family: "agents-vxapp-t3code-authority",
        contract_version: "v1",
        command: "owner-command",
        meta: {},
        result: {
          contractFamily: "agents-vxapp-t3code-authority",
          contractVersion: "v1",
          authorityStore: "sqlite",
          authoritySource: "snapshot",
          legacyFallbackUsed: "false",
          surface: "programs",
          payload: {},
          display: {},
          options: {},
        },
      }),
    );

    assert.strictEqual(missing._tag, "Failure");
    assert.strictEqual(wrongType._tag, "Failure");
  }),
);

it("keeps the neutralized authority surface transport-only", () => {
  const source = fs.readFileSync(authoritySourcePath, "utf8");

  assert.match(source, /export const AgentsVxappOwnerCommand = TrimmedNonEmptyString;/);
  assert.match(
    source,
    /export const AgentsVxappMutationRequest = Schema\.Struct\(\{\s*command: AgentsVxappOwnerCommand,\s*surface: Schema\.optional\(Schema\.NullOr\(TrimmedNonEmptyString\)\),/m,
  );
  assert.doesNotMatch(source, /Schema\.Literal[s]?\([^)]*t3code-/);
  assert.doesNotMatch(source, /\bexport\s+enum\s+AgentsVxappOwnerCommand\b/);
  assert.doesNotMatch(
    source,
    /\btype\s+AgentsVxappOwnerCommand\s*=\s*(?!typeof\b)[^;]*["'][^"']+["'][^;]*;/m,
  );
});
