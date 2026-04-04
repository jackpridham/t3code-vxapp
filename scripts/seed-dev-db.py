#!/usr/bin/env python3
"""
seed-dev-db.py — Populate the T3 dev database with test projects and threads.

Inserts into BOTH orchestration_events (source of truth) AND projection
tables so the server replays correctly on restart.

Usage:
    python3 scripts/seed-dev-db.py          # seed (idempotent)
    python3 scripts/seed-dev-db.py --reset  # wipe all data first
"""

import json
import sqlite3
import sys
import uuid
from datetime import datetime, timezone, timedelta

DB_PATH = "/home/gizmo/.t3/dev/state.sqlite"

BASE_TIME = datetime(2026, 4, 4, 2, 0, 0, tzinfo=timezone.utc)


def ts(offset_seconds: int = 0) -> str:
    return (BASE_TIME + timedelta(seconds=offset_seconds)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def new_id() -> str:
    return str(uuid.uuid4())


# ── IDs (stable so seed is idempotent) ────────────────────────────────────────

PROJ_ORCHESTRATOR = "5d395fe5-0f03-4dc1-991b-3325f9512515"
PROJ_VORTEX       = "ab7111f5-3311-4fe7-bd77-9fd76fffcd5d"
PROJ_T3CODE       = "c1234567-0000-4000-8000-t3codevxapp001"
PROJ_VUE          = "d2345678-0000-4000-8000-vuevxapp000001"
PROJ_API          = "e3456789-0000-4000-8000-apivxapp000001"

THREAD_JASPER   = "1567c915-7df7-497f-9b9b-4559bf6f57c1"
THREAD_PHASE_C  = "cf2a44aa-0400-4e5c-ba1a-686142e363ba"
THREAD_PHASE_D  = "819d6702-bae3-4b63-baf3-6e9b235c72ca"
THREAD_PHASE_E  = "43d0fe5c-fa94-4cab-9869-4a9d8b279bd5"
THREAD_RUNNING  = "f9999999-0000-4000-8000-runningthread1"

DEFAULT_MODEL = {"provider": "codex", "model": "gpt-5-codex"}


# ── Event helpers ──────────────────────────────────────────────────────────────

_seq = [2]  # start after auto-bootstrapped events


def next_seq() -> int:
    _seq[0] += 1
    return _seq[0]


def insert_event(db, aggregate_kind, stream_id, event_type, payload: dict,
                 stream_version=0, offset=0):
    event_id = new_id()
    command_id = new_id()
    db.execute(
        """
        INSERT OR IGNORE INTO orchestration_events
            (event_id, aggregate_kind, stream_id, stream_version, event_type,
             occurred_at, command_id, causation_event_id, correlation_id,
             actor_kind, payload_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'seed', ?, '{}')
        """,
        (event_id, aggregate_kind, stream_id, stream_version, event_type,
         ts(offset), command_id, command_id, json.dumps(payload)),
    )
    return event_id


# ── Project events ─────────────────────────────────────────────────────────────

def seed_project(db, project_id, title, workspace_root, kind="project", offset=0):
    payload = {
        "projectId": project_id,
        "title": title,
        "workspaceRoot": workspace_root,
        "kind": kind,
        "defaultModelSelection": DEFAULT_MODEL,
        "scripts": [],
        "hooks": [],
        "createdAt": ts(offset),
        "updatedAt": ts(offset),
    }
    insert_event(db, "project", project_id, "project.created", payload, offset=offset)

    # Projection row
    db.execute(
        """
        INSERT OR REPLACE INTO projection_projects
            (project_id, title, workspace_root, scripts_json, hooks_json, kind, created_at, updated_at)
        VALUES (?, ?, ?, '[]', '[]', ?, ?, ?)
        """,
        (project_id, title, workspace_root, kind, ts(offset), ts(offset)),
    )


# ── Thread events ──────────────────────────────────────────────────────────────

def seed_thread(db, thread_id, project_id, title, worktree_path=None,
                labels=None, spawn_role=None, spawned_by=None,
                orchestrator_thread_id=None, parent_thread_id=None,
                workflow_id=None, offset=0):
    labels = labels or []
    # Schema expects absent keys, not null — strip all None values
    lineage = {k: v for k, v in {
        "orchestratorProjectId": PROJ_ORCHESTRATOR if spawn_role == "worker" else None,
        "orchestratorThreadId": orchestrator_thread_id,
        "parentThreadId": parent_thread_id,
        "spawnRole": spawn_role,
        "spawnedBy": spawned_by,
        "workflowId": workflow_id,
    }.items() if v is not None}
    # branch/worktreePath must be present (can be null); lineage fields stripped if absent
    payload = {
        "threadId": thread_id,
        "projectId": project_id,
        "title": title,
        "labels": labels,
        "modelSelection": DEFAULT_MODEL,
        "runtimeMode": "full-access",
        "interactionMode": "default",
        "branch": None,
        "worktreePath": worktree_path,
        **lineage,
        "createdAt": ts(offset),
        "updatedAt": ts(offset),
    }
    insert_event(db, "thread", thread_id, "thread.created", payload, offset=offset)

    db.execute(
        """
        INSERT OR REPLACE INTO projection_threads
            (thread_id, project_id, title, labels_json, worktree_path,
             spawn_role, spawned_by, orchestrator_thread_id, parent_thread_id,
             workflow_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (thread_id, project_id, title, json.dumps(labels), worktree_path,
         spawn_role, spawned_by, orchestrator_thread_id, parent_thread_id,
         workflow_id, ts(offset), ts(offset + 120)),
    )


# ── Message helpers ────────────────────────────────────────────────────────────

def seed_message(db, thread_id, role, text, turn_id=None, offset=0):
    message_id = new_id()
    payload = {
        "messageId": message_id,
        "threadId": thread_id,
        "turnId": turn_id,
        "role": role,
        "text": text,
        "attachments": [],
        "createdAt": ts(offset),
        "updatedAt": ts(offset),
    }
    insert_event(db, "thread", thread_id, "thread.message.created", payload, offset=offset)

    db.execute(
        """
        INSERT OR REPLACE INTO projection_thread_messages
            (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at, attachments_json)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, '[]')
        """,
        (message_id, thread_id, turn_id, role, text, ts(offset), ts(offset)),
    )
    return message_id


def seed_turn(db, thread_id, turn_id, state="completed", offset=0):
    completed_at = ts(offset + 45) if state == "completed" else None
    db.execute(
        """
        INSERT OR REPLACE INTO projection_turns
            (thread_id, turn_id, state, requested_at, started_at, completed_at, checkpoint_files_json)
        VALUES (?, ?, ?, ?, ?, ?, '[]')
        """,
        (thread_id, turn_id, state, ts(offset), ts(offset + 2), completed_at),
    )


# ── Main seed ──────────────────────────────────────────────────────────────────

def seed(db):
    # Projects
    seed_project(db, PROJ_ORCHESTRATOR, "agents-vxapp",   "/home/gizmo/agents-vxapp",   kind="orchestrator", offset=-7200)
    seed_project(db, PROJ_VORTEX,       "vortex-scripts", "/home/gizmo/vortex-scripts",  offset=-7190)
    seed_project(db, PROJ_T3CODE,       "t3code-vxapp",   "/home/gizmo/t3code-vxapp",    offset=-7180)
    seed_project(db, PROJ_VUE,          "vue-vxapp",      "/home/gizmo/vue-vxapp",        offset=-7170)
    seed_project(db, PROJ_API,          "api-vxapp",      "/home/gizmo/api-vxapp",        offset=-7160)

    # Jasper orchestrator thread
    seed_thread(db, THREAD_JASPER, PROJ_ORCHESTRATOR,
        title="Jasper — Orchestrator",
        worktree_path="/home/gizmo/agents-vxapp",
        labels=["orchestrator"], spawn_role="orchestrator", spawned_by="human",
        offset=-7100)
    t = new_id()
    seed_turn(db, THREAD_JASPER, t, state="completed", offset=-7090)
    seed_message(db, THREAD_JASPER, "user",
        "Implement Phase C notifications and Phase D artifact panel for T3 Code.",
        turn_id=t, offset=-7090)
    seed_message(db, THREAD_JASPER, "assistant",
        "Dispatching Phase C (notifications) and Phase D (artifact viewer) in parallel.\n\n"
        "Self-review written to "
        "`@Docs/@Scratch/agents-vxapp/self-review-t3-orchestration-phases-cdef-2.md`",
        turn_id=t, offset=-7000)

    # Phase C: Notifications (completed worker)
    seed_thread(db, THREAD_PHASE_C, PROJ_T3CODE,
        title="Phase C: Notification system",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"], spawn_role="worker", spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER, parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration", offset=-3600)
    t = new_id()
    seed_turn(db, THREAD_PHASE_C, t, state="completed", offset=-3590)
    seed_message(db, THREAD_PHASE_C, "user",
        "Implement toast notifications for orchestration events and a settings panel.",
        turn_id=t, offset=-3590)
    seed_message(db, THREAD_PHASE_C, "assistant",
        "Implementation complete. Created:\n"
        "- `src/notificationSettings.ts` — preferences schema\n"
        "- `src/notificationDispatch.ts` — central dispatch\n"
        "- `src/components/settings/SettingsPanels.tsx` — settings UI\n\n"
        "Self-review: @Docs/@Scratch/vortex-scripts/dispatch-options-feasibility.md\n\n"
        "All 58 tests passing, typecheck clean.",
        turn_id=t, offset=-3500)

    # Phase D: Artifact panel (completed worker — has artifact links for testing)
    seed_thread(db, THREAD_PHASE_D, PROJ_T3CODE,
        title="Phase D: Artifact viewer panel",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"], spawn_role="worker", spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER, parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration", offset=-3000)
    t = new_id()
    seed_turn(db, THREAD_PHASE_D, t, state="completed", offset=-2990)
    seed_message(db, THREAD_PHASE_D, "user",
        "Implement ArtifactPanel slide-out component and readFile API.",
        turn_id=t, offset=-2990)
    seed_message(db, THREAD_PHASE_D, "assistant",
        "Done. Added `readFile` RPC to server, wired `ArtifactPanel` in `__root.tsx`.\n\n"
        "Key files:\n"
        "- `src/components/ArtifactPanel.tsx` — slide-out panel\n"
        "- `src/artifactDiscovery.ts` — workspace file search\n\n"
        "Self-review: "
        "[self-review](/@Docs/@Scratch/vortex-scripts/dispatch-options-feasibility.md)\n\n"
        "Also see: @Docs/@Scratch/vortex-scripts/submodule-detached-head-after-pull.md",
        turn_id=t, offset=-2900)

    # Phase E: KI pipeline (completed worker)
    seed_thread(db, THREAD_PHASE_E, PROJ_VORTEX,
        title="Phase E: T3 Thread → Knowledge Pipeline",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"], spawn_role="worker", spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER, parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration", offset=-2000)
    t = new_id()
    seed_turn(db, THREAD_PHASE_E, t, state="completed", offset=-1990)
    seed_message(db, THREAD_PHASE_E, "user",
        "Wire T3 threads into KI pipeline for knowledge extraction.",
        turn_id=t, offset=-1990)
    seed_message(db, THREAD_PHASE_E, "assistant",
        "Pipeline wired. New commands:\n"
        "- `vx agents knowledge --queue-thread --thread <id>`\n"
        "- `vx agents knowledge --process`\n\n"
        "Summariser: 29.5s → 0.035s (843× speedup).\n\n"
        "See: @Docs/@Scratch/vortex-scripts/vue-common-correct-reference-for-api-common.md",
        turn_id=t, offset=-1900)

    # Phase G: running thread (for notification testing)
    seed_thread(db, THREAD_RUNNING, PROJ_API,
        title="Phase G: Something in progress",
        worktree_path="/home/gizmo/api-vxapp",
        labels=["worker"], spawn_role="worker", spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER, parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration", offset=-120)
    t = new_id()
    seed_turn(db, THREAD_RUNNING, t, state="running", offset=-100)
    seed_message(db, THREAD_RUNNING, "user",
        "Add rate-limiting middleware to the API.", turn_id=t, offset=-100)

    db.commit()
    print("✓ Seeded 5 projects + 5 threads into events + projections")
    print("  Phase D thread has @Docs/@Scratch artifact links for panel testing")
    print("  Phase G thread has a running turn for notification testing")


def reset(db):
    for table in [
        "orchestration_events", "orchestration_command_receipts",
        "projection_projects", "projection_threads", "projection_thread_messages",
        "projection_turns", "projection_thread_sessions", "projection_thread_activities",
        "projection_state",
    ]:
        db.execute(f"DELETE FROM {table}")
    db.commit()
    print("✓ Wiped all event + projection data")


if __name__ == "__main__":
    db = sqlite3.connect(DB_PATH)
    if "--reset" in sys.argv:
        reset(db)
    seed(db)
    db.close()
