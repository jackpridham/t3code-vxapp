import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { listOllamaModels, OllamaApiError, requestOllamaChat } from "./ollamaApi.ts";

it.effect("normalizes a trailing /api/ base URL for Ollama tags and chat requests", () =>
  Effect.gen(function* () {
    const urls: string[] = [];
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      if (init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: { role: "assistant", content: "pong" },
              done: true,
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ model: "qwen3:8b" }],
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const models = yield* listOllamaModels({
      fetch: fetchImpl,
      baseUrl: "http://192.168.10.12:11434/api/",
    });
    const response = yield* requestOllamaChat({
      fetch: fetchImpl,
      baseUrl: "http://192.168.10.12:11434/api/",
      body: {
        model: "qwen3:8b",
        stream: false,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      },
    });

    assert.deepEqual(models, ["qwen3:8b"]);
    assert.equal(response.message?.content, "pong");
    assert.deepEqual(urls, [
      "http://192.168.10.12:11434/api/tags",
      "http://192.168.10.12:11434/api/chat",
    ]);
  }),
);

it.effect("aborts a stalled Ollama tags probe when timeoutMs is reached", () =>
  Effect.gen(function* () {
    const fetchImpl = ((_: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      })) as unknown as typeof fetch;

    const error = yield* Effect.flip(
      listOllamaModels({
        fetch: fetchImpl,
        baseUrl: "http://192.168.10.12:11434/api",
        timeoutMs: 10,
      }),
    );

    assert(error instanceof OllamaApiError);
    assert.equal(error.message, "Timed out after 10ms while waiting for the Ollama endpoint.");
  }),
);
