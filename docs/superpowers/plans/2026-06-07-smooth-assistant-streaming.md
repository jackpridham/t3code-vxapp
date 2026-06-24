# Smooth Assistant Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assistant responses in the T3 executive chat render as low-latency streaming updates instead of arriving in large buffered bursts.

**Architecture:** Keep the existing streamed assistant message model and existing client append behavior, but change the server-side ingestion contract so streaming turns flush each assistant delta immediately instead of waiting for the `512` character threshold. Guard that behavior at two levels: the ingestion unit tests that persist `thread.message-sent` events, and the websocket integration test that proves a healthy browser client receives multiple live pushes before assistant completion.

**Tech Stack:** Bun, TypeScript, Effect, Vitest, WebSocket integration tests, Playwright-compatible browser proof workflow

---

## Scope Check

This plan intentionally excludes sidebar boot and broad ChatView perf refactors. The live review showed that the primary visible chunking is server-driven, not browser-side throttling. If the executive thread still feels gluggy after this plan lands, write a second plan for `ChatView`/`MessagesTimeline` hot-path optimization.

## File Structure

- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
  Responsibility: decide when assistant text deltas are persisted as `thread.message-sent` events during a streaming turn.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
  Responsibility: pin the assistant streaming contract at the ingestion layer.
- `apps/server/src/wsServer/pushBus.ts`
  Responsibility: decide whether queued assistant streaming pushes are merged together before delivery.
- `apps/server/src/wsServer/pushBus.test.ts`
  Responsibility: pin the push-bus delivery contract for assistant streaming deltas and slow-client protection.

### Task 1: Flush Every Streaming Assistant Delta

**Files:**

- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:61-62`
- Test: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`

- [ ] **Step 1: Rewrite the failing ingestion test to expect immediate per-delta streaming**

Replace the existing `it("batches subsequent assistant streaming deltas after the first live update", ...)` block with this exact test:

```ts
it("flushes every assistant streaming delta immediately", async () => {
  const harness = await createHarness({
    serverSettings: { enableAssistantStreaming: true },
  });
  const now = new Date().toISOString();

  harness.emit({
    type: "turn.started",
    eventId: asEventId("evt-turn-started-streaming-immediate"),
    provider: "codex",
    createdAt: now,
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-streaming-immediate"),
  });
  await waitForThread(
    harness.engine,
    (thread) =>
      thread.session?.status === "running" &&
      thread.session?.activeTurnId === "turn-streaming-immediate",
  );

  harness.emit({
    type: "content.delta",
    eventId: asEventId("evt-message-delta-streaming-immediate-1"),
    provider: "codex",
    createdAt: now,
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-streaming-immediate"),
    itemId: asItemId("item-streaming-immediate"),
    payload: {
      streamKind: "assistant_text",
      delta: "a",
    },
  });
  await waitForThread(harness.engine, (entry) =>
    entry.messages.some(
      (message: ProviderRuntimeTestMessage) =>
        message.id === "assistant:item-streaming-immediate" &&
        message.streaming &&
        message.text === "a",
    ),
  );

  harness.emit({
    type: "content.delta",
    eventId: asEventId("evt-message-delta-streaming-immediate-2"),
    provider: "codex",
    createdAt: now,
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-streaming-immediate"),
    itemId: asItemId("item-streaming-immediate"),
    payload: {
      streamKind: "assistant_text",
      delta: "b",
    },
  });
  await waitForThread(harness.engine, (entry) =>
    entry.messages.some(
      (message: ProviderRuntimeTestMessage) =>
        message.id === "assistant:item-streaming-immediate" &&
        message.streaming &&
        message.text === "ab",
    ),
  );

  harness.emit({
    type: "content.delta",
    eventId: asEventId("evt-message-delta-streaming-immediate-3"),
    provider: "codex",
    createdAt: now,
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-streaming-immediate"),
    itemId: asItemId("item-streaming-immediate"),
    payload: {
      streamKind: "assistant_text",
      delta: "c",
    },
  });
  await waitForThread(harness.engine, (entry) =>
    entry.messages.some(
      (message: ProviderRuntimeTestMessage) =>
        message.id === "assistant:item-streaming-immediate" &&
        message.streaming &&
        message.text === "abc",
    ),
  );

  harness.emit({
    type: "item.completed",
    eventId: asEventId("evt-message-completed-streaming-immediate"),
    provider: "codex",
    createdAt: now,
    threadId: asThreadId("thread-1"),
    turnId: asTurnId("turn-streaming-immediate"),
    itemId: asItemId("item-streaming-immediate"),
    payload: {
      itemType: "assistant_message",
      status: "completed",
    },
  });

  const finalThread = await waitForThread(harness.engine, (entry) =>
    entry.messages.some(
      (message: ProviderRuntimeTestMessage) =>
        message.id === "assistant:item-streaming-immediate" &&
        !message.streaming &&
        message.text === "abc",
    ),
  );
  const finalMessage = finalThread.messages.find(
    (message: ProviderRuntimeTestMessage) => message.id === "assistant:item-streaming-immediate",
  );
  expect(finalMessage?.text).toBe("abc");

  const events = await Effect.runPromise(
    Stream.runCollect(harness.engine.readEvents(0)).pipe(
      Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
    ),
  );
  const persistedMessageEvents = events.filter(
    (event): event is Extract<OrchestrationEvent, { type: "thread.message-sent" }> =>
      event.type === "thread.message-sent" &&
      event.payload.messageId === "assistant:item-streaming-immediate",
  );
  expect(persistedMessageEvents.map((event) => event.payload.text)).toEqual(["a", "b", "c", ""]);
});
```

