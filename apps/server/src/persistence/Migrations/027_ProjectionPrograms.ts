import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const threadColumns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const existingThreadColumnNames = new Set(threadColumns.map((column) => column.name));

  if (!existingThreadColumnNames.has("program_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN program_id TEXT
    `;
  }

  if (!existingThreadColumnNames.has("executive_project_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN executive_project_id TEXT
    `;
  }

  if (!existingThreadColumnNames.has("executive_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN executive_thread_id TEXT
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_programs (
      program_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT,
      status TEXT NOT NULL,
      executive_project_id TEXT NOT NULL,
      executive_thread_id TEXT NOT NULL,
      current_orchestrator_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_programs_status_updated
    ON projection_programs(status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_programs_executive_thread
    ON projection_programs(executive_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_programs_orchestrator_thread
    ON projection_programs(current_orchestrator_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_program_id
    ON projection_threads(program_id)
  `;
});
