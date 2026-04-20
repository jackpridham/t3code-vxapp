import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_program_notifications (
      notification_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      executive_project_id TEXT NOT NULL,
      executive_thread_id TEXT NOT NULL,
      orchestrator_thread_id TEXT,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      state TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      delivered_at TEXT,
      consumed_at TEXT,
      dropped_at TEXT,
      consume_reason TEXT,
      drop_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_program_notifications_program_state
    ON projection_program_notifications(program_id, state, queued_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_program_notifications_executive_thread
    ON projection_program_notifications(executive_thread_id, state, queued_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_program_notifications_orchestrator_thread
    ON projection_program_notifications(orchestrator_thread_id, state, queued_at)
  `;
});
