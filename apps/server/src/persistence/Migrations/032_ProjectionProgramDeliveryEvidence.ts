import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const programColumns = yield* sql<{ name: string }>`
    PRAGMA table_info(projection_programs)
  `;
  const existingProgramColumnNames = new Set(programColumns.map((column) => column.name));

  if (!existingProgramColumnNames.has("declared_repos_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN declared_repos_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("affected_app_targets_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN affected_app_targets_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("required_local_suites_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN required_local_suites_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("required_external_e2e_suites_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN required_external_e2e_suites_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("require_development_deploy")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN require_development_deploy INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!existingProgramColumnNames.has("require_external_e2e")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN require_external_e2e INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!existingProgramColumnNames.has("require_clean_post_flight")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN require_clean_post_flight INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!existingProgramColumnNames.has("require_pr_per_repo")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN require_pr_per_repo INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!existingProgramColumnNames.has("repo_prs_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN repo_prs_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("local_validation_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN local_validation_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("app_validations_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN app_validations_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("observed_repos_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN observed_repos_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  if (!existingProgramColumnNames.has("post_flight_json")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN post_flight_json TEXT
    `;
  }

  if (!existingProgramColumnNames.has("cancel_reason")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN cancel_reason TEXT
    `;
  }

  if (!existingProgramColumnNames.has("cancelled_at")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN cancelled_at TEXT
    `;
  }

  if (!existingProgramColumnNames.has("superseded_by_program_id")) {
    yield* sql`
      ALTER TABLE projection_programs
      ADD COLUMN superseded_by_program_id TEXT
    `;
  }
});
