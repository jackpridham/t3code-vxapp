# Fmt/Lint/Typecheck Gates — t3code-vxapp

Before any closeout, run:

```
bun fmt
bun lint
bun typecheck
```

All three must pass before considering the task complete. Use `bun run test`
when the changed surface needs test verification or when the task is
test-authoring. Never use `bun test`.
