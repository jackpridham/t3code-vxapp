# Ollama Local Provider Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Ollama local-model support so chat sessions, restart-safe history replay, model selection, readiness probing, and git/text generation all work correctly without overloading SQLite.

**Architecture:** Keep `projection_thread_messages` as the only durable transcript store and never persist full Ollama transcripts into `provider_session_runtime`. Rebuild Ollama request payloads from authoritative T3 thread history, keep hot-path state in memory during an active session, and use lightweight HTTP probes plus a dedicated Ollama text-generation layer for non-chat generation features.

**Tech Stack:** TypeScript, Effect, SQLite projection repositories, WebSocket orchestration runtime, Vite/React UI, Ollama HTTP API (`/api/chat`, `/api/tags`, `/api/version`), Vitest via `bun run test`

---

## Planned File Structure

- Modify: `packages/contracts/src/provider.ts`
  Add provider-neutral conversation history payload for turn sends.
- Modify: `apps/server/src/provider/Services/ProviderAdapter.ts`
  Add explicit adapter recovery capability so Ollama can recover without a resume cursor.
- Create: `apps/server/src/provider/ollamaChat.ts`
  Shared Ollama chat types/helpers: request message shape, history normalization, model resolution, system prompt assembly, and stream parsing.
- Modify: `apps/server/src/provider/Layers/OllamaAdapter.ts`
  Use passed history, honor `modelSelection`, parse streamed chunks correctly, and advertise history-replay recovery.
- Modify: `apps/server/src/provider/Layers/ProviderService.ts`
  Allow recovery for adapters that replay thread history instead of requiring a resume cursor.
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  Build canonical conversation history from authoritative thread messages and pass it on each turn.
- Create: `apps/server/src/provider/ollamaProbe.ts`
  Lightweight readiness/model/version probe using `/api/version` and `/api/tags`.
- Modify: `apps/server/src/provider/Layers/OllamaProvider.ts`
  Replace config-only “ready” snapshots with real probe results and last-known-good model handling.
- Create: `apps/server/src/git/Layers/OllamaTextGeneration.ts`
  Implement commit/PR/branch/title generation with non-streaming `/api/chat`.
- Modify: `apps/server/src/git/Layers/RoutingTextGeneration.ts`
  Route `ollamaLocal` explicitly instead of falling through to Codex.
- Modify: `apps/web/src/components/chat/ProviderModelPicker.tsx`
  Allow warning-state Ollama selection when models are still available.
- Modify: `apps/server/integration/ollamaLocal.live.integration.test.ts`
  Cover two-turn replay, readiness probe, and git/text generation against the live endpoint.

## Important Defaults

- Durable chat history stays in `projection_thread_messages`; do not add a second transcript table.
- `provider_session_runtime.runtime_payload_json` remains small metadata only: cwd, model/modelSelection, activeTurnId, lastError, instruction fingerprint, timestamps.
- Ollama runtime uses streamed `POST /api/chat` and consumes only `message.content`; ignore `message.thinking`.
- Ollama git/text generation uses non-streaming `POST /api/chat` and parses JSON from `message.content`.
- Readiness probing uses `GET /api/version` and `GET /api/tags`, cached in the existing managed provider snapshot layer; never write probe state to SQLite.
- Instruction changes remain restart boundaries for Ollama, and the adapter must actually materialize an Ollama system prompt from the same instruction surface (`AGENTS.md`, `CLAUDE.md`) so the restart is meaningful.

### Task 1: Extend Provider Contracts For History Replay Recovery

**Files:**

- Modify: `packages/contracts/src/provider.ts`
- Modify: `apps/server/src/provider/Services/ProviderAdapter.ts`
- Test: `packages/contracts/src/provider.test.ts`
- Test: `apps/server/src/provider/Layers/ProviderService.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/src/provider.test.ts
it("decodes ProviderSendTurnInput with conversationHistory", () => {
  const decoded = decodeProviderSendTurnInput({
    threadId: "thread-1",
    input: "next turn",
    conversationHistory: [
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "first reply" },
    ],
  });

  expect(decoded.conversationHistory).toEqual([
    { role: "user", content: "first prompt" },
    { role: "assistant", content: "first reply" },
  ]);
});

// apps/server/src/provider/Layers/ProviderService.test.ts
it.effect("allows recovery without resumeCursor for history-replay adapters", () =>
  Effect.gen(function* () {
    // start with persisted binding for ollamaLocal, no resumeCursor
    // expect sendTurn to recover and reach adapter.sendTurn
  }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test packages/contracts/src/provider.test.ts apps/server/src/provider/Layers/ProviderService.test.ts`

