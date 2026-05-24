import {
  ORCHESTRATION_WS_CHANNELS,
  type OrchestrationEvent,
  WsPush,
  type WsPushChannel,
  type WsPushData,
  type WsPushEnvelopeBase,
} from "@t3tools/contracts";
import { Deferred, Effect, Queue, Ref, Schema } from "effect";
import type { Scope } from "effect";
import type { WebSocket } from "ws";

type PushTarget =
  | { readonly kind: "all" }
  | { readonly kind: "client"; readonly client: WebSocket };

interface PushJob<C extends WsPushChannel = WsPushChannel> {
  channel: C;
  data: WsPushData<C>;
  readonly target: PushTarget;
  readonly delivered: Deferred.Deferred<boolean> | null;
  readonly coalesceKey: string | null;
}

interface PendingPushJob {
  job: PushJob;
}

export interface ServerPushBusHealth {
  readonly pushQueueDepth: number;
  readonly coalescedAssistantDeltaCount: number;
  readonly droppedStreamingDeltaCount: number;
  readonly slowClientCount: number;
  readonly maxClientBufferedAmount: number;
  readonly domainEventPublishCount: number;
}

export interface ServerPushBus {
  readonly publishAll: <C extends WsPushChannel>(
    channel: C,
    data: WsPushData<C>,
  ) => Effect.Effect<void>;
  readonly publishClient: <C extends WsPushChannel>(
    client: WebSocket,
    channel: C,
    data: WsPushData<C>,
  ) => Effect.Effect<boolean>;
  readonly getHealth: Effect.Effect<ServerPushBusHealth>;
}

const MAX_PENDING_PUSH_JOBS = 2_048;
const SLOW_CLIENT_BUFFERED_AMOUNT_BYTES = 1_000_000;

type AssistantStreamingDeltaEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

function assistantStreamingDeltaEvent<C extends WsPushChannel>(
  channel: C,
  data: WsPushData<C>,
): AssistantStreamingDeltaEvent | null {
  if (channel !== ORCHESTRATION_WS_CHANNELS.domainEvent) {
    return null;
  }
  const event = data as OrchestrationEvent;
  if (
    event.type !== "thread.message-sent" ||
    event.payload.role !== "assistant" ||
    event.payload.streaming !== true
  ) {
    return null;
  }
  return event;
}

function assistantDeltaCoalesceKey<C extends WsPushChannel>(
  channel: C,
  data: WsPushData<C>,
): string | null {
  const event = assistantStreamingDeltaEvent(channel, data);
  if (!event) {
    return null;
  }
  return [event.payload.threadId, event.payload.messageId, event.payload.turnId ?? "no-turn"].join(
    ":",
  );
}

function mergeAssistantDelta(current: PushJob, next: PushJob): PushJob {
  if (
    current.channel !== ORCHESTRATION_WS_CHANNELS.domainEvent ||
    next.channel !== ORCHESTRATION_WS_CHANNELS.domainEvent
  ) {
    return next;
  }
  const currentEvent = current.data as OrchestrationEvent;
  const nextEvent = next.data as OrchestrationEvent;
  if (currentEvent.type !== "thread.message-sent" || nextEvent.type !== "thread.message-sent") {
    return next;
  }
  return {
    ...next,
    data: {
      ...nextEvent,
      payload: {
        ...nextEvent.payload,
        text: `${currentEvent.payload.text}${nextEvent.payload.text}`,
        createdAt: currentEvent.payload.createdAt,
      },
    },
  };
}

function emptyHealth(): ServerPushBusHealth {
  return {
    pushQueueDepth: 0,
    coalescedAssistantDeltaCount: 0,
    droppedStreamingDeltaCount: 0,
    slowClientCount: 0,
    maxClientBufferedAmount: 0,
    domainEventPublishCount: 0,
  };
}

