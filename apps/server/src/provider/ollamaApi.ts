import { Effect } from "effect";

export interface OllamaChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

interface OllamaListTagsResponse {
  readonly models?: ReadonlyArray<{
    readonly model?: string;
    readonly name?: string;
  }>;
}

export interface OllamaChatResponse {
  readonly model?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string;
    readonly thinking?: string;
  };
  readonly done?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface RequestOllamaChatOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly body: {
    readonly model: string;
    readonly messages: ReadonlyArray<OllamaChatMessage>;
    readonly stream: boolean;
    readonly format?: unknown;
  };
}

export class OllamaApiError extends Error {
  override readonly name = "OllamaApiError";

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function formatTimeoutMessage(timeoutMs: number): string {
  return `Timed out after ${timeoutMs}ms while waiting for the Ollama endpoint.`;
}

function runOllamaFetch(input: {
  readonly fetch?: typeof fetch;
  readonly url: string;
  readonly init?: RequestInit;
  readonly timeoutMs?: number;
  readonly failureMessage: string;
}): Effect.Effect<Response, OllamaApiError> {
  const runFetch = input.fetch ?? fetch;
  return Effect.tryPromise({
    try: async () => {
      const timeoutMs = input.timeoutMs;
      if (timeoutMs === undefined || timeoutMs <= 0) {
        return await runFetch(input.url, input.init);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(formatTimeoutMessage(timeoutMs)), timeoutMs);
      try {
        return await runFetch(input.url, {
          ...input.init,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (cause) => {
      if (input.timeoutMs !== undefined && cause === formatTimeoutMessage(input.timeoutMs)) {
        return new OllamaApiError(formatTimeoutMessage(input.timeoutMs));
      }
      if (
        input.timeoutMs !== undefined &&
        cause instanceof DOMException &&
        cause.name === "AbortError"
      ) {
        return new OllamaApiError(formatTimeoutMessage(input.timeoutMs), cause);
      }
      if (cause instanceof Error && cause.message.trim().length > 0) {
        return new OllamaApiError(cause.message, cause);
      }
      return new OllamaApiError(input.failureMessage, cause);
    },
  });
}

function readJsonResponse<T>(response: Response): Effect.Effect<T, OllamaApiError> {
  return Effect.tryPromise({
    try: async () => {
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new OllamaApiError(
          detail.trim().length > 0
            ? `Ollama HTTP ${response.status}: ${detail.trim()}`
            : `Ollama HTTP ${response.status}`,
        );
      }
      return (await response.json()) as T;
    },
    catch: (cause) =>
      cause instanceof OllamaApiError
        ? cause
        : new OllamaApiError("Failed to decode Ollama response.", cause),
  });
}

export function listOllamaModels(input: {
  readonly fetch?: typeof fetch;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): Effect.Effect<ReadonlyArray<string>, OllamaApiError> {
  const baseUrl = normalizeOllamaBaseUrl(input.baseUrl);
  return runOllamaFetch({
    url: `${baseUrl}/tags`,
    failureMessage: "Failed to reach Ollama tags endpoint.",
    ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  }).pipe(
    Effect.flatMap((response) => readJsonResponse<OllamaListTagsResponse>(response)),
    Effect.map((payload) =>
      (payload.models ?? [])
        .map((entry) => entry.model ?? entry.name ?? null)
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
    ),
  );
}

export function requestOllamaChat(
  input: RequestOllamaChatOptions,
): Effect.Effect<OllamaChatResponse, OllamaApiError> {
  const baseUrl = normalizeOllamaBaseUrl(input.baseUrl);
  return runOllamaFetch({
    url: `${baseUrl}/chat`,
    failureMessage: "Failed to reach Ollama chat endpoint.",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body),
    },
    ...(input.fetch !== undefined ? { fetch: input.fetch } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  }).pipe(Effect.flatMap((response) => readJsonResponse<OllamaChatResponse>(response)));
}
