/**
 * ProviderAdapterRegistryLive - In-memory provider adapter lookup layer.
 *
 * Binds provider kinds (codex/claudeAgent/...) to concrete adapter services.
 * This layer only performs adapter lookup; it does not route session-scoped
 * calls or own provider lifecycle workflows.
 *
 * @module ProviderAdapterRegistryLive
 */
import { DEFAULT_PROVIDER_KIND } from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import {
  ProviderUnsupportedError,
  ProviderValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";

export interface ProviderAdapterRegistryLiveOptions {
  readonly adapters?: ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>>;
}

const makeProviderAdapterRegistry = (options?: ProviderAdapterRegistryLiveOptions) =>
  Effect.gen(function* () {
    const adapters =
      options?.adapters !== undefined
        ? options.adapters
        : [yield* CodexAdapter, yield* ClaudeAdapter];
    const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));

    const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
      const adapter = byProvider.get(provider);
      if (!adapter) {
        return Effect.fail(new ProviderUnsupportedError({ provider }));
      }
      return Effect.succeed(adapter);
    };

    const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
      Effect.sync(() => Array.from(byProvider.keys()));

    const resolveStartProvider: ProviderAdapterRegistryShape["resolveStartProvider"] = (input) => {
      const modelProvider = input.modelSelection?.provider;
      if (
        input.provider !== undefined &&
        modelProvider !== undefined &&
        input.provider !== modelProvider
      ) {
        return Effect.fail(
          new ProviderValidationError({
            operation: input.operation,
            issue: `Provider '${input.provider}' does not match modelSelection provider '${modelProvider}'.`,
          }),
        );
      }

      const provider = input.provider ?? modelProvider ?? DEFAULT_PROVIDER_KIND;
      return getByProvider(provider).pipe(Effect.as(provider));
    };

    return {
      getByProvider,
      listProviders,
      resolveStartProvider,
    } satisfies ProviderAdapterRegistryShape;
  });

export const ProviderAdapterRegistryLive = Layer.effect(
  ProviderAdapterRegistry,
  makeProviderAdapterRegistry(),
);
