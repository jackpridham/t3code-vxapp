import { EventId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { ProviderRuntimeEventLogRepository } from "../Services/ProviderRuntimeEventLog.ts";
import { ProviderRuntimeEventLogRepositoryLive } from "./ProviderRuntimeEventLog.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProviderRuntimeEventLogRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProviderRuntimeEventLogRepository", (it) => {
  it.effect("stores json columns as strings and replays decoded runtime events", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderRuntimeEventLogRepository;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appended = yield* repository.append({
        type: "turn.started",
        eventId: EventId.makeUnsafe("evt-runtime-log-1"),
        provider: "codex",
        threadId: ThreadId.makeUnsafe("thread-runtime-log"),
        turnId: TurnId.makeUnsafe("turn-runtime-log"),
        createdAt: now,
        payload: {
          model: "gpt-5-codex",
        },
      });

      const storedRows = yield* sql<{ readonly eventJson: string }>`
        SELECT event_json AS "eventJson"
        FROM provider_runtime_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.eventJson, "string");

      const replayed = yield* Stream.runCollect(repository.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "turn.started");
      assert.equal(replayed[0]?.event.type, "turn.started");
      if (replayed[0]?.event.type === "turn.started") {
        assert.equal(replayed[0].event.payload.model, "gpt-5-codex");
      }
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderRuntimeEventLogRepository;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* sql`
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
          ${EventId.makeUnsafe("evt-runtime-log-invalid")},
          ${ThreadId.makeUnsafe("thread-runtime-log-invalid")},
          ${"codex"},
          ${"turn.started"},
          ${TurnId.makeUnsafe("turn-runtime-log-invalid")},
          ${null},
          ${null},
          ${now},
          ${"{"}
        )
      `;

      const replayResult = yield* Effect.result(Stream.runCollect(repository.readAll()));
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(Schema.is(PersistenceDecodeError)(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "ProviderRuntimeEventLogRepository.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );
});