- [ ] **Step 2: Run the test to verify it fails under the current 512-character batching**

Run:

```bash
bun run vitest apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts -t "flushes every assistant streaming delta immediately"
```

Expected: `FAIL` because the second and third deltas are still buffered until completion, so the in-flight message text stays at `"a"` and the persisted event list does not equal `["a", "b", "c", ""]`.

- [ ] **Step 3: Make the minimal production change in the ingestion layer**

Change the streaming flush threshold constant in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` to flush each streaming delta as it arrives:

```ts
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
const STREAMING_ASSISTANT_DELTA_FLUSH_CHARS = 1;
```

Keep the existing call site intact so the non-streaming path still buffers aggressively and the streaming path still uses the shared `appendBufferedAssistantText(...)` safety valve:

```ts
const streamingChunk =
  yield *
  appendBufferedAssistantText(
    assistantMessageId,
    assistantDelta,
    hasPersistedAssistantMessage ? STREAMING_ASSISTANT_DELTA_FLUSH_CHARS : 1,
  );
```

- [ ] **Step 4: Run the focused ingestion suite**

Run:

```bash
bun run vitest apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
```

Expected: `PASS`, including the new immediate-flush spec, the existing buffered-mode spec, and the oversized spill/finalization coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
git commit -m "fix: flush assistant streaming deltas immediately"
```

### Task 2: Stop Merging Distinct Streaming Pushes

**Files:**

- Modify: `apps/server/src/wsServer/pushBus.ts`
- Modify: `apps/server/src/wsServer/pushBus.test.ts`
- Test: `apps/server/src/wsServer/pushBus.test.ts`

- [ ] **Step 1: Rewrite the failing push-bus regression to expect distinct streaming sends**

Replace the current `it.live("coalesces queued assistant streaming deltas and preserves final completions", ...)` block with this exact test:

