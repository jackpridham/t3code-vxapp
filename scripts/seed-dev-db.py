#!/usr/bin/env python3
"""
Copy a trimmed subset of the live T3 production database into the dev database.

This replaces the old synthetic fixture with a schema-tolerant prod snapshot flow:

1. Copy `~/.t3/userdata/state.sqlite` to a temporary database using SQLite's
   backup API, which is safe for WAL-mode databases.
2. Keep a bounded set of the most recent threads per project.
3. Expand that set to include directly related lineage/wake/plan threads.
4. Delete all thread-scoped rows outside that retained thread set.
5. Clear live runtime/session state by default so the dev DB does not try to
   resume stale provider sessions from production.
6. Vacuum the result and atomically replace the dev database.

Usage:
    python3 scripts/seed-dev-db.py
    python3 scripts/seed-dev-db.py --threads-per-project 8
    python3 scripts/seed-dev-db.py --keep-runtime-state
    python3 scripts/seed-dev-db.py --dest-db /tmp/t3-dev-state.sqlite
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

DEFAULT_SOURCE_DB = Path.home() / ".t3" / "userdata" / "state.sqlite"
DEFAULT_DEST_DB = Path.home() / ".t3" / "dev" / "state.sqlite"
DEFAULT_THREADS_PER_PROJECT = 5
SQLITE_SIDE_CARS = ("-wal", "-shm")


@dataclass(frozen=True)
class SeedConfig:
    source_db: Path
    dest_db: Path
    threads_per_project: int
    keep_runtime_state: bool


def parse_args(argv: Sequence[str]) -> SeedConfig:
    parser = argparse.ArgumentParser(
        description="Copy a trimmed slice of the live T3 prod DB into the dev DB.",
    )
    parser.add_argument(
        "--source-db",
        type=Path,
        default=DEFAULT_SOURCE_DB,
        help=f"Source SQLite database path (default: {DEFAULT_SOURCE_DB})",
    )
    parser.add_argument(
        "--dest-db",
        type=Path,
        default=DEFAULT_DEST_DB,
        help=f"Destination SQLite database path (default: {DEFAULT_DEST_DB})",
    )
    parser.add_argument(
        "--threads-per-project",
        type=int,
        default=DEFAULT_THREADS_PER_PROJECT,
        help=f"Recent threads to keep per project (default: {DEFAULT_THREADS_PER_PROJECT})",
    )
    parser.add_argument(
        "--keep-runtime-state",
        action="store_true",
        help="Preserve projection_thread_sessions/provider_session_runtime rows instead of clearing them.",
    )
    args = parser.parse_args(argv)

    if args.threads_per_project <= 0:
        parser.error("--threads-per-project must be greater than zero")

    return SeedConfig(
        source_db=args.source_db.expanduser().resolve(),
        dest_db=args.dest_db.expanduser().resolve(),
        threads_per_project=args.threads_per_project,
        keep_runtime_state=args.keep_runtime_state,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def connect_db(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        return sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    return sqlite3.connect(path)


def remove_sidecars(path: Path) -> None:
    for suffix in SQLITE_SIDE_CARS:
        sidecar = Path(f"{path}{suffix}")
        if sidecar.exists():
            sidecar.unlink()


def format_mib(path: Path) -> str:
    if not path.exists():
        return "0.0 MiB"
    return f"{path.stat().st_size / (1024 * 1024):.1f} MiB"


def chunked(values: Iterable[str], size: int = 200) -> Iterable[list[str]]:
    chunk: list[str] = []
    for value in values:
        chunk.append(value)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def fetch_scalar_int(db: sqlite3.Connection, query: str, params: Sequence[object] = ()) -> int:
    row = db.execute(query, params).fetchone()
    return 0 if row is None or row[0] is None else int(row[0])


def collect_counts(db: sqlite3.Connection) -> dict[str, int]:
    return {
        "projects": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_projects"),
        "threads": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_threads"),
        "messages": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_thread_messages"),
        "activities": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_thread_activities"),
        "turns": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_turns"),
        "plans": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_thread_proposed_plans"),
        "wakes": fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_orchestrator_wakes"),
        "events": fetch_scalar_int(db, "SELECT COUNT(*) FROM orchestration_events"),
    }


def print_counts(label: str, counts: dict[str, int]) -> None:
    ordered = ", ".join(f"{key}={value}" for key, value in counts.items())
    print(f"{label}: {ordered}")


def collect_all_project_ids(db: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in db.execute(
            "SELECT project_id FROM projection_projects ORDER BY created_at ASC, project_id ASC",
        )
    }


def collect_base_thread_ids(db: sqlite3.Connection, threads_per_project: int) -> set[str]:
    project_ids = sorted(collect_all_project_ids(db))
    thread_ids: set[str] = set()
    for project_id in project_ids:
        rows = db.execute(
            """
            SELECT thread_id
            FROM projection_threads
            WHERE project_id = ?
            ORDER BY updated_at DESC, created_at DESC, thread_id DESC
            LIMIT ?
            """,
            (project_id, threads_per_project),
        )
        thread_ids.update(row[0] for row in rows)
    return thread_ids


def filter_existing_thread_ids(db: sqlite3.Connection, thread_ids: Iterable[str]) -> set[str]:
    existing: set[str] = set()
    for chunk in chunked(sorted(set(thread_ids))):
        placeholders = ",".join("?" for _ in chunk)
        query = f"SELECT thread_id FROM projection_threads WHERE thread_id IN ({placeholders})"
        existing.update(row[0] for row in db.execute(query, chunk))
    return existing


def collect_related_thread_ids(db: sqlite3.Connection, thread_ids: set[str]) -> set[str]:
    related: set[str] = set()
    if not thread_ids:
        return related

    for chunk in chunked(sorted(thread_ids)):
        placeholders = ",".join("?" for _ in chunk)

        query = f"""
            SELECT orchestrator_thread_id, parent_thread_id
            FROM projection_threads
            WHERE thread_id IN ({placeholders})
        """
        for row in db.execute(query, chunk):
            for value in row:
                if value:
                    related.add(value)

        query = f"""
            SELECT implementation_thread_id
            FROM projection_thread_proposed_plans
            WHERE thread_id IN ({placeholders})
              AND implementation_thread_id IS NOT NULL
        """
        related.update(row[0] for row in db.execute(query, chunk))

        query = f"""
            SELECT source_proposed_plan_thread_id
            FROM projection_turns
            WHERE thread_id IN ({placeholders})
              AND source_proposed_plan_thread_id IS NOT NULL
        """
        related.update(row[0] for row in db.execute(query, chunk))

        pair_placeholders = ",".join("?" for _ in chunk)
        query = f"""
            SELECT orchestrator_thread_id, worker_thread_id
            FROM projection_orchestrator_wakes
            WHERE orchestrator_thread_id IN ({placeholders})
               OR worker_thread_id IN ({pair_placeholders})
        """
        for row in db.execute(query, [*chunk, *chunk]):
            for value in row:
                if value:
                    related.add(value)

    return related


def expand_thread_closure(db: sqlite3.Connection, seed_thread_ids: set[str]) -> set[str]:
    kept = filter_existing_thread_ids(db, seed_thread_ids)
    while True:
        related = filter_existing_thread_ids(db, collect_related_thread_ids(db, kept))
        new_ids = related - kept
        if not new_ids:
            return kept
        kept.update(new_ids)


def stage_keep_table(db: sqlite3.Connection, name: str, column: str, values: Iterable[str]) -> None:
    db.execute(f"DROP TABLE IF EXISTS temp.{name}")
    db.execute(f"CREATE TEMP TABLE {name} ({column} TEXT PRIMARY KEY)")
    db.executemany(
        f"INSERT INTO temp.{name} ({column}) VALUES (?)",
        ((value,) for value in sorted(set(values))),
    )


def trim_destination_db(db: sqlite3.Connection, keep_project_ids: set[str], keep_thread_ids: set[str], *,
                        keep_runtime_state: bool) -> None:
    stage_keep_table(db, "keep_projects", "project_id", keep_project_ids)
    stage_keep_table(db, "keep_threads", "thread_id", keep_thread_ids)

    db.execute(
        """
        DELETE FROM projection_orchestrator_wakes
        WHERE orchestrator_thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
           OR worker_thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_thread_proposed_plans
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_turns
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_thread_activities
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_thread_messages
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM checkpoint_diff_blobs
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_threads
        WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM projection_projects
        WHERE project_id NOT IN (SELECT project_id FROM temp.keep_projects)
        """,
    )

    if keep_runtime_state:
        db.execute(
            """
            DELETE FROM projection_thread_sessions
            WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
            """,
        )
        db.execute(
            """
            DELETE FROM provider_session_runtime
            WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
            """,
        )
        db.execute(
            """
            DELETE FROM projection_pending_approvals
            WHERE thread_id NOT IN (SELECT thread_id FROM temp.keep_threads)
            """,
        )
    else:
        db.execute("DELETE FROM projection_thread_sessions")
        db.execute("DELETE FROM provider_session_runtime")
        db.execute("DELETE FROM projection_pending_approvals")

    db.execute(
        """
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'thread'
          AND stream_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM orchestration_events
        WHERE aggregate_kind = 'project'
          AND stream_id NOT IN (SELECT project_id FROM temp.keep_projects)
        """,
    )
    db.execute(
        """
        DELETE FROM orchestration_command_receipts
        WHERE aggregate_kind = 'thread'
          AND aggregate_id NOT IN (SELECT thread_id FROM temp.keep_threads)
        """,
    )
    db.execute(
        """
        DELETE FROM orchestration_command_receipts
        WHERE aggregate_kind = 'project'
          AND aggregate_id NOT IN (SELECT project_id FROM temp.keep_projects)
        """,
    )
    db.execute(
        """
        DELETE FROM orchestration_command_receipts
        WHERE result_sequence NOT IN (SELECT sequence FROM orchestration_events)
        """,
    )

    max_sequence = fetch_scalar_int(db, "SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events")
    projection_state_count = fetch_scalar_int(
        db,
        "SELECT COUNT(*) FROM projection_state",
    )
    if projection_state_count > 0:
        db.execute(
            """
            UPDATE projection_state
            SET last_applied_sequence = ?, updated_at = ?
            """,
            (max_sequence, utc_now_iso()),
        )


def validate_source_db(config: SeedConfig) -> None:
    if not config.source_db.exists():
        raise FileNotFoundError(f"Source DB does not exist: {config.source_db}")
    if config.source_db == config.dest_db:
        raise ValueError("--source-db and --dest-db must be different paths")


def backup_prod_db(source_db: Path, temp_db: Path) -> None:
    source = connect_db(source_db, readonly=True)
    destination = connect_db(temp_db)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()


def atomically_replace_destination(temp_db_conn: sqlite3.Connection, temp_db: Path, dest_db: Path) -> None:
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    staged_dest = dest_db.with_suffix(f"{dest_db.suffix}.staged")
    if staged_dest.exists():
        staged_dest.unlink()
    remove_sidecars(staged_dest)

    destination = connect_db(staged_dest)
    try:
        temp_db_conn.backup(destination)
    finally:
        destination.close()

    remove_sidecars(dest_db)
    os.replace(staged_dest, dest_db)
    remove_sidecars(staged_dest)
    if temp_db.exists():
        temp_db.unlink()
    remove_sidecars(temp_db)


def seed_dev_db(config: SeedConfig) -> None:
    validate_source_db(config)
    config.dest_db.parent.mkdir(parents=True, exist_ok=True)

    temp_db = config.dest_db.with_suffix(f"{config.dest_db.suffix}.tmp")
    if temp_db.exists():
        temp_db.unlink()
    remove_sidecars(temp_db)

    print(f"Backing up {config.source_db} -> {temp_db}")
    backup_prod_db(config.source_db, temp_db)

    db = connect_db(temp_db)
    try:
        before_counts = collect_counts(db)
        keep_project_ids = collect_all_project_ids(db)
        base_thread_ids = collect_base_thread_ids(db, config.threads_per_project)
        keep_thread_ids = expand_thread_closure(db, base_thread_ids)

        print_counts("Before trim", before_counts)
        print(
            "Keeping "
            f"{len(keep_project_ids)} projects and {len(keep_thread_ids)} threads "
            f"({len(base_thread_ids)} directly selected, {len(keep_thread_ids) - len(base_thread_ids)} related)",
        )

        trim_destination_db(
            db,
            keep_project_ids,
            keep_thread_ids,
            keep_runtime_state=config.keep_runtime_state,
        )
        db.commit()

        print("Running VACUUM")
        db.execute("VACUUM")
        after_counts = collect_counts(db)
        print_counts("After trim", after_counts)

        atomically_replace_destination(db, temp_db, config.dest_db)
    finally:
        db.close()

    print(f"Seeded dev DB: {config.dest_db} ({format_mib(config.dest_db)})")
    if config.keep_runtime_state:
        print("Preserved provider runtime/session state")
    else:
        print("Cleared provider runtime/session state")


def main(argv: Sequence[str]) -> int:
    try:
        config = parse_args(argv)
        seed_dev_db(config)
        return 0
    except (FileNotFoundError, PermissionError, ValueError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
