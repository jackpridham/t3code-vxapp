#!/usr/bin/env python3
"""
Copy a bounded prod snapshot into the T3 dev database.

This script mirrors a trimmed subset of the live T3 production SQLite state
into the dev database, while biasing retention toward the current
`agents-vxapp` control-plane graph so the orchestration sidebar and ChatView
stay navigable together.

Source authorities:

1. ~/.t3/userdata/state.sqlite
   The navigable T3 projection/event store used by the dev web/server.
2. ~/agents-vxapp/.agents/state/vx_agents.sqlite3
   The agents-vxapp control-plane DB that carries current program/thread
   linkage, executive bindings, wakes, and current session bindings.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

DEFAULT_SOURCE_DB = Path.home() / ".t3" / "userdata" / "state.sqlite"
DEFAULT_DEST_DB = Path.home() / ".t3" / "dev" / "state.sqlite"
DEFAULT_AGENTS_DB = Path.home() / "agents-vxapp" / ".agents" / "state" / "vx_agents.sqlite3"
DEFAULT_THREADS_PER_PROJECT = 5
SQLITE_SIDE_CARS = ("-wal", "-shm")


@dataclass(frozen=True)
class SeedConfig:
    source_db: Path
    dest_db: Path
    agents_db: Path
    threads_per_project: int
    keep_runtime_state: bool
    dry_run: bool
    json_output: bool
    include_program_ids: tuple[str, ...]
    include_thread_ids: tuple[str, ...]


@dataclass(frozen=True)
class AgentsRetentionTargets:
    critical_program_ids: frozenset[str]
    critical_project_ids: frozenset[str]
    critical_thread_ids: frozenset[str]
    preferred_thread_ids: frozenset[str]
    preferred_workspace_roots: frozenset[str]
    source_timestamps: dict[str, str | None]


@dataclass(frozen=True)
class RetentionSummary:
    before_counts: dict[str, int]
    after_counts: dict[str, int]
    keep_project_count: int
    keep_thread_count: int
    recent_thread_count: int
    source_reference_thread_count: int
    critical_agents_thread_count: int
    preferred_agents_thread_count: int
    related_thread_count: int
    missing_critical_project_ids: tuple[str, ...]
    missing_critical_program_ids: tuple[str, ...]
    missing_critical_thread_ids: tuple[str, ...]
    missing_preferred_thread_ids: tuple[str, ...]
    source_db: str
    dest_db: str
    agents_db: str
    dry_run: bool
    keep_runtime_state: bool
    agents_source_timestamps: dict[str, str | None]


def parse_args(argv: Sequence[str]) -> SeedConfig:
    parser = argparse.ArgumentParser(
        description="Copy a bounded slice of the live T3 prod DB into the dev DB.",
    )
    parser.add_argument(
        "--source-db",
        type=Path,
        default=DEFAULT_SOURCE_DB,
        help=f"Source T3 SQLite database path (default: {DEFAULT_SOURCE_DB})",
    )
    parser.add_argument(
        "--dest-db",
        type=Path,
        default=DEFAULT_DEST_DB,
        help=f"Destination dev SQLite database path (default: {DEFAULT_DEST_DB})",
    )
    parser.add_argument(
        "--agents-db",
        type=Path,
        default=DEFAULT_AGENTS_DB,
        help=f"agents-vxapp control-plane SQLite path (default: {DEFAULT_AGENTS_DB})",
    )
    parser.add_argument(
        "--threads-per-project",
        type=int,
        default=DEFAULT_THREADS_PER_PROJECT,
        help=f"Recent threads to retain per project (default: {DEFAULT_THREADS_PER_PROJECT})",
    )
    parser.add_argument(
        "--include-program",
        action="append",
        dest="include_program_ids",
        default=[],
        help="Explicit program id to retain from agents-vxapp control-plane state.",
    )
    parser.add_argument(
        "--include-thread",
        action="append",
        dest="include_thread_ids",
        default=[],
        help="Explicit thread id to retain in the mirrored dev DB.",
    )
    parser.add_argument(
        "--keep-runtime-state",
        action="store_true",
        help="Preserve projection_thread_sessions/provider_session_runtime rows instead of clearing them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate the trimmed mirror without replacing the destination DB.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Emit machine-readable JSON summary.",
    )
    args = parser.parse_args(argv)

    if args.threads_per_project <= 0:
        parser.error("--threads-per-project must be greater than zero")

    return SeedConfig(
        source_db=args.source_db.expanduser().resolve(),
        dest_db=args.dest_db.expanduser().resolve(),
        agents_db=args.agents_db.expanduser().resolve(),
        threads_per_project=args.threads_per_project,
        keep_runtime_state=args.keep_runtime_state,
        dry_run=args.dry_run,
        json_output=args.json_output,
        include_program_ids=tuple(
            value.strip() for value in args.include_program_ids if value and value.strip()
        ),
        include_thread_ids=tuple(
            value.strip() for value in args.include_thread_ids if value and value.strip()
        ),
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


def fetch_scalar_text_or_none(
    db: sqlite3.Connection, query: str, params: Sequence[object] = ()
) -> str | None:
    row = db.execute(query, params).fetchone()
    if row is None or row[0] is None:
        return None
    return str(row[0])


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
            "SELECT project_id FROM projection_projects ORDER BY created_at ASC, project_id ASC"
        )
    }


def filter_existing_thread_ids(db: sqlite3.Connection, thread_ids: Iterable[str]) -> set[str]:
    existing: set[str] = set()
    for chunk in chunked(sorted(set(thread_ids))):
        placeholders = ",".join("?" for _ in chunk)
        query = f"SELECT thread_id FROM projection_threads WHERE thread_id IN ({placeholders})"
        existing.update(row[0] for row in db.execute(query, chunk))
    return existing


def filter_existing_program_ids(db: sqlite3.Connection, program_ids: Iterable[str]) -> set[str]:
    existing: set[str] = set()
    for chunk in chunked(sorted(set(program_ids))):
        placeholders = ",".join("?" for _ in chunk)
        query = f"SELECT program_id FROM projection_programs WHERE program_id IN ({placeholders})"
        existing.update(row[0] for row in db.execute(query, chunk))
    return existing


def filter_existing_project_ids(db: sqlite3.Connection, project_ids: Iterable[str]) -> set[str]:
    existing: set[str] = set()
    for chunk in chunked(sorted(set(project_ids))):
        placeholders = ",".join("?" for _ in chunk)
        query = f"SELECT project_id FROM projection_projects WHERE project_id IN ({placeholders})"
        existing.update(row[0] for row in db.execute(query, chunk))
    return existing


def add_thread_id(value: Any, target: set[str]) -> None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            target.add(trimmed)


def add_project_id(value: Any, target: set[str]) -> None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            target.add(trimmed)


def add_program_id(value: Any, target: set[str]) -> None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            target.add(trimmed)


def is_persisted_t3_thread_id(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    trimmed = value.strip()
    if not trimmed:
        return False
    try:
        uuid.UUID(trimmed)
    except ValueError:
        return False
    return True


def add_json_thread_id(payload_json: Any, key: str, target: set[str]) -> None:
    if not isinstance(payload_json, str) or not payload_json.strip():
        return
    try:
        payload = json.loads(payload_json)
    except json.JSONDecodeError:
        return
    if isinstance(payload, dict):
        add_thread_id(payload.get(key), target)


def collect_agents_retention_targets(config: SeedConfig) -> AgentsRetentionTargets:
    if not config.agents_db.exists():
        return AgentsRetentionTargets(
            critical_program_ids=frozenset(config.include_program_ids),
            critical_project_ids=frozenset(),
            critical_thread_ids=frozenset(config.include_thread_ids),
            preferred_thread_ids=frozenset(config.include_thread_ids),
            preferred_workspace_roots=frozenset(),
            source_timestamps={"programs_updated_at": None, "thread_links_updated_at": None},
        )

    critical_program_ids: set[str] = set(config.include_program_ids)
    critical_project_ids: set[str] = set()
    critical_thread_ids: set[str] = set(config.include_thread_ids)
    preferred_thread_ids: set[str] = set(config.include_thread_ids)
    preferred_workspace_roots: set[str] = set()

    db = connect_db(config.agents_db, readonly=True)
    try:
        for row in db.execute(
            """
            SELECT program_id, executive_project_id, executive_thread_id, current_orchestrator_thread_id
            FROM t3_programs
            WHERE deleted_at IS NULL
            """
        ):
            add_thread_id(row[2], critical_thread_ids)
            add_thread_id(row[3], critical_thread_ids)
            add_project_id(row[1], critical_project_ids)
            add_thread_id(row[2], preferred_thread_ids)
            add_thread_id(row[3], preferred_thread_ids)
            add_project_id(row[1], critical_project_ids)
            add_program_id(row[0], critical_program_ids)

        for row in db.execute(
            """
            SELECT thread_id, project_id, workspace_root, worktree_path, parent_thread_id,
                   program_id, executive_project_id, executive_thread_id, orchestrator_thread_id
            FROM t3_thread_links
            WHERE deleted_at IS NULL
            """
        ):
            add_thread_id(row[0], preferred_thread_ids)
            add_thread_id(row[4], preferred_thread_ids)
            add_thread_id(row[7], preferred_thread_ids)
            add_thread_id(row[8], preferred_thread_ids)
            add_project_id(row[1], critical_project_ids)
            add_project_id(row[6], critical_project_ids)
            if row[8] is not None:
                add_thread_id(row[0], critical_thread_ids)
            if isinstance(row[2], str) and row[2].strip():
                preferred_workspace_roots.add(row[2].strip())
            if isinstance(row[3], str) and row[3].strip():
                preferred_workspace_roots.add(row[3].strip())

        for row in db.execute(
            """
            SELECT orchestrator_thread_id, payload_json
            FROM t3_wake_items
            WHERE settled_at IS NULL
            """
        ):
            add_thread_id(row[0], critical_thread_ids)
            add_thread_id(row[0], preferred_thread_ids)
            add_json_thread_id(row[1], "workerThreadId", critical_thread_ids)
            add_json_thread_id(row[1], "workerThreadId", preferred_thread_ids)

        for row in db.execute(
            """
            SELECT current_thread_id, program_id, executive_project_id, executive_thread_id,
                   orchestrator_thread_id, cto_thread_id, workspace_root
            FROM agents_session_bindings
            WHERE status = 'active'
            """
        ):
            for value in (row[0], row[3], row[4], row[5]):
                if not is_persisted_t3_thread_id(value):
                    continue
                add_thread_id(value, critical_thread_ids)
                add_thread_id(value, preferred_thread_ids)
            add_program_id(row[1], critical_program_ids)
            add_project_id(row[2], critical_project_ids)
            if isinstance(row[6], str) and row[6].strip():
                preferred_workspace_roots.add(row[6].strip())

        return AgentsRetentionTargets(
            critical_program_ids=frozenset(critical_program_ids),
            critical_project_ids=frozenset(critical_project_ids),
            critical_thread_ids=frozenset(critical_thread_ids),
            preferred_thread_ids=frozenset(preferred_thread_ids),
            preferred_workspace_roots=frozenset(preferred_workspace_roots),
            source_timestamps={
                "programs_updated_at": fetch_scalar_text_or_none(
                    db, "SELECT MAX(updated_at) FROM t3_programs"
                ),
                "thread_links_updated_at": fetch_scalar_text_or_none(
                    db, "SELECT MAX(updated_at) FROM t3_thread_links"
                ),
            },
        )
    finally:
        db.close()


def collect_recent_thread_ids(db: sqlite3.Connection, threads_per_project: int) -> set[str]:
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


def collect_source_reference_thread_ids(db: sqlite3.Connection) -> set[str]:
    thread_ids: set[str] = set()

    for row in db.execute(
        "SELECT current_session_root_thread_id FROM projection_projects WHERE current_session_root_thread_id IS NOT NULL"
    ):
        add_thread_id(row[0], thread_ids)

    for row in db.execute(
        """
        SELECT executive_thread_id, current_orchestrator_thread_id
        FROM projection_programs
        WHERE deleted_at IS NULL
        """
    ):
        add_thread_id(row[0], thread_ids)
        add_thread_id(row[1], thread_ids)

    for row in db.execute(
        """
        SELECT executive_thread_id, orchestrator_thread_id
        FROM projection_program_notifications
        """
    ):
        add_thread_id(row[0], thread_ids)
        add_thread_id(row[1], thread_ids)

    for row in db.execute(
        """
        SELECT executive_thread_id, source_thread_id
        FROM projection_cto_attention
        """
    ):
        add_thread_id(row[0], thread_ids)
        add_thread_id(row[1], thread_ids)

    return thread_ids


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
                add_thread_id(value, related)

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
                add_thread_id(value, related)

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


def trim_destination_db(
    db: sqlite3.Connection,
    keep_project_ids: set[str],
    keep_thread_ids: set[str],
    *,
    keep_runtime_state: bool,
) -> None:
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
    projection_state_count = fetch_scalar_int(db, "SELECT COUNT(*) FROM projection_state")
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


def validate_agents_alignment(
    db: sqlite3.Connection, agents_targets: AgentsRetentionTargets
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    existing_projects = filter_existing_project_ids(db, agents_targets.critical_project_ids)
    existing_programs = filter_existing_program_ids(db, agents_targets.critical_program_ids)
    existing_critical_threads = filter_existing_thread_ids(db, agents_targets.critical_thread_ids)
    existing_preferred_threads = filter_existing_thread_ids(db, agents_targets.preferred_thread_ids)

    missing_critical_project_ids = tuple(
        sorted(agents_targets.critical_project_ids - existing_projects)
    )
    missing_critical_program_ids = tuple(
        sorted(agents_targets.critical_program_ids - existing_programs)
    )
    missing_critical_thread_ids = tuple(
        sorted(agents_targets.critical_thread_ids - existing_critical_threads)
    )
    missing_preferred_thread_ids = tuple(
        sorted(agents_targets.preferred_thread_ids - existing_preferred_threads)
    )

    return (
        missing_critical_project_ids,
        missing_critical_program_ids,
        missing_critical_thread_ids,
        missing_preferred_thread_ids,
    )


def build_retention_summary(
    *,
    config: SeedConfig,
    before_counts: dict[str, int],
    after_counts: dict[str, int],
    keep_project_ids: set[str],
    keep_thread_ids: set[str],
    recent_thread_ids: set[str],
    source_reference_thread_ids: set[str],
    agents_targets: AgentsRetentionTargets,
    missing_critical_project_ids: tuple[str, ...],
    missing_critical_program_ids: tuple[str, ...],
    missing_critical_thread_ids: tuple[str, ...],
    missing_preferred_thread_ids: tuple[str, ...],
    related_thread_count: int,
) -> RetentionSummary:
    return RetentionSummary(
        before_counts=before_counts,
        after_counts=after_counts,
        keep_project_count=len(keep_project_ids),
        keep_thread_count=len(keep_thread_ids),
        recent_thread_count=len(recent_thread_ids),
        source_reference_thread_count=len(source_reference_thread_ids),
        critical_agents_thread_count=len(agents_targets.critical_thread_ids),
        preferred_agents_thread_count=len(agents_targets.preferred_thread_ids),
        related_thread_count=related_thread_count,
        missing_critical_project_ids=missing_critical_project_ids,
        missing_critical_program_ids=missing_critical_program_ids,
        missing_critical_thread_ids=missing_critical_thread_ids,
        missing_preferred_thread_ids=missing_preferred_thread_ids,
        source_db=str(config.source_db),
        dest_db=str(config.dest_db),
        agents_db=str(config.agents_db),
        dry_run=config.dry_run,
        keep_runtime_state=config.keep_runtime_state,
        agents_source_timestamps=agents_targets.source_timestamps,
    )


def seed_dev_db(config: SeedConfig) -> RetentionSummary:
    validate_source_db(config)
    config.dest_db.parent.mkdir(parents=True, exist_ok=True)

    agents_targets = collect_agents_retention_targets(config)

    temp_db = config.dest_db.with_suffix(f"{config.dest_db.suffix}.tmp")
    if temp_db.exists():
        temp_db.unlink()
    remove_sidecars(temp_db)

    if not config.json_output:
        print(f"Backing up {config.source_db} -> {temp_db}")
    backup_prod_db(config.source_db, temp_db)

    db = connect_db(temp_db)
    try:
        before_counts = collect_counts(db)
        keep_project_ids = collect_all_project_ids(db)
        recent_thread_ids = collect_recent_thread_ids(db, config.threads_per_project)
        source_reference_thread_ids = collect_source_reference_thread_ids(db)
        seed_thread_ids = (
            recent_thread_ids
            | source_reference_thread_ids
            | set(agents_targets.critical_thread_ids)
            | set(agents_targets.preferred_thread_ids)
            | set(config.include_thread_ids)
        )
        keep_thread_ids = expand_thread_closure(db, seed_thread_ids)

        if not config.json_output:
            print_counts("Before trim", before_counts)
            print(
                "Keeping "
                f"{len(keep_project_ids)} projects and {len(keep_thread_ids)} threads "
                f"({len(recent_thread_ids)} recent, "
                f"{len(source_reference_thread_ids)} source-linked, "
                f"{len(agents_targets.critical_thread_ids)} agents-critical, "
                f"{len(agents_targets.preferred_thread_ids)} agents-preferred)",
            )

        trim_destination_db(
            db,
            keep_project_ids,
            keep_thread_ids,
            keep_runtime_state=config.keep_runtime_state,
        )
        db.commit()

        (
            missing_critical_project_ids,
            missing_critical_program_ids,
            missing_critical_thread_ids,
            missing_preferred_thread_ids,
        ) = validate_agents_alignment(db, agents_targets)

        related_thread_count = max(
            len(keep_thread_ids)
            - len(
                filter_existing_thread_ids(
                    db,
                    recent_thread_ids
                    | source_reference_thread_ids
                    | set(agents_targets.critical_thread_ids)
                    | set(agents_targets.preferred_thread_ids),
                )
            ),
            0,
        )

        if missing_critical_project_ids or missing_critical_program_ids or missing_critical_thread_ids:
            raise ValueError(
                "Dev DB mirror is incomplete for current agents-vxapp control-plane state: "
                f"missing projects={list(missing_critical_project_ids)}, "
                f"missing programs={list(missing_critical_program_ids)}, "
                f"missing threads={list(missing_critical_thread_ids)}"
            )

        after_counts = collect_counts(db)
        if config.dry_run:
            if not config.json_output:
                print("Dry run: skipping VACUUM")
        else:
            if not config.json_output:
                print("Running VACUUM")
            db.execute("VACUUM")
            after_counts = collect_counts(db)
        if not config.json_output:
            print_counts("After trim", after_counts)

        if not config.dry_run:
            atomically_replace_destination(db, temp_db, config.dest_db)
    finally:
        db.close()
        if temp_db.exists():
            temp_db.unlink()
        remove_sidecars(temp_db)

    summary = build_retention_summary(
        config=config,
        before_counts=before_counts,
        after_counts=after_counts,
        keep_project_ids=keep_project_ids,
        keep_thread_ids=keep_thread_ids,
        recent_thread_ids=recent_thread_ids,
        source_reference_thread_ids=source_reference_thread_ids,
        agents_targets=agents_targets,
        missing_critical_project_ids=missing_critical_project_ids,
        missing_critical_program_ids=missing_critical_program_ids,
        missing_critical_thread_ids=missing_critical_thread_ids,
        missing_preferred_thread_ids=missing_preferred_thread_ids,
        related_thread_count=related_thread_count,
    )

    if not config.json_output:
        if config.dry_run:
            print("Dry run complete; destination DB was not replaced.")
        else:
            print(f"Seeded dev DB: {config.dest_db} ({format_mib(config.dest_db)})")
        if config.keep_runtime_state:
            print("Preserved provider runtime/session state")
        else:
            print("Cleared provider runtime/session state")
        if summary.missing_preferred_thread_ids:
            print(
                "Warning: some agents-vxapp thread links were not present in the T3 source DB: "
                + ", ".join(summary.missing_preferred_thread_ids[:10])
                + (" ..." if len(summary.missing_preferred_thread_ids) > 10 else "")
            )

    return summary


def main(argv: Sequence[str]) -> int:
    try:
        config = parse_args(argv)
        summary = seed_dev_db(config)
        if config.json_output:
            print(json.dumps(summary.__dict__, indent=2, sort_keys=True))
        return 0
    except (FileNotFoundError, PermissionError, ValueError, sqlite3.Error) as exc:
        if "--json" in argv:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
