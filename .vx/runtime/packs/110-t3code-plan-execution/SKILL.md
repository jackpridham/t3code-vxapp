---
name: 110-t3code-plan-execution
description: "Implementation rules for t3code-vxapp: maintainability, performance/reliability priorities, duplicate-logic rules."
---

# T3Code Plan Execution

Implementation rules for t3code-vxapp: maintainability, performance/reliability priorities, duplicate-logic rules.

## Scope

This is a **repo** pack for `t3code-vxapp`. Mount it only when working inside
`t3code-vxapp` and the worker's task class selects it (see
`repos/t3code-vxapp/pack-profile.json`).

## Upstream source

Composed from: (authored).

## JSON Plan Defaults

When the task includes a JSON plan key, this pack owns the repo-local JSON plan
contract. Use only `vx apps t3 plan ...` for plan reads, notes,
blockers, and task completion. Do not use raw `vx plan`, do not create sidecar
plan files or out-of-band phase tracking, and do not edit JSON plan files
directly.

Worker prompts only need the app selector, plan key, phase/step scope, and
closeout responsibility; do not require the orchestrator to paste the full JSON
plan command tutorial into every prompt.

After each JSON plan mutation, read back the affected scope before another
mutation. If counts or statuses regress, stop and report a JSON plan state race.

## Completion Gates

Before considering implementation complete:

- run `bun fmt`
- run `bun lint`
- run `bun typecheck`
- use `bun run test` when the changed surface needs test verification
- never use `bun test`

## References

- `references/duplicate-logic-rules.md`
- `references/maintainability.md`
- `references/performance-reliability.md`

Read the reference files before acting. If the task exceeds this pack's
scope, load the adjacent repo pack or escalate.
