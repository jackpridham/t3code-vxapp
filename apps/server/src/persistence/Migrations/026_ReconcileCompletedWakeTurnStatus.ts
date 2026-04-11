import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_turns
    SET state = 'completed'
    WHERE state = 'interrupted'
      AND checkpoint_status = 'ready'
      AND EXISTS (
        SELECT 1
        FROM projection_orchestrator_wakes wakes
        WHERE wakes.worker_thread_id = projection_turns.thread_id
          AND wakes.worker_turn_id = projection_turns.turn_id
          AND wakes.outcome = 'completed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM orchestration_events events
        WHERE events.event_type = 'thread.turn-interrupt-requested'
          AND json_extract(events.payload_json, '$.threadId') = projection_turns.thread_id
          AND (
            json_extract(events.payload_json, '$.turnId') IS NULL
            OR json_extract(events.payload_json, '$.turnId') = projection_turns.turn_id
          )
      )
  `;
});
