Created the handoff artifact at /home/gizmo/kb-vxapp/@Scratch/t3code-vxapp/t3-orchestration-vm-lag-implementation-session-handoff.md.

It captures:

- the exact t3code-vxapp artifacts that define the implementation scope
- the phase-1 code changes to make and the explicit non-goals
- the key files, tests, and required validation gates

Paste this next session:

Continue from the session handoff artifact at /home/gizmo/kb-vxapp/@Scratch/t3code-vxapp/t3-orchestration-vm-lag-implementation-session-handoff.md.

Context:

- The primary implementation brief is /home/gizmo/kb-vxapp/@Scratch/t3code-vxapp/t3-orchestration-vm-lag-session-prompt-2026-04-25.md.
- The cross-repo contract and follow-ups are in /home/gizmo/kb-vxapp/@Scratch/t3code-vxapp/t3-vm-lag-cross-repo-coherence-review-2026-04-25.md.
- Implement the phase-1 t3code-vxapp changes only: command-scoped `projection_state` batching, projector applicability filtering, vxapp extension-
  projector parity, bounded-query regression coverage, and replay/bootstrap regression coverage.
- Preserve synchronous correctness and existing readiness/current-state semantics.
- Do not add async projection deferral, a database migration, or optional direct-by-id RPCs unless the core phase-1 work is already complete and
  validated.

Start by reading those two t3code-vxapp artifacts, then inspect the current implementation in:

- /home/gizmo/t3code-vxapp/apps/server/src/orchestration/Layers/OrchestrationEngine.ts
- /home/gizmo/t3code-vxapp/apps/server/src/orchestration/Layers/ProjectionPipeline.ts
- /home/gizmo/t3code-vxapp/apps/server/src/persistence/Layers/ProjectionState.ts
- /home/gizmo/t3code-vxapp/apps/server/src/orchestration/Layers/ProjectionOperationalQuery.test.ts
- /home/gizmo/t3code-vxapp/apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts

Then implement the phase-1 code changes, add the required tests, and run:

- bun fmt
- bun lint
- bun typecheck

Do not run `bun test`. Use targeted `bun run test` only if needed during implementation.

Leave behind a closeout artifact summarizing what landed, what was measured, what tests were added, and any residual follow-up.

Validation: bun fmt passed, bun typecheck passed, bun lint passed with existing warnings only:

- apps/web/src/store.ts:942 oxc(no-map-spread)
- apps/server/src/orchestration/Layers/ProjectionOperationalQuery.test.ts:6 unused ProgramId
- apps/server/src/orchestration/Layers/ProjectionOperationalQuery.test.ts:24 unused asCtoAttentionId
