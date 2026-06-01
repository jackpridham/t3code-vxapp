# Bun Toolchain — t3code-vxapp

- Use `bun install` for dependency management; never invoke `npm` or `yarn`.
- Scripts live in `package.json`. The required completion gates are `bun fmt`,
  `bun lint`, and `bun typecheck`. Use `bun run test` when test execution is
  required, and never use `bun test`.
- Dev server: `bun run dev` (Vite).
- Build: `bun run build`.

Performance rule: agents favour native Bun APIs over polyfills when they
exist and the behaviour is equivalent.
