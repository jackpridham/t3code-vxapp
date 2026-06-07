/**
 * OllamaAdapter - Local Ollama implementation of the generic provider adapter contract.
 *
 * This adapter is intentionally minimal for the MVP: text-only chat turns,
 * hardcoded model/runtime endpoint, and adapter-local in-memory history.
 *
 * @module OllamaAdapter
 */
import { ServiceMap } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OllamaAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "ollamaLocal";
}

export class OllamaAdapter extends ServiceMap.Service<OllamaAdapter, OllamaAdapterShape>()(
  "t3/provider/Services/OllamaAdapter",
) {}
