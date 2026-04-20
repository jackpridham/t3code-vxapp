import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_archived_thread
    ON projection_threads(archived_at, thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_thread_created_id
    ON projection_thread_messages(thread_id, created_at, message_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_proposed_plans_thread_created_id
    ON projection_thread_proposed_plans(thread_id, created_at, plan_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_sequence_created_id
    ON projection_thread_activities(thread_id, sequence, created_at, activity_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_checkpoint_turn
    ON projection_turns(thread_id, checkpoint_turn_count, turn_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_wakes_queued_id
    ON projection_orchestrator_wakes(queued_at, wake_id)
  `;
});
