import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { checkOllamaProvider } from "./OllamaProvider.ts";

const baseSettings = {
  enabled: true,
  protocol: "https" as const,
  host: "ollama.internal",
  port: 8443,
  apiPath: "/v1",
  responsesApiPath: "/responses",
  codexBinaryPath: "codex",
  codexHomePath: "~/.codex-ollama",
  codexProfileName: "t3-ollama-gpu",
  defaultModel: "qwen3:8b",
  customModels: [],
};

it.effect("reports ready when the endpoint is reachable and the default model is available", () =>
  Effect.gen(function* () {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ model: "qwen3:8b" }, { model: "qwen2.5-coder:14b" }],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    const snapshot = yield* checkOllamaProvider(baseSettings, {
      fetch: fetchImpl,
      checkedAt: "2026-06-07T00:00:00.000Z",
    });

    assert.equal(snapshot.provider, "ollamaLocal");
    assert.equal(snapshot.status, "ready");
    assert.equal(snapshot.installed, true);
    assert.equal(snapshot.message, "Connected to https://ollama.internal:8443/v1 with qwen3:8b.");
    assert.equal(
      snapshot.models.some(
        (model) => model.slug === "qwen3:8b" && model.agentSupport?.status === "verified",
      ),
      true,
    );
    assert.equal(
      snapshot.models.some(
        (model) =>
          model.slug === "qwen2.5-coder:14b" && model.agentSupport?.status === "unsupported",
      ),
      true,
    );
  }),
);

it.effect("reports warning when the endpoint is reachable but the default model is missing", () =>
  Effect.gen(function* () {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ model: "qwen2.5-coder:14b" }],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    const snapshot = yield* checkOllamaProvider(baseSettings, {
      fetch: fetchImpl,
      checkedAt: "2026-06-07T00:00:00.000Z",
    });

    assert.equal(snapshot.status, "warning");
    assert.equal(
      snapshot.message,
      "Connected to https://ollama.internal:8443/v1, but default model qwen3:8b is not available.",
    );
  }),
);

it.effect(
  "reports warning when the default model is reachable but not verified for agent turns",
  () =>
    Effect.gen(function* () {
      const fetchImpl = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              models: [{ model: "qwen2.5-coder:14b" }, { model: "qwen3:8b" }],
            }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;

      const snapshot = yield* checkOllamaProvider(
        {
          ...baseSettings,
          defaultModel: "qwen2.5-coder:14b",
        },
        {
          fetch: fetchImpl,
          checkedAt: "2026-06-07T00:00:00.000Z",
        },
      );

      assert.equal(snapshot.status, "warning");
      assert.equal(
        snapshot.message,
        "Connected to https://ollama.internal:8443/v1, but default model qwen2.5-coder:14b is not ready for Codex tool-enabled sessions. Failed live Codex tool-call verification on 2026-06-07. Use qwen3:8b instead.",
      );
    }),
);

it.effect("reports error when the endpoint probe fails", () =>
  Effect.gen(function* () {
    const fetchImpl = (() =>
      Promise.reject(new Error("connect ECONNREFUSED"))) as unknown as typeof fetch;

    const snapshot = yield* checkOllamaProvider(baseSettings, {
      fetch: fetchImpl,
      checkedAt: "2026-06-07T00:00:00.000Z",
    });

    assert.equal(snapshot.status, "error");
    assert.equal(snapshot.installed, false);
    assert.equal(
      snapshot.message,
      "Unable to reach https://ollama.internal:8443/v1: connect ECONNREFUSED",
    );
  }),
);

it.effect("reports disabled when the provider is turned off and skips reachability checks", () =>
  Effect.gen(function* () {
    const fetchImpl = (() => {
      throw new Error("fetch should not run for disabled providers");
    }) as unknown as typeof fetch;

    const snapshot = yield* checkOllamaProvider(
      {
        ...baseSettings,
        enabled: false,
      },
      {
        fetch: fetchImpl,
        checkedAt: "2026-06-07T00:00:00.000Z",
      },
    );

    assert.equal(snapshot.status, "disabled");
    assert.equal(snapshot.installed, false);
    assert.equal(
      snapshot.message,
      "Disabled. Reachability to https://ollama.internal:8443/v1 was not checked.",
    );
  }),
);