Expected: FAIL because `conversationHistory` is not part of `ProviderSendTurnInput` and provider capabilities do not distinguish resume-cursor vs history-replay recovery.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/contracts/src/provider.ts
export const ProviderConversationHistoryMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant", "system"]),
  content: TrimmedNonEmptyString,
});
export type ProviderConversationHistoryMessage = typeof ProviderConversationHistoryMessage.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  conversationHistory: Schema.optional(Schema.Array(ProviderConversationHistoryMessage)),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});

// apps/server/src/provider/Services/ProviderAdapter.ts
export type ProviderSessionRecoveryMode = "resume-cursor" | "history-replay";

export interface ProviderAdapterCapabilities {
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  readonly sessionRecovery: ProviderSessionRecoveryMode;
}

// apps/server/src/provider/Layers/ProviderService.ts
const canRecoverWithoutResumeCursor = adapter.capabilities.sessionRecovery === "history-replay";

if (!hasResumeCursor && !canRecoverWithoutResumeCursor) {
  return (
    yield *
    toValidationError(
      input.operation,
      `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
    )
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test packages/contracts/src/provider.test.ts apps/server/src/provider/Layers/ProviderService.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/provider.ts \
  apps/server/src/provider/Services/ProviderAdapter.ts \
  packages/contracts/src/provider.test.ts \
  apps/server/src/provider/Layers/ProviderService.ts \
  apps/server/src/provider/Layers/ProviderService.test.ts
git commit -m "feat: add provider history replay recovery contract"
```

### Task 2: Build Canonical Ollama History On The Turn Hot Path

**Files:**

- Create: `apps/server/src/provider/ollamaChat.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- Test: `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("builds ollama conversation history from prior thread messages only", async () => {
  // seed thread with:
  // user: "one"
  // assistant: "two"
  // user: "three" (current message for the turn-start request)
  // expect providerService.sendTurn to receive conversationHistory:
  // [{ role: "user", content: "one" }, { role: "assistant", content: "two" }]
  // and input: "three"
});

it("does not include streaming or empty assistant fragments in ollama conversation history", async () => {
  // seed prior messages with an empty/streaming assistant artifact
  // expect normalized history to skip it
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

Expected: FAIL because no history builder exists and `providerService.sendTurn` is called without `conversationHistory`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/server/src/provider/ollamaChat.ts
import type {
  OrchestrationMessage,
  ProviderConversationHistoryMessage,
  ProviderKind,
} from "@t3tools/contracts";

export function buildOllamaConversationHistory(input: {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly currentUserMessageId: string;
}): ReadonlyArray<ProviderConversationHistoryMessage> {
  return input.messages.flatMap((message) => {
    if (message.id === input.currentUserMessageId) return [];
    if (message.text.trim().length === 0) return [];
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      return [];
    }
    return [{ role: message.role, content: message.text }];
  });
}

// apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
const conversationHistory =
  thread.modelSelection.provider === "ollamaLocal"
    ? buildOllamaConversationHistory({
        messages: thread.messages,
        currentUserMessageId: message.id,
      })
    : undefined;

const startedTurn =
  yield *
  providerService.sendTurn({
    threadId: input.threadId,
    ...(normalizedInput ? { input: normalizedInput } : {}),
    ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
    ...(conversationHistory !== undefined ? { conversationHistory } : {}),
    ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
    ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/ollamaChat.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
git commit -m "feat: pass authoritative ollama conversation history on turn send"
```

### Task 3: Finish Ollama Runtime Session Behavior

**Files:**

- Modify: `apps/server/src/provider/Layers/OllamaAdapter.ts`
- Modify: `apps/server/src/provider/Services/OllamaAdapter.ts`
- Modify: `apps/server/src/provider/ollamaConfig.ts`
- Test: `apps/server/src/provider/Layers/OllamaAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it.effect("honors per-turn ollama modelSelection when provider is ollamaLocal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // sendTurn({ modelSelection: { provider: "ollamaLocal", model: "qwen3:14b" } })
      // expect request body.model === "qwen3:14b"
    }),
  ),
);

it.effect("sends the full supplied conversationHistory plus current user message to /chat", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // expect request body.messages to include prior user/assistant history in order
      // and the current user prompt as the final entry
    }),
  ),
);

