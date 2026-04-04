#!/usr/bin/env python3
"""
seed-dev-db.py — Populate the T3 dev database with test projects and threads.

Run after starting the dev server to get a realistic test environment.
Inserts directly into projection tables (no event sourcing needed for dev).

Usage:
    python3 scripts/seed-dev-db.py
    python3 scripts/seed-dev-db.py --reset  # drop all existing data first
"""

import sqlite3
import sys
import uuid
from datetime import datetime, timezone

DB_PATH = "/home/gizmo/.t3/dev/state.sqlite"
NOW = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ts(offset_seconds: int = 0) -> str:
    from datetime import timedelta
    dt = datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)
    return dt.isoformat().replace("+00:00", "Z")


def insert_project(db, project_id, title, workspace_root, kind="project"):
    db.execute(
        """
        INSERT OR REPLACE INTO projection_projects
            (project_id, title, workspace_root, scripts_json, hooks_json, kind, created_at, updated_at)
        VALUES (?, ?, ?, '[]', '[]', ?, ?, ?)
        """,
        (project_id, title, workspace_root, kind, ts(-3600), ts(-3600)),
    )


def insert_thread(db, thread_id, project_id, title, worktree_path=None,
                  labels=None, spawn_role=None, spawned_by=None,
                  orchestrator_thread_id=None, parent_thread_id=None,
                  workflow_id=None, created_offset=-600):
    import json
    labels_json = json.dumps(labels or [])
    db.execute(
        """
        INSERT OR REPLACE INTO projection_threads
            (thread_id, project_id, title, labels_json, worktree_path,
             spawn_role, spawned_by, orchestrator_thread_id, parent_thread_id,
             workflow_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (thread_id, project_id, title, labels_json, worktree_path,
         spawn_role, spawned_by, orchestrator_thread_id, parent_thread_id,
         workflow_id, ts(created_offset), ts(created_offset + 120)),
    )


def insert_message(db, message_id, thread_id, role, text, turn_id=None, created_offset=-590):
    db.execute(
        """
        INSERT OR REPLACE INTO projection_thread_messages
            (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        """,
        (message_id, thread_id, turn_id, role, text, ts(created_offset), ts(created_offset)),
    )


def insert_turn(db, thread_id, turn_id, state="completed", created_offset=-590):
    completed = ts(created_offset + 45) if state == "completed" else None
    db.execute(
        """
        INSERT OR REPLACE INTO projection_turns
            (thread_id, turn_id, state, requested_at, started_at, completed_at, checkpoint_files_json)
        VALUES (?, ?, ?, ?, ?, ?, '[]')
        """,
        (thread_id, turn_id, state,
         ts(created_offset), ts(created_offset + 2), completed),
    )


def seed(db):
    # ── Projects ──────────────────────────────────────────────────────────────

    PROJ_ORCHESTRATOR = "5d395fe5-0f03-4dc1-991b-3325f9512515"
    PROJ_VORTEX       = "ab7111f5-3311-4fe7-bd77-9fd76fffcd5d"
    PROJ_T3CODE       = "c1234567-0000-0000-0000-t3codevxapp00"
    PROJ_VUE          = "d2345678-0000-0000-0000-vuevxapp000000"
    PROJ_API          = "e3456789-0000-0000-0000-apivxapp000000"

    insert_project(db, PROJ_ORCHESTRATOR, "agents-vxapp",   "/home/gizmo/agents-vxapp",   kind="orchestrator")
    insert_project(db, PROJ_VORTEX,       "vortex-scripts", "/home/gizmo/vortex-scripts")
    insert_project(db, PROJ_T3CODE,       "t3code-vxapp",   "/home/gizmo/t3code-vxapp")
    insert_project(db, PROJ_VUE,          "vue-vxapp",      "/home/gizmo/vue-vxapp")
    insert_project(db, PROJ_API,          "api-vxapp",      "/home/gizmo/api-vxapp")

    # ── Orchestrator thread (Jasper) ──────────────────────────────────────────

    THREAD_JASPER = "1567c915-7df7-497f-9b9b-4559bf6f57c1"
    insert_thread(
        db, THREAD_JASPER, PROJ_ORCHESTRATOR,
        title="Jasper — Orchestrator",
        worktree_path="/home/gizmo/agents-vxapp",
        labels=["orchestrator"],
        spawn_role="orchestrator",
        spawned_by="human",
        created_offset=-7200,
    )
    insert_message(db, str(uuid.uuid4()), THREAD_JASPER, "user",
        "Implement Phase C notifications and Phase D artifact panel for T3 Code.",
        created_offset=-7190)
    insert_message(db, str(uuid.uuid4()), THREAD_JASPER, "assistant",
        "Dispatching Phase C (notifications) and Phase D (artifact viewer) agents in parallel.\n\n"
        "Self-review written to `@Docs/@Scratch/agents-vxapp/self-review-t3-orchestration-phases-cdef-2.md`",
        created_offset=-7100)

    # ── Worker thread with artifact links (tests Phase D) ────────────────────

    THREAD_PHASE_C = "cf2a44aa-0400-4e5c-ba1a-686142e363ba"
    TURN_PHASE_C   = str(uuid.uuid4())
    insert_thread(
        db, THREAD_PHASE_C, PROJ_T3CODE,
        title="Phase C: Notification system",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"],
        spawn_role="worker",
        spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER,
        parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration",
        created_offset=-3600,
    )
    insert_turn(db, THREAD_PHASE_C, TURN_PHASE_C, state="completed", created_offset=-3590)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_C, "user",
        "Implement toast notifications for orchestration events and a settings panel.",
        turn_id=TURN_PHASE_C, created_offset=-3590)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_C, "assistant",
        "Implementation complete. Created:\n"
        "- `src/notificationSettings.ts` — preferences schema\n"
        "- `src/notificationDispatch.ts` — central dispatch\n"
        "- `src/components/settings/SettingsPanels.tsx` — settings UI\n\n"
        "Self-review: @Docs/@Scratch/vortex-scripts/dispatch-options-feasibility.md\n\n"
        "All 58 tests passing, typecheck clean.",
        turn_id=TURN_PHASE_C, created_offset=-3500)

    # ── Worker thread: Phase D (artifact panel) — has artifact links ──────────

    THREAD_PHASE_D = "819d6702-bae3-4b63-baf3-6e9b235c72ca"
    TURN_PHASE_D   = str(uuid.uuid4())
    insert_thread(
        db, THREAD_PHASE_D, PROJ_T3CODE,
        title="Phase D: Artifact viewer panel",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"],
        spawn_role="worker",
        spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER,
        parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration",
        created_offset=-3000,
    )
    insert_turn(db, THREAD_PHASE_D, TURN_PHASE_D, state="completed", created_offset=-2990)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_D, "user",
        "Implement the ArtifactPanel slide-out component and readFile API.",
        turn_id=TURN_PHASE_D, created_offset=-2990)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_D, "assistant",
        "Done. Added `readFile` RPC to server, wired `ArtifactPanel` in `__root.tsx`.\n\n"
        "Key files:\n"
        "- `src/components/ArtifactPanel.tsx` — slide-out panel\n"
        "- `src/artifactDiscovery.ts` — workspace file search\n\n"
        "See self-review: "
        "[self-review-t3-orchestration-phases-cdef-2](@Docs/@Scratch/vortex-scripts/dispatch-options-feasibility.md)\n\n"
        "Also see: @Docs/@Scratch/vortex-scripts/submodule-detached-head-after-pull.md",
        turn_id=TURN_PHASE_D, created_offset=-2900)

    # ── Worker thread: Phase E (KI pipeline) ─────────────────────────────────

    THREAD_PHASE_E = "43d0fe5c-fa94-4cab-9869-4a9d8b279bd5"
    TURN_PHASE_E   = str(uuid.uuid4())
    insert_thread(
        db, THREAD_PHASE_E, PROJ_VORTEX,
        title="Phase E: T3 Thread → Knowledge Pipeline",
        worktree_path="/home/gizmo/vortex-scripts",
        labels=["worker"],
        spawn_role="worker",
        spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER,
        parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration",
        created_offset=-2000,
    )
    insert_turn(db, THREAD_PHASE_E, TURN_PHASE_E, state="completed", created_offset=-1990)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_E, "user",
        "Wire T3 threads into the existing KI pipeline so agent work is extracted as knowledge items.",
        turn_id=TURN_PHASE_E, created_offset=-1990)
    insert_message(db, str(uuid.uuid4()), THREAD_PHASE_E, "assistant",
        "Pipeline wired. New commands:\n"
        "- `vx agents knowledge --queue-thread --thread <id>`\n"
        "- `vx agents knowledge --process`\n\n"
        "Summariser: `Scripts/@Helpers/agents/summarise-t3-thread.sh`\n"
        "Perf: 29.5s → 0.035s (843× speedup) after rewrite as single Python heredoc.\n\n"
        "See: @Docs/@Scratch/vortex-scripts/vue-common-correct-reference-for-api-common.md",
        turn_id=TURN_PHASE_E, created_offset=-1900)

    # ── Running thread (tests notification on completion) ─────────────────────

    THREAD_RUNNING = str(uuid.uuid4())
    TURN_RUNNING   = str(uuid.uuid4())
    insert_thread(
        db, THREAD_RUNNING, PROJ_API,
        title="Phase G: Something in progress",
        worktree_path="/home/gizmo/api-vxapp",
        labels=["worker"],
        spawn_role="worker",
        spawned_by="jasper",
        orchestrator_thread_id=THREAD_JASPER,
        parent_thread_id=THREAD_JASPER,
        workflow_id="t3-orchestration",
        created_offset=-120,
    )
    insert_turn(db, THREAD_RUNNING, TURN_RUNNING, state="running", created_offset=-100)
    insert_message(db, str(uuid.uuid4()), THREAD_RUNNING, "user",
        "Add rate-limiting middleware to the API.", turn_id=TURN_RUNNING, created_offset=-100)

    db.commit()
    print("✓ Seeded:")
    print(f"  5 projects")
    print(f"  5 threads (1 orchestrator, 3 completed workers, 1 running)")
    print(f"  Messages with @Docs/@Scratch artifact links in Phase D thread")
    print(f"  Running thread to test notification on completion")
    print()
    print("Open http://192.168.100.42:5733/ and reload to see data.")
    print("Phase D artifact links are in the 'Phase D: Artifact viewer panel' thread.")


def reset(db):
    for table in [
        "projection_projects", "projection_threads", "projection_thread_messages",
        "projection_turns", "projection_thread_sessions", "projection_thread_activities",
    ]:
        db.execute(f"DELETE FROM {table}")
    db.commit()
    print("✓ Cleared existing projection data")


if __name__ == "__main__":
    db = sqlite3.connect(DB_PATH)
    if "--reset" in sys.argv:
        reset(db)
    seed(db)
    db.close()
