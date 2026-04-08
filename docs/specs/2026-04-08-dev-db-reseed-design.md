# Dev DB Reseed Design

## Goal

Replace the old synthetic `scripts/seed-dev-db.py` fixture with a script that copies a representative subset of the live T3 production SQLite state into the dev database using the current schema.

## Chosen Approach

Use SQLite's backup API to copy `~/.t3/userdata/state.sqlite` into a temporary dev database, then trim that copy down to a bounded set of recent threads per project.

This keeps the retained thread streams internally consistent because the script preserves complete event/projection history for each retained thread instead of chopping individual streams mid-history.

## Retention Rules

- Keep all project rows and project events.
- Keep the `N` most recently updated threads per project.
- Expand that thread set to include directly related lineage/wake/plan threads.
- Delete thread-scoped rows outside the retained thread set.
- Vacuum the result and atomically replace the destination DB.

## Runtime State

By default, clear `projection_thread_sessions`, `provider_session_runtime`, and `projection_pending_approvals` so the dev DB does not inherit stale live session state from production.

An opt-in `--keep-runtime-state` flag preserves those rows when needed for targeted debugging.
