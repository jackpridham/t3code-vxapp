import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    DROP TABLE IF EXISTS projection_program_notifications
  `;

  yield* sql`
    DROP TABLE IF EXISTS projection_cto_attention
  `;

  yield* sql`
    DROP TABLE IF EXISTS projection_programs
  `;
});
