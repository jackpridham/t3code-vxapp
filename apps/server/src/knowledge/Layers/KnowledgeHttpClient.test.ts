import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, expect, vi } from "vitest";
import { KnowledgeHttpClientLive } from "./KnowledgeHttpClient";
import { KnowledgeClient } from "../Services/KnowledgeClient";
import { KnowledgeConfig } from "../config";

const makeLayer = (knowledgeOverrides?: {
  enabled?: boolean;
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}) =>
  KnowledgeHttpClientLive.pipe(
    Layer.provide(
      KnowledgeConfig.layerTest({
        enabled: true,
        baseUrl: "http://127.0.0.1:8787",
        authToken: "secret-token",
        timeoutMs: 15000,
        ...knowledgeOverrides,
      }),
    ),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KnowledgeHttpClient", () => {
  it.effect("sends authenticated knowledge query requests", () =>
    Effect.gen(function* () {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            answer: "Found it",
            rebuilt: false,
            sources: [
              {
                source: "/repo/README.md",
                score: 0.9,
                content: "docs entry points",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

      const knowledgeClient = yield* KnowledgeClient;
      const result = yield* knowledgeClient.query({
        query: "Where are the technical docs entry points documented?",
        topK: 3,
        rebuild: false,
      });

      assert.strictEqual(result.answer, "Found it");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      assert.strictEqual(url, "http://127.0.0.1:8787/query");
      assert.strictEqual(new Headers(init?.headers).get("Authorization"), "Bearer secret-token");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("fails when knowledge integration is disabled", () =>
    Effect.gen(function* () {
      const fetchMock = vi.spyOn(globalThis, "fetch");
      const knowledgeClient = yield* KnowledgeClient;
      const result = yield* Effect.exit(knowledgeClient.doctor);

      assert.strictEqual(result._tag, "Failure");
      expect(fetchMock).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        makeLayer({
          enabled: false,
        }),
      ),
    ),
  );
});
