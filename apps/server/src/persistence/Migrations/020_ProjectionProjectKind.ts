import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect } from "effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE projection_projects
    SET kind = 'project'
    WHERE kind IS NULL OR TRIM(kind) = ''
  `;
});
