import { NonNegativeInt, ProviderRuntimeEvent, ThreadId } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Stream, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProviderRuntimeEventLogEntry,
  ProviderRuntimeEventLogRepository,
  type ProviderRuntimeEventLogRepositoryShape,
} from "../Services/ProviderRuntimeEventLog.ts";
import type { ProviderRuntimeEventLogRepositoryError } from "../Errors.ts";

const ProviderRuntimeEventLogDbRowSchema = ProviderRuntimeEventLogEntry.mapFields(
  Struct.assign({
    event: Schema.fromJsonString(ProviderRuntimeEvent),
  }),
);

const AppendRuntimeEventRequestSchema = ProviderRuntimeEvent;

const ReadFromSequenceRequestSchema = Schema.Struct({
  sequenceExclusive: NonNegativeInt,
  limit: NonNegativeInt,
});

const ReadByThreadIdRequestSchema = Schema.Struct({
  threadId: ThreadId,
  limit: NonNegativeInt,
});

const DEFAULT_READ_FROM_SEQUENCE_LIMIT = 1_000;
const READ_PAGE_SIZE = 500;

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProviderRuntimeEventLogRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const appendRuntimeEventRow = SqlSchema.findOne({
    Request: AppendRuntimeEventRequestSchema,
    Result: ProviderRuntimeEventLogDbRowSchema,
    execute: (event) =>
      sql`
        INSERT INTO provider_runtime_events (
          event_id,
          thread_id,
          provider_name,
          event_type,
          turn_id,
          item_id,
          request_id,
          created_at,
          event_json
        )
        VALUES (
          ${event.eventId},
          ${event.threadId},
          ${event.provider},
          ${event.type},
          ${event.turnId ?? null},
          ${event.itemId ?? null},
          ${event.requestId ?? null},
          ${event.createdAt},
          ${JSON.stringify(event)}
        )
        RETURNING
          sequence,
          event_id AS "eventId",
          thread_id AS "threadId",
          provider_name AS "provider",
          event_type AS "type",
          turn_id AS "turnId",
          item_id AS "itemId",
          request_id AS "requestId",
          created_at AS "createdAt",
          event_json AS "event"
      `,
  });

  const readFromSequenceRows = SqlSchema.findAll({
    Request: ReadFromSequenceRequestSchema,
    Result: ProviderRuntimeEventLogDbRowSchema,
    execute: ({ sequenceExclusive, limit }) =>
      sql`
        SELECT
          sequence,
          event_id AS "eventId",
          thread_id AS "threadId",
          provider_name AS "provider",
          event_type AS "type",
          turn_id AS "turnId",
          item_id AS "itemId",
          request_id AS "requestId",
          created_at AS "createdAt",
          event_json AS "event"
        FROM provider_runtime_events
        WHERE sequence > ${sequenceExclusive}
        ORDER BY sequence ASC
        LIMIT ${limit}
      `,
  });

  const readByThreadIdRows = SqlSchema.findAll({
    Request: ReadByThreadIdRequestSchema,
    Result: ProviderRuntimeEventLogDbRowSchema,
    execute: ({ threadId, limit }) =>
      sql`
        SELECT
          sequence,
          event_id AS "eventId",
          thread_id AS "threadId",
          provider_name AS "provider",
          event_type AS "type",
          turn_id AS "turnId",
          item_id AS "itemId",
          request_id AS "requestId",
          created_at AS "createdAt",
          event_json AS "event"
        FROM provider_runtime_events
        WHERE thread_id = ${threadId}
        ORDER BY sequence ASC
        LIMIT ${limit}
      `,
  });

  const append: ProviderRuntimeEventLogRepositoryShape["append"] = (event) =>
    appendRuntimeEventRow(event).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderRuntimeEventLogRepository.append:insert",
          "ProviderRuntimeEventLogRepository.append:decodeRow",
        ),
      ),
    );

  const readFromSequence: ProviderRuntimeEventLogRepositoryShape["readFromSequence"] = (
    sequenceExclusive,
    limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT,
  ) => {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) {
      return Stream.empty;
    }

    const readPage = (
      cursor: number,
      remaining: number,
    ): Stream.Stream<ProviderRuntimeEventLogEntry, ProviderRuntimeEventLogRepositoryError> =>
      Stream.fromEffect(
        readFromSequenceRows({
          sequenceExclusive: cursor,
          limit: Math.min(remaining, READ_PAGE_SIZE),
        }).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ProviderRuntimeEventLogRepository.readFromSequence:query",
              "ProviderRuntimeEventLogRepository.readFromSequence:decodeRows",
            ),
          ),
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              Effect.succeed({
                sequence: row.sequence,
                eventId: row.eventId,
                threadId: row.threadId,
                provider: row.provider,
                type: row.type,
                turnId: row.turnId,
                itemId: row.itemId,
                requestId: row.requestId,
                createdAt: row.createdAt,
                event: row.event,
              }),
            ),
          ),
        ),
      ).pipe(
        Stream.flatMap((rows) => {
          if (rows.length === 0) {
            return Stream.empty;
          }
          const nextRemaining = remaining - rows.length;
          if (nextRemaining <= 0) {
            return Stream.fromIterable(rows);
          }
          return Stream.concat(
            Stream.fromIterable(rows),
            readPage(rows[rows.length - 1]!.sequence, nextRemaining),
          );
        }),
      );

    return readPage(sequenceExclusive, normalizedLimit);
  };

  const readByThreadId: ProviderRuntimeEventLogRepositoryShape["readByThreadId"] = (
    threadId,
    limit = DEFAULT_READ_FROM_SEQUENCE_LIMIT,
  ) =>
    Stream.fromEffect(
      readByThreadIdRows({ threadId, limit: Math.max(0, Math.floor(limit)) }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProviderRuntimeEventLogRepository.readByThreadId:query",
            "ProviderRuntimeEventLogRepository.readByThreadId:decodeRows",
          ),
        ),
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              Effect.succeed({
                sequence: row.sequence,
                eventId: row.eventId,
                threadId: row.threadId,
                provider: row.provider,
                type: row.type,
                turnId: row.turnId,
                itemId: row.itemId,
                requestId: row.requestId,
                createdAt: row.createdAt,
                event: row.event,
              }),
            { concurrency: "unbounded" },
          ),
        ),
      ),
    ).pipe(Stream.flatMap((rows) => Stream.fromIterable(rows)));

  const readAll: ProviderRuntimeEventLogRepositoryShape["readAll"] = () => readFromSequence(0);

  return {
    append,
    readFromSequence,
    readByThreadId,
    readAll,
  } satisfies ProviderRuntimeEventLogRepositoryShape;
});

export const ProviderRuntimeEventLogRepositoryLive = Layer.effect(
  ProviderRuntimeEventLogRepository,
  makeProviderRuntimeEventLogRepository,
);
