---
name: 100-t3code-repo-orientation
description: "Orient to t3code-vxapp: Bun toolchain, Vite + Vitest, settings workflow, fmt/lint/typecheck gates."
---

# T3Code Repo Orientation

Orient to t3code-vxapp: Bun toolchain, Vite + Vitest, settings workflow, fmt/lint/typecheck gates.

## Scope

This is a **repo** pack for `t3code-vxapp`. Mount it only when working inside
`t3code-vxapp` and the worker's task class selects it (see
`repos/t3code-vxapp/pack-profile.json`).

## Upstream source

Composed from: repo:t3-settings-workflow.

## References

- `references/bun-toolchain.md`
- `references/fmt-lint-typecheck.md`
- `references/project-snapshot.md`
- `references/t3-settings-workflow.md`

Read the reference files before acting. If the task exceeds this pack's
scope, load the adjacent repo pack or escalate.
