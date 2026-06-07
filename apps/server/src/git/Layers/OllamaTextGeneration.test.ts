import assert from "node:assert/strict";
import { it, vi } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { TextGeneration } from "../Services/TextGeneration.ts";
import { makeOllamaTextGenerationLive } from "./OllamaTextGeneration.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const layer = (fetchImpl: typeof fetch) =>
  makeOllamaTextGenerationLive({ fetch: fetchImpl }).pipe(
    Layer.provide(
      ServerSettingsService.layerTest({
        providers: {
          ollamaLocal: {
            protocol: "http",
            host: "ollama.test",
            port: 11434,
            apiPath: "/api",
            defaultModel: "qwen3:8b",
          },
        },
      }),
    ),
  );

it.effect("OllamaTextGeneration posts non-streaming structured chat requests", () =>
  Effect.gen(function* () {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: "qwen3:14b",
            message: {
              role: "assistant",
              content: JSON.stringify({
                title: "Fix composer model picker",
              }),
            },
            done: true,
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const generated = yield* Effect.gen(function* () {
      const textGeneration = yield* TextGeneration;
      return yield* textGeneration.generateThreadTitle({
        cwd: "/tmp/project",
        message: "Need to fix the composer model picker",
        modelSelection: {
          provider: "ollamaLocal",
          model: "qwen3:14b",
        },
      });
    }).pipe(Effect.provide(layer(fetchImpl)));

    assert.equal(generated.title, "Fix composer model picker");
    assert.equal(requests.length, 1);
    const request = requests[0];
    if (!request) {
      throw new Error("Expected an Ollama request to be recorded.");
    }
    assert.equal(request.url, "http://ollama.test:11434/api/chat");
    assert.equal((request.body as { stream: boolean }).stream, false);
    assert.equal((request.body as { model: string }).model, "qwen3:14b");
  }),
);
