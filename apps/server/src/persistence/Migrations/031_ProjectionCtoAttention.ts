import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_cto_attention (
      attention_id TEXT PRIMARY KEY,
      attention_key TEXT NOT NULL,
      notification_id TEXT NOT NULL,
      program_id TEXT NOT NULL,
      executive_project_id TEXT NOT NULL,
      executive_thread_id TEXT NOT NULL,
      source_thread_id TEXT,
      source_role TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      state TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      dropped_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_cto_attention_attention_key
    ON projection_cto_attention(attention_key)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_cto_attention_program_state_updated
    ON projection_cto_attention(program_id, state, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_cto_attention_executive_thread_state_updated
    ON projection_cto_attention(executive_thread_id, state, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_cto_attention_notification_id
    ON projection_cto_attention(notification_id)
  `;
});
