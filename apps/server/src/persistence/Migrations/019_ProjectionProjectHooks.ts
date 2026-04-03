import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect } from "effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN hooks_json TEXT NOT NULL DEFAULT '[]'
  `.pipe(Effect.catch(() => Effect.void));
});
