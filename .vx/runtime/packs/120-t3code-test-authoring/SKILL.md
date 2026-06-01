---
name: 120-t3code-test-authoring
description: "Test authoring for t3code-vxapp: Vitest setup, `bun run test` conventions."
---

# T3Code Test Authoring

Test authoring for t3code-vxapp: Vitest setup, `bun run test` conventions.

## Scope

This is a **repo** pack for `t3code-vxapp`. Mount it only when working inside
`t3code-vxapp` and the worker's task class selects it (see
`repos/t3code-vxapp/pack-profile.json`).

## Upstream source

Composed from: (authored).

## Worker Rules

- The canonical test command is `bun run test`. Do not use `bun test`.
- Test work still closes out under the repo's normal completion gates:
  `bun fmt`, `bun lint`, and `bun typecheck`.

## References

- `references/bun-run-test.md`
- `references/vitest-setup.md`

Read the reference files before acting. If the task exceeds this pack's
scope, load the adjacent repo pack or escalate.
