# @t3tools/orchestration-core

Standalone orchestration domain logic extracted from the server.

This package is intentionally limited to pure orchestration behavior and small
domain helpers. It must not import from `apps/server`; server-owned runtime
concerns such as SQL repositories, provider sessions, checkpoints, process
execution, settings, and WebSocket handlers belong in the server integration
layer.

The package currently exports:

- command invariants and the command decider
- read-model projector helpers
- event schema aliases backed by `@t3tools/contracts`
- CTO attention projection helpers
- pure orchestrator notification formatting predicates

Future server integration should import this package from narrow adapter files
rather than patching upstream-owned server files directly.
