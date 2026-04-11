# AI Agent Contracts — Runtime Contract Compatibility Policy

This package defines versioned, schema-first contracts for the AI-first SPA runtime channel.

## Versioning

- `protocolVersion` is a required integer field on all envelopes.
- Additions are additive only: adding optional fields, event variants, and new union members is permitted.
- Removing fields, narrowing field types, or changing required fields is **not** allowed in a patch/minor release.
- Breaking changes must be introduced through a new major protocol version with runtime migration support.

## Placement exception

- This package is intentionally tracked in `t3code-vxapp` for Phase 2 as an interim schema-only home while the dedicated runtime repo lane remains the authoritative final owner for tenant runtime contracts (`runtime-home` decision in Phase 1).
- The project owner accepts that this is a temporary exception; future phases should migrate this package to the dedicated runtime repository once available.

## Compatibility rules

- Timestamps are carried as `ISO` strings for audit/debug purposes.
- `eventId` and `sequence` are mandatory for ordered replay and correlation.
- `correlationId` links client command flows to command/tool confirmation branches.
- `idempotencyKey` is used for replay-safe command/result submission retries.
- Unknown payload fragments should be treated as advisory unless they affect validation.

## Generated artifacts

- JSON examples are tracked in `artifacts/examples/`.
- JSON Schema/OpenAPI outputs are generated from `Schema` definitions and published with a runtime consumer that owns the dedicated runtime repository.
- Runtime implementation should treat these artifacts as source-of-truth for transport contracts.

## Validation expectations

1. Contract package should keep schema tests for at least:
   - request shape decoding by `_tag`
   - channel routing by `channel`
   - render block variants
   - confirmation/tool/error edge cases
2. Backward compatibility should be reviewed on every phase transition before release.
