import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_orchestrator_wakes (
      wake_id TEXT PRIMARY KEY,
      orchestrator_thread_id TEXT NOT NULL,
      orchestrator_project_id TEXT NOT NULL,
      worker_thread_id TEXT NOT NULL,
      worker_project_id TEXT NOT NULL,
      worker_turn_id TEXT NOT NULL,
      workflow_id TEXT,
      worker_title_snapshot TEXT NOT NULL,
      outcome TEXT NOT NULL,
      summary TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      state TEXT NOT NULL,
      delivery_message_id TEXT,
      delivered_at TEXT,
      consumed_at TEXT,
      consume_reason TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_wakes_thread_state_queued
    ON projection_orchestrator_wakes(orchestrator_thread_id, state, queued_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_wakes_worker_state_queued
    ON projection_orchestrator_wakes(worker_thread_id, state, queued_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_orchestrator_wakes_worker_turn_outcome
    ON projection_orchestrator_wakes(worker_thread_id, worker_turn_id, outcome)
  `;
});