it.effect("ignores message.thinking and completes on done=true streamed chunks", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // emit thinking + content + done chunk
      // expect only assistant_text deltas and completed turn
    }),
  ),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/src/provider/Layers/OllamaAdapter.test.ts`

Expected: FAIL because the adapter always uses the settings default model and only uses `context.messages`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/server/src/provider/ollamaConfig.ts
export function resolveOllamaModelForTurn(input: {
  readonly defaultModel: string;
  readonly modelSelection?: { provider: string; model: string } | undefined;
}): string {
  return input.modelSelection?.provider === "ollamaLocal"
    ? normalizeModelSlug(input.modelSelection.model, "ollamaLocal") ??
        input.modelSelection.model
    : normalizeModelSlug(input.defaultModel, "ollamaLocal") ?? input.defaultModel;
}

// apps/server/src/provider/Layers/OllamaAdapter.ts
const model = resolveOllamaModelForTurn({
  defaultModel: runtimeConfig.model,
  modelSelection: input.modelSelection,
});

const history = input.conversationHistory ?? context.messages;
const requestMessages = [
  ...history,
  { role: "user" as const, content: text },
];

body: JSON.stringify({
  model,
  messages: requestMessages,
  stream: true,
}),

if (!failed) {
  context.messages = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];
}

return {
  provider: PROVIDER,
  capabilities: {
    sessionModelSwitch: "in-session",
    sessionRecovery: "history-replay",
  },
  startSession,
  sendTurn,
  interruptTurn,
  respondToRequest: () => unsupported("respondToRequest"),
  respondToUserInput: () => unsupported("respondToUserInput"),
  stopSession,
  listSessions,
  hasSession,
  readThread,
  rollbackThread,
  stopAll,
  streamEvents: Stream.fromQueue(runtimeEventQueue),
} satisfies OllamaAdapterShape;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/src/provider/Layers/OllamaAdapter.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/Layers/OllamaAdapter.ts \
  apps/server/src/provider/Services/OllamaAdapter.ts \
  apps/server/src/provider/ollamaConfig.ts \
  apps/server/src/provider/Layers/OllamaAdapter.test.ts
git commit -m "feat: complete ollama runtime history replay and model selection"
```

### Task 4: Add Real Ollama Probe And Last-Known-Good Model Handling

**Files:**

- Create: `apps/server/src/provider/ollamaProbe.ts`
- Modify: `apps/server/src/provider/Layers/OllamaProvider.ts`
- Test: `apps/server/src/provider/Layers/OllamaProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it.effect("reports ready with discovered models when /version and /tags succeed", () =>
  Effect.gen(function* () {
    // expect status ready, version populated, and models from /api/tags
  }),
);

it.effect("reports warning/error and preserves configured models when probe fails", () =>
  Effect.gen(function* () {
    // expect snapshot models still include default/custom configured models
    // and status is not falsely ready
  }),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/src/provider/Layers/OllamaProvider.test.ts`

Expected: FAIL because the provider never probes the endpoint and always reports `ready`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/server/src/provider/ollamaProbe.ts
export interface OllamaProbeResult {
  readonly version: string | null;
  readonly models: ReadonlyArray<string>;
  readonly status: "ready" | "warning" | "error";
  readonly message: string;
}

export const probeOllama = (baseUrl: string, runFetch: typeof fetch = fetch) =>
  Effect.gen(function* () {
    const [versionResponse, tagsResponse] = yield* Effect.all([
      Effect.tryPromise(() => runFetch(`${baseUrl}/version`)),
      Effect.tryPromise(() => runFetch(`${baseUrl}/tags`)),
    ]);
    const versionJson = yield* Effect.tryPromise(
      () => versionResponse.json() as Promise<{ version?: string }>,
    );
    const tagsJson = yield* Effect.tryPromise(
      () => tagsResponse.json() as Promise<{ models?: Array<{ name?: string; model?: string }> }>,
    );
    return {
      version: versionJson.version ?? null,
      models: (tagsJson.models ?? []).flatMap((entry) => entry.name ?? entry.model ?? []),
      status: "ready" as const,
      message: `Connected to ${baseUrl}.`,
    } satisfies OllamaProbeResult;
  });

// apps/server/src/provider/Layers/OllamaProvider.ts
const configuredModels = listOllamaConfiguredModels(settings);
const probed =
  yield *
  probeOllama(runtimeConfig.baseUrl).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        version: null,
        models: configuredModels,
        status: "warning" as const,
        message: `Could not reach ${runtimeConfig.baseUrl}; using configured models.`,
      }),
    ),
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/src/provider/Layers/OllamaProvider.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/provider/ollamaProbe.ts \
  apps/server/src/provider/Layers/OllamaProvider.ts \
  apps/server/src/provider/Layers/OllamaProvider.test.ts
