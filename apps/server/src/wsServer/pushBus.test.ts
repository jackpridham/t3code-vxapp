import type { WebSocket } from "ws";
import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref } from "effect";
import {
  CommandId,
  EventId,
  MessageId,
  ORCHESTRATION_WS_CHANNELS,
  ThreadId,
  TurnId,
  WS_CHANNELS,
} from "@t3tools/contracts";

import { makeServerPushBus } from "./pushBus";

class MockWebSocket {
  static readonly OPEN = 1;

  readonly OPEN = MockWebSocket.OPEN;
  readyState = MockWebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  private readonly waiters = new Set<() => void>();

  send(message: string) {
    this.sent.push(message);
    for (const waiter of this.waiters) {
      waiter();
    }
  }

  waitForSentCount(count: number): Promise<void> {
    if (this.sent.length >= count) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const check = () => {
        if (this.sent.length < count) {
          return;
        }
        this.waiters.delete(check);
        resolve();
      };

      this.waiters.add(check);
    });
  }
}

function assistantMessageEvent(input: {
  readonly sequence: number;
  readonly text: string;
  readonly streaming: boolean;
}) {
  const occurredAt = `2026-05-24T00:00:${String(input.sequence).padStart(2, "0")}.000Z`;
  return {
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    sequence: input.sequence,
    type: "thread.message-sent",
    aggregateKind: "thread",
    aggregateId: ThreadId.makeUnsafe("thread-1"),
    commandId: CommandId.makeUnsafe(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    occurredAt,
    metadata: {},
    payload: {
      threadId: ThreadId.makeUnsafe("thread-1"),
      messageId: MessageId.makeUnsafe("assistant:message-1"),
      role: "assistant",
      text: input.text,
      turnId: TurnId.makeUnsafe("turn-1"),
      streaming: input.streaming,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
  } as const;
}

describe("makeServerPushBus", () => {
  it.live("waits for the welcome push before a new client joins broadcast delivery", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = new MockWebSocket();
        const clients = yield* Ref.make(new Set<WebSocket>());
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
          issues: [{ kind: "keybindings.malformed-config", message: "queued-before-connect" }],
        });

        const delivered = yield* pushBus.publishClient(
          client as unknown as WebSocket,
          WS_CHANNELS.serverWelcome,
          {
            cwd: "/tmp/project",
            projectName: "project",
          },
        );
        expect(delivered).toBe(true);

        yield* Ref.update(clients, (current) => current.add(client as unknown as WebSocket));

        yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
          issues: [],
        });

        yield* Effect.promise(() => client.waitForSentCount(2));

        const messages = client.sent.map(
          (message) => JSON.parse(message) as { channel: string; data: unknown },
        );

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({
          type: "push",
          sequence: 2,
          channel: WS_CHANNELS.serverWelcome,
          data: {
            cwd: "/tmp/project",
            projectName: "project",
          },
        });
        expect(messages[1]).toEqual({
          type: "push",
          sequence: 3,
          channel: WS_CHANNELS.serverConfigUpdated,
          data: {
            issues: [],
          },
        });
      }),
    ),
  );

  it.live("coalesces queued assistant streaming deltas and preserves final completions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = new MockWebSocket();
        const clients = yield* Ref.make(new Set([client as unknown as WebSocket]));
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        yield* Effect.all(
          Array.from({ length: 50 }, (_, index) =>
            pushBus.publishAll(
              ORCHESTRATION_WS_CHANNELS.domainEvent,
              assistantMessageEvent({
                sequence: index + 1,
                text: `${index + 1},`,
                streaming: true,
              }),
            ),
          ),
          { concurrency: "unbounded" },
        );
        yield* pushBus.publishAll(
          ORCHESTRATION_WS_CHANNELS.domainEvent,
          assistantMessageEvent({ sequence: 51, text: "", streaming: false }),
        );

        yield* Effect.promise(() => client.waitForSentCount(2));
        const health = yield* pushBus.getHealth;
        const pushes = client.sent.map(
          (message) =>
            JSON.parse(message) as {
              channel: string;
              data: { type: string; payload: { text: string; streaming: boolean } };
            },
        );

        expect(health.domainEventPublishCount).toBe(51);
        expect(health.coalescedAssistantDeltaCount).toBeGreaterThan(0);
        expect(pushes.at(-1)?.data.payload.streaming).toBe(false);
      }),
    ),
  );

  it.live("skips non-final streaming deltas for slow clients without blocking fast clients", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fastClient = new MockWebSocket();
        const slowClient = new MockWebSocket();
        slowClient.bufferedAmount = 2_000_000;
        const clients = yield* Ref.make(
          new Set([fastClient as unknown as WebSocket, slowClient as unknown as WebSocket]),
        );
        const pushBus = yield* makeServerPushBus({
          clients,
          logOutgoingPush: () => {},
        });

        yield* pushBus.publishAll(
          ORCHESTRATION_WS_CHANNELS.domainEvent,
          assistantMessageEvent({ sequence: 1, text: "streaming", streaming: true }),
        );
        yield* pushBus.publishAll(
          ORCHESTRATION_WS_CHANNELS.domainEvent,
          assistantMessageEvent({ sequence: 2, text: "", streaming: false }),
        );

        yield* Effect.promise(() => fastClient.waitForSentCount(2));
        yield* Effect.promise(() => slowClient.waitForSentCount(1));
        const health = yield* pushBus.getHealth;
        const slowPush = JSON.parse(slowClient.sent[0] ?? "{}") as {
          data?: { payload?: { streaming?: boolean } };
        };

        expect(fastClient.sent).toHaveLength(2);
        expect(slowClient.sent).toHaveLength(1);
        expect(slowPush.data?.payload?.streaming).toBe(false);
        expect(health.slowClientCount).toBe(1);
        expect(health.droppedStreamingDeltaCount).toBe(1);
        expect(health.maxClientBufferedAmount).toBe(2_000_000);
      }),
    ),
  );
});
