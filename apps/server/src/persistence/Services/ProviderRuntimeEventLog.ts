/**
 * ProviderRuntimeEventLogRepository - Repository interface for provider runtime events.
 *
 * Owns durable append/replay access to provider runtime session and turn events.
 *
 * @module ProviderRuntimeEventLogRepository
 */
import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProviderKind,
  ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderRuntimeEventLogRepositoryError } from "../Errors.ts";

export const ProviderRuntimeEventLogEntry = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  threadId: ThreadId,
  provider: ProviderKind,
  type: Schema.String,
  turnId: Schema.NullOr(TurnId),
  itemId: Schema.NullOr(RuntimeItemId),
  requestId: Schema.NullOr(RuntimeRequestId),
  createdAt: IsoDateTime,
  event: ProviderRuntimeEvent,
});
export type ProviderRuntimeEventLogEntry = typeof ProviderRuntimeEventLogEntry.Type;

export interface ProviderRuntimeEventLogRepositoryShape {
  readonly append: (
    event: ProviderRuntimeEvent,
  ) => Effect.Effect<ProviderRuntimeEventLogEntry, ProviderRuntimeEventLogRepositoryError>;

  readonly readFromSequence: (
    sequenceExclusive: number,
    limit?: number,
  ) => Stream.Stream<ProviderRuntimeEventLogEntry, ProviderRuntimeEventLogRepositoryError>;

  readonly readByThreadId: (
    threadId: ThreadId,
    limit?: number,
  ) => Stream.Stream<ProviderRuntimeEventLogEntry, ProviderRuntimeEventLogRepositoryError>;

  readonly readAll: () => Stream.Stream<
    ProviderRuntimeEventLogEntry,
    ProviderRuntimeEventLogRepositoryError
  >;
}

export class ProviderRuntimeEventLogRepository extends ServiceMap.Service<
  ProviderRuntimeEventLogRepository,
  ProviderRuntimeEventLogRepositoryShape
>()("t3/persistence/Services/ProviderRuntimeEventLog/ProviderRuntimeEventLogRepository") {}