git commit -m "feat: probe ollama readiness and discovered models"
```

### Task 5: Implement Ollama Git/Text Generation

**Files:**

- Create: `apps/server/src/git/Layers/OllamaTextGeneration.ts`
- Modify: `apps/server/src/git/Layers/RoutingTextGeneration.ts`
- Modify: `apps/server/src/git/Services/TextGeneration.ts`
- Test: `apps/server/src/git/Layers/OllamaTextGeneration.test.ts`
- Test: `apps/server/src/git/Layers/GitManager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it.effect("routes ollamaLocal commit-message generation to the Ollama layer", () =>
  Effect.gen(function* () {
    // expect RoutingTextGeneration to call OllamaTextGeneration, not Codex
  }),
);

it.effect("parses JSON commit-message output from non-streaming ollama /chat", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // fake response:
      // { message: { role: "assistant", content: "{\"subject\":\"fix: x\",\"body\":\"details\"}" }, done: true }
      // expect sanitized commit message result
    }),
  ),
);

it.effect("fails cleanly when ollama returns invalid JSON content", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // expect TextGenerationError with invalid structured output detail
    }),
  ),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/server/src/git/Layers/OllamaTextGeneration.test.ts apps/server/src/git/Layers/GitManager.test.ts`

Expected: FAIL because no Ollama text-generation layer or routing exists.

- [ ] **Step 3: Write the minimal implementation**

```ts
// apps/server/src/git/Layers/OllamaTextGeneration.ts
const runOllamaJson = <S extends Schema.Top>(input: {
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle";
  cwd: string;
  prompt: string;
  outputSchema: S;
  modelSelection: Extract<ModelSelection, { provider: "ollamaLocal" }>;
}) =>
  Effect.gen(function* () {
    const settings = yield* serverSettingsService.getSettings;
    const runtimeConfig = resolveOllamaRuntimeConfig(settings.providers.ollamaLocal);
    const model = resolveOllamaModelForTurn({
      defaultModel: runtimeConfig.model,
      modelSelection: input.modelSelection,
    });
    const response = yield* Effect.tryPromise(() =>
      runFetch(`${runtimeConfig.baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: "system", content: "Return only valid JSON matching the requested schema." },
            { role: "user", content: input.prompt },
          ],
        }),
      }),
    );
    const json = yield* Effect.tryPromise(
      () => response.json() as Promise<{ message?: { content?: string } }>,
    );
    const rawContent = stripMarkdownCodeFences(json.message?.content ?? "");
    return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchema))(rawContent);
  });

// apps/server/src/git/Layers/RoutingTextGeneration.ts
const route = (provider?: TextGenerationProvider): TextGenerationShape =>
  provider === "claudeAgent" ? claude : provider === "ollamaLocal" ? ollama : codex;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/server/src/git/Layers/OllamaTextGeneration.test.ts apps/server/src/git/Layers/GitManager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/git/Layers/OllamaTextGeneration.ts \
  apps/server/src/git/Layers/RoutingTextGeneration.ts \
  apps/server/src/git/Services/TextGeneration.ts \
  apps/server/src/git/Layers/OllamaTextGeneration.test.ts \
  apps/server/src/git/Layers/GitManager.test.ts
git commit -m "feat: add ollama git text generation"
```

### Task 6: Align Web Provider UX With Real Ollama Snapshot States

**Files:**

- Modify: `apps/web/src/components/chat/ProviderModelPicker.tsx`
- Modify: `apps/web/src/providerModels.ts`
- Test: `apps/web/src/modelSelection.test.ts`
- Test: `apps/web/src/components/chat/ProviderModelPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("allows selecting ollamaLocal when the provider is enabled, has models, and status is warning", () => {
  // provider snapshot: enabled=true, status="warning", models=[{ slug: "qwen3:8b", name: "Qwen3 8B", isCustom: false, capabilities: null }]
  // expect the menu item to stay selectable
});

it("still disables providers that are disabled or have no models", () => {
  // expect disabled label for disabled or empty-model providers
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/web/src/components/chat/ProviderModelPicker.test.tsx apps/web/src/modelSelection.test.ts`

Expected: FAIL because the picker currently disables every provider whose status is not `ready`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// apps/web/src/components/chat/ProviderModelPicker.tsx
const canSelectLiveProvider =
  !liveProvider ||
  (!liveProvider.enabled
    ? false
    : liveProvider.models.length > 0 &&
      (liveProvider.status === "ready" || liveProvider.status === "warning"));

if (!canSelectLiveProvider) {
  const unavailableLabel = !liveProvider?.enabled
    ? "Disabled"
    : liveProvider && liveProvider.models.length === 0
      ? "No models"
      : "Unavailable";
  // render disabled item
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/web/src/components/chat/ProviderModelPicker.test.tsx apps/web/src/modelSelection.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/chat/ProviderModelPicker.tsx \
  apps/web/src/providerModels.ts \
  apps/web/src/modelSelection.test.ts \
  apps/web/src/components/chat/ProviderModelPicker.test.tsx
git commit -m "feat: allow warning-state ollama selection with cached models"
```

### Task 7: Prove Restart Safety, Live Endpoint Behavior, And Final Repo Validation

**Files:**

- Modify: `apps/server/integration/ollamaLocal.live.integration.test.ts`
- Modify: `apps/server/src/provider/Layers/ProviderService.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`
- Modify: `apps/server/src/provider/Layers/OllamaAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it.live("replays persisted history across a recreated ollama session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // first turn succeeds
      // stop/recreate session
      // second turn must mention first-turn context
    }),
  ),
);

it.live("probes live ollama version and tags before exposing ready status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // expect provider snapshot status ready and model list populated from /api/tags
    }),
  ),
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && bun run test integration/ollamaLocal.live.integration.test.ts`

Expected: FAIL until the restart-safe replay path and probe-backed provider snapshot are implemented.

- [ ] **Step 3: Finish implementation cleanup and cross-layer assertions**

```ts
// apps/server/src/provider/Layers/ProviderService.test.ts
assert.equal(fakeOllamaAdapter.capabilities.sessionRecovery, "history-replay");

