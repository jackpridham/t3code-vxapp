import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  const existingNames = new Set(columns.map((c) => c.name));

  if (!existingNames.has("orchestrator_project_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN orchestrator_project_id TEXT
    `;
  }

  if (!existingNames.has("orchestrator_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN orchestrator_thread_id TEXT
    `;
  }

  if (!existingNames.has("parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN parent_thread_id TEXT
    `;
  }

  if (!existingNames.has("spawn_role")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN spawn_role TEXT
    `;
  }

  if (!existingNames.has("spawned_by")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN spawned_by TEXT
    `;
  }

  if (!existingNames.has("workflow_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN workflow_id TEXT
    `;
  }
});
