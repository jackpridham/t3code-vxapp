/**
 * OllamaAdapterLive - Codex-harness-backed Ollama provider adapter.
 *
 * Reuses the Codex app-server runtime with a managed Ollama profile so local
 * Ollama models can participate in the same tool-enabled coding workflow as
 * the primary Codex provider while keeping a separate provider identity.
 *
 * @module OllamaAdapterLive
 */
import { Effect, Layer } from "effect";

import { type CodexAdapterLiveOptions, makeManagedCodexAdapter } from "./CodexAdapter.ts";
import { OllamaAdapter, type OllamaAdapterShape } from "../Services/OllamaAdapter.ts";

export interface OllamaAdapterLiveOptions extends CodexAdapterLiveOptions {}

export const makeOllamaAdapter = (options?: OllamaAdapterLiveOptions) =>
  makeManagedCodexAdapter("ollamaLocal", options).pipe(
    Effect.map((adapter) => adapter as OllamaAdapterShape),
  );

export const OllamaAdapterLive = Layer.effect(OllamaAdapter, makeOllamaAdapter());

export function makeOllamaAdapterLive(options?: OllamaAdapterLiveOptions) {
  return Layer.effect(OllamaAdapter, makeOllamaAdapter(options));
}
