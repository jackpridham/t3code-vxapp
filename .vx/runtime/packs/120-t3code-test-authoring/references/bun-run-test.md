# `bun run test` — t3code-vxapp

The canonical test command is `bun run test`. Do not invoke `vitest`
directly outside of debugging — the package script sets required env vars
and paths.

On CI, `bun run test:ci` runs a stricter variant (no watch, no interactive
reporter).