// apps/server/integration/ollamaLocal.live.integration.test.ts
yield *
  adapter.sendTurn({
    threadId,
    input: "Reply with the word alpha.",
    conversationHistory: [],
    modelSelection: { provider: "ollamaLocal", model: "qwen3:8b" },
  });

yield * adapter.stopSession(threadId);
yield *
  adapter.startSession({
    threadId,
    provider: "ollamaLocal",
    runtimeMode: "full-access",
  });

yield *
  adapter.sendTurn({
    threadId,
    input: "Reply again and mention the earlier alpha instruction.",
    conversationHistory: [
      { role: "user", content: "Reply with the word alpha." },
      { role: "assistant", content: "alpha" },
    ],
    modelSelection: { provider: "ollamaLocal", model: "qwen3:8b" },
  });
```

- [ ] **Step 4: Run all required validation**

Run: `bun run test apps/server/src/provider/Layers/OllamaAdapter.test.ts apps/server/src/provider/Layers/OllamaProvider.test.ts apps/server/src/provider/Layers/ProviderService.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts apps/server/src/git/Layers/OllamaTextGeneration.test.ts apps/server/src/git/Layers/GitManager.test.ts apps/web/src/components/chat/ProviderModelPicker.test.tsx apps/web/src/modelSelection.test.ts`

Expected: PASS

Run: `cd apps/server && bun run test integration/ollamaLocal.live.integration.test.ts`

Expected: PASS against the live `192.168.10.12:11434` endpoint

Run: `bun fmt && bun lint && bun typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/integration/ollamaLocal.live.integration.test.ts \
  apps/server/src/provider/Layers/ProviderService.test.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts \
  apps/server/src/provider/Layers/OllamaAdapter.test.ts
git commit -m "test: verify ollama live replay and repo-wide validation"
```

## Self-Review

- Spec coverage: covers runtime chat, full-history resend, restart-safe behavior, provider probing, picker/settings behavior, git/text generation, and SQLite scaling constraints.
- Placeholder scan: no `TODO`, `TBD`, or “write tests for the above” placeholders remain.
- Type consistency: `conversationHistory` is introduced once in the provider contract and reused in the reactor, service, and adapter layers; recovery capability is defined once and referenced consistently as `sessionRecovery`.

## Acceptance Criteria

- Ollama user turns send the selected Ollama model, not the server default unless no model was selected.
- Each Ollama turn sends authoritative prior thread history plus the current user message to `/api/chat`.
- Server/session restart does not lose Ollama thread context because the next turn replays durable T3 history.
- SQLite writes remain unchanged in shape for transcripts: only the existing projection pipeline persists thread messages.
- `provider_session_runtime` remains metadata-only and small.
- Git commit/PR/branch/title generation works with `textGenerationModelSelection.provider === "ollamaLocal"`.
- Settings and picker show real endpoint health/model truth instead of a hardcoded ready state.
- `bun fmt`, `bun lint`, `bun typecheck`, and the focused `bun run test` suites all pass.