export const makeServerPushBus = (input: {
  readonly clients: Ref.Ref<Set<WebSocket>>;
  readonly logOutgoingPush: (push: WsPushEnvelopeBase, recipients: number) => void;
}): Effect.Effect<ServerPushBus, never, Scope.Scope> =>
  Effect.gen(function* () {
    const nextSequence = yield* Ref.make(0);
    const queue = yield* Queue.bounded<PendingPushJob>(MAX_PENDING_PUSH_JOBS);
    const pendingByKey = yield* Ref.make(new Map<string, PendingPushJob>());
    const health = yield* Ref.make(emptyHealth());
    const encodePush = Schema.encodeUnknownEffect(Schema.fromJsonString(WsPush));

    const settleDelivery = (job: PushJob, delivered: boolean) =>
      job.delivered === null
        ? Effect.void
        : Deferred.succeed(job.delivered, delivered).pipe(Effect.orDie);

    const markQueued = (job: PushJob) =>
      Ref.update(health, (current) => ({
        ...current,
        pushQueueDepth: current.pushQueueDepth + 1,
        domainEventPublishCount:
          job.channel === ORCHESTRATION_WS_CHANNELS.domainEvent
            ? current.domainEventPublishCount + 1
            : current.domainEventPublishCount,
      }));

    const markDequeued = (job: PushJob) =>
      Effect.all([
        job.coalesceKey === null
          ? Effect.void
          : Ref.update(pendingByKey, (current) => {
              const next = new Map(current);
              next.delete(job.coalesceKey!);
              return next;
            }),
        Ref.update(health, (current) => ({
          ...current,
          pushQueueDepth: Math.max(0, current.pushQueueDepth - 1),
        })),
      ]).pipe(Effect.asVoid);

    const markCoalesced = (job: PushJob) =>
      Ref.update(health, (current) => ({
        ...current,
        coalescedAssistantDeltaCount: current.coalescedAssistantDeltaCount + 1,
        domainEventPublishCount:
          job.channel === ORCHESTRATION_WS_CHANNELS.domainEvent
            ? current.domainEventPublishCount + 1
            : current.domainEventPublishCount,
      }));

    const markDroppedStreamingDelta = (count: number) =>
      count <= 0
        ? Effect.void
        : Ref.update(health, (current) => ({
            ...current,
            droppedStreamingDeltaCount: current.droppedStreamingDeltaCount + count,
          }));

    const updateClientBufferHealth = (input: {
      readonly slowClientCount: number;
      readonly maxClientBufferedAmount: number;
    }) =>
      Ref.update(health, (current) => ({
        ...current,
        slowClientCount: input.slowClientCount,
        maxClientBufferedAmount: Math.max(
          current.maxClientBufferedAmount,
          input.maxClientBufferedAmount,
        ),
      }));

    const send = Effect.fnUntraced(function* (job: PushJob) {
      const sequence = yield* Ref.updateAndGet(nextSequence, (current) => current + 1);
      const push: WsPushEnvelopeBase = {
        type: "push",
        sequence,
        channel: job.channel,
        data: job.data,
      };
      const recipients =
        job.target.kind === "all" ? yield* Ref.get(input.clients) : new Set([job.target.client]);

      return yield* encodePush(push).pipe(
        Effect.flatMap((message) =>
          Effect.gen(function* () {
            let recipientCount = 0;
            let skippedSlowStreamingRecipients = 0;
            let slowClientCount = 0;
            let maxClientBufferedAmount = 0;
            for (const client of recipients) {
              if (client.readyState !== client.OPEN) {
                continue;
              }
              const bufferedAmount = client.bufferedAmount;
              maxClientBufferedAmount = Math.max(maxClientBufferedAmount, bufferedAmount);
              const isSlowClient = bufferedAmount > SLOW_CLIENT_BUFFERED_AMOUNT_BYTES;
              if (isSlowClient) {
                slowClientCount += 1;
              }
              if (isSlowClient && job.coalesceKey !== null) {
                skippedSlowStreamingRecipients += 1;
                continue;
              }
              client.send(message);
              recipientCount += 1;
            }

            yield* updateClientBufferHealth({ slowClientCount, maxClientBufferedAmount });
            yield* markDroppedStreamingDelta(skippedSlowStreamingRecipients);
            input.logOutgoingPush(push, recipientCount);
            return recipientCount > 0;
          }),
        ),
      );
    });

    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(queue).pipe(
          Effect.tap((pending) => markDequeued(pending.job)),
          Effect.flatMap((pending) =>
            send(pending.job).pipe(
              Effect.tap((delivered) => settleDelivery(pending.job, delivered)),
              Effect.tapCause(() => settleDelivery(pending.job, false)),
              Effect.ignoreCause({ log: true }),
            ),
          ),
        ),
      ),
    );

    const enqueueJob = (job: PushJob): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (job.coalesceKey !== null) {
          const existing = yield* Ref.get(pendingByKey).pipe(
            Effect.map((current) => current.get(job.coalesceKey!)),
          );
          if (existing) {
            existing.job = mergeAssistantDelta(existing.job, job);
            yield* markCoalesced(job);
            return;
          }
        }

        const currentHealth = yield* Ref.get(health);
        if (job.coalesceKey !== null && currentHealth.pushQueueDepth >= MAX_PENDING_PUSH_JOBS) {
          yield* markDroppedStreamingDelta(1);
          yield* settleDelivery(job, false);
          return;
        }

        const pending: PendingPushJob = { job };
        if (job.coalesceKey !== null) {
          yield* Ref.update(pendingByKey, (current) => {
            const next = new Map(current);
            next.set(job.coalesceKey!, pending);
            return next;
          });
        }
        yield* markQueued(job);
        yield* Queue.offer(queue, pending).pipe(Effect.asVoid);
      });

    const publish =
      (target: PushTarget) =>
      <C extends WsPushChannel>(channel: C, data: WsPushData<C>) =>
        enqueueJob({
          channel,
          data,
          target,
          delivered: null,
          coalesceKey: assistantDeltaCoalesceKey(channel, data),
        });

    return {
      publishAll: publish({ kind: "all" }),
      publishClient: (client, channel, data) =>
        Effect.gen(function* () {
          const delivered = yield* Deferred.make<boolean>();
          yield* enqueueJob({
            channel,
            data,
            target: { kind: "client", client },
            delivered,
            coalesceKey: assistantDeltaCoalesceKey(channel, data),
          });
          return yield* Deferred.await(delivered);
        }),
      getHealth: Ref.get(health),
    } satisfies ServerPushBus;
  });
