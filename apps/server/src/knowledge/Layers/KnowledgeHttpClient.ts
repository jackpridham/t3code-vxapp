import {
  KnowledgeDoctorResult,
  type KnowledgeQueryInput as KnowledgeQueryInputType,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  KnowledgeReadinessResult,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import { KnowledgeConfig } from "../config";
import { KnowledgeClient } from "../Services/KnowledgeClient";
import { KnowledgeClientError } from "../Errors";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

const decodeSchema = <A>(schema: Schema.Schema<A>) => Schema.decodeUnknownSync(schema);

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const errorValue = (payload as { error?: unknown }).error;
    if (typeof errorValue === "string" && errorValue.trim()) {
      return errorValue;
    }
  }
  return fallback;
}

export const KnowledgeHttpClientLive = Layer.effect(
  KnowledgeClient,
  Effect.gen(function* () {
    const knowledgeConfig = yield* KnowledgeConfig;

    const requestJson = <A>(
      path: string,
      init: RequestInit,
      schema: Schema.Schema<A>,
    ): Effect.Effect<A, KnowledgeClientError> =>
      Effect.gen(function* () {
        if (!knowledgeConfig.enabled) {
          return yield* new KnowledgeClientError({
            message: "Knowledge integration is disabled in server configuration.",
          });
        }

        const headers = new Headers(init.headers ?? {});
        headers.set("Accept", "application/json");
        if (knowledgeConfig.authToken) {
          headers.set("Authorization", `Bearer ${knowledgeConfig.authToken}`);
        }

        const url = `${normalizeBaseUrl(knowledgeConfig.baseUrl)}${path}`;
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              ...init,
              headers,
              signal: AbortSignal.timeout(knowledgeConfig.timeoutMs),
            }),
          catch: (cause) =>
            new KnowledgeClientError({
              message: `Failed to reach knowledge service at ${url}.`,
              cause,
            }),
        });

        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) =>
            new KnowledgeClientError({
              message: `Failed to read knowledge service response from ${url}.`,
              cause,
            }),
        });

        const payload = yield* Effect.try({
          try: () => (text ? JSON.parse(text) : null),
          catch: (cause) =>
            new KnowledgeClientError({
              message: `Knowledge service returned invalid JSON for ${path}.`,
              cause,
            }),
        });
        if (!response.ok) {
          return yield* new KnowledgeClientError({
            message: extractErrorMessage(payload, `Knowledge service request failed with ${response.status}.`),
            statusCode: response.status,
          });
        }

        return yield* Effect.try({
          try: () => decodeSchema(schema)(payload),
          catch: (cause) =>
            new KnowledgeClientError({
              message: `Knowledge service returned an invalid payload for ${path}.`,
              cause,
            }),
        });
      });

    return {
      doctor: requestJson("/doctor", { method: "GET" }, KnowledgeDoctorResult),
      readiness: requestJson("/health/ready", { method: "GET" }, KnowledgeReadinessResult),
      query: (input: KnowledgeQueryInputType) =>
        requestJson(
          "/query",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: input.query,
              top_k: input.topK,
              rebuild: input.rebuild,
            }),
          },
          KnowledgeQueryResult,
        ),
    };
  }),
);