```ts
it.live("delivers distinct assistant streaming deltas without merging them", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = new MockWebSocket();
      const clients = yield* Ref.make(new Set([client as unknown as WebSocket]));
      const pushBus = yield* makeServerPushBus({
        clients,
        logOutgoingPush: () => {},
      });

      yield* pushBus.publishAll(
        ORCHESTRATION_WS_CHANNELS.domainEvent,
        assistantMessageEvent({
          sequence: 1,
          text: "a",
          streaming: true,
        }),
      );
      yield* pushBus.publishAll(
        ORCHESTRATION_WS_CHANNELS.domainEvent,
        assistantMessageEvent({
          sequence: 2,
          text: "b",
          streaming: true,
        }),
      );
      yield* pushBus.publishAll(
        ORCHESTRATION_WS_CHANNELS.domainEvent,
        assistantMessageEvent({
          sequence: 3,
          text: "",
          streaming: false,
        }),
      );

      yield* Effect.promise(() => client.waitForSentCount(3));
      const health = yield* pushBus.getHealth;
      const pushes = client.sent.map(
        (message) =>
          JSON.parse(message) as {
            channel: string;
            data: { type: string; payload: { text: string; streaming: boolean } };
          },
      );

      expect(pushes).toHaveLength(3);
      expect(pushes[0]?.data.payload).toMatchObject({ text: "a", streaming: true });
      expect(pushes[1]?.data.payload).toMatchObject({ text: "b", streaming: true });
      expect(pushes[2]?.data.payload).toMatchObject({ text: "", streaming: false });
      expect(health.coalescedAssistantDeltaCount).toBe(0);
    }),
  ),
);
```

- [ ] **Step 2: Run the push-bus test to verify it fails with the current coalesce key**

Run:

```bash
bun run vitest apps/server/src/wsServer/pushBus.test.ts -t "delivers distinct assistant streaming deltas without merging them"
```

Expected: `FAIL` because the current coalesce key merges the two streaming jobs into one queued push and increments `coalescedAssistantDeltaCount`.

- [ ] **Step 3: Make streaming assistant delta coalescing unique per event**

In `apps/server/src/wsServer/pushBus.ts`, keep the streaming-delta detection logic so slow-client skipping still recognizes assistant streaming jobs, but make the coalesce key unique per event instead of keying only by `threadId/messageId/turnId`.

```ts
function assistantDeltaCoalesceKey<C extends WsPushChannel>(
  channel: C,
  data: WsPushData<C>,
): string | null {
  const event = assistantStreamingDeltaEvent(channel, data);
  if (!event) {
    return null;
  }
  return [
    event.payload.threadId,
    event.payload.messageId,
    event.payload.turnId ?? "no-turn",
    event.eventId,
  ].join(":");
}
```

- [ ] **Step 4: Run the focused push-bus suite**

Run:

```bash
bun run vitest apps/server/src/wsServer/pushBus.test.ts
```

Expected: `PASS`, including the new distinct-delta delivery spec and the existing slow-client drop spec.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/wsServer/pushBus.ts apps/server/src/wsServer/pushBus.test.ts
git commit -m "fix: stop merging assistant streaming pushes"
```

### Task 3: Validate the Real UX Path

**Files:**

- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- Modify: `apps/server/src/wsServer/pushBus.ts`
- Modify: `apps/server/src/wsServer/pushBus.test.ts`

- [ ] **Step 1: Run the targeted server test pack**

Run:

```bash
bun run vitest apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/server/src/wsServer/pushBus.test.ts
```

Expected: `PASS`.

- [ ] **Step 2: Re-prove the live executive thread in the browser**

Run:

```bash
bun --cwd apps/web - <<'BUN'
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('http://127.0.0.1:7421/thread-7c791bde830a', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(8000);
const samples = [];
for (let i = 0; i < 8; i++) {
  const bodyText = await page.locator('body').innerText();
  samples.push({
    sample: i,
    length: bodyText.length,
    preview: bodyText.slice(-600),
  });
  await page.waitForTimeout(1000);
}
console.log(JSON.stringify(samples, null, 2));
await browser.close();
BUN
```

Expected: the assistant section length should advance in smaller, more frequent increments instead of staying flat for several seconds and then jumping by hundreds of characters.

- [ ] **Step 3: Format the repo**

Run:

```bash
bun fmt
```

Expected: formatting completes with no remaining diff churn.

- [ ] **Step 4: Run lint and typecheck**

Run:

```bash
bun lint
bun typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Commit the final validated change set**

```bash
git add apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/server/src/wsServer/pushBus.ts apps/server/src/wsServer/pushBus.test.ts
git commit -m "fix: smooth assistant streaming in chat"
```
