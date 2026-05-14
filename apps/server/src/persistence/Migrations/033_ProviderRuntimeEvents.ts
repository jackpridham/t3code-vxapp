import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_runtime_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      turn_id TEXT,
      item_id TEXT,
      request_id TEXT,
      created_at TEXT NOT NULL,
      event_json TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_runtime_events_event_id
    ON provider_runtime_events(event_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_events_thread_sequence
    ON provider_runtime_events(thread_id, sequence)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_events_provider_sequence
    ON provider_runtime_events(provider_name, sequence)
  `;
});
