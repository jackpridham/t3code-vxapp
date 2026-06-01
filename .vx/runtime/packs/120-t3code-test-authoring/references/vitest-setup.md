# Vitest Setup — t3code-vxapp

- Test files live alongside source as `*.test.ts` or `*.spec.ts`.
- Use `vitest` CLI (wrapped by `bun run test`).
- Fixtures live in `__fixtures__/` adjacent to the test.
- Snapshots: only for JSON projection shapes, never for UI markup.
- Integration tests that hit a real WebSocket must use the test harness in
  `src/test-utils/` — do not spin up a raw server per-test.
