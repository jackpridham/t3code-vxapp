import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS runtime_ttl_cache (
      cache_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      refreshed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_runtime_ttl_cache_expires_at
    ON runtime_ttl_cache(expires_at)
  `;
});
