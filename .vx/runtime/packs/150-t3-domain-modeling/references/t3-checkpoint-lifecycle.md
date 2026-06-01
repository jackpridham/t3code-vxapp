---
name: t3-checkpoint-lifecycle
description: "Explain orchestration checkpoint capture, placeholder creation, diff finalization, baseline capture, restore, and revert behavior. Use this whenever the user asks how checkpoints are created, why a checkpoint is `missing` or `error`, how turn diffs relate to checkpoints, or how checkpoint revert works. Triggers on: 'checkpoint', 'checkpoint revert', 'turn diff', 'baseline capture', 'missing checkpoint', 'restore checkpoint', 'checkpoint lifecycle', 'why is checkpoint status missing', 'turn revert'."
allowed-tools: Read, Grep, Bash
---

# Checkpoint Lifecycle

Use this skill for questions about checkpoint state, turn diffs, revert behavior, and the interaction between runtime placeholders and filesystem-backed checkpoint capture.

## Source of Truth

Primary files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Services/RuntimeReceiptBus.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`

## Mental Model

There are two related but different things:

- turn diff/progress events in orchestration
- actual checkpoint filesystem capture/restore work

`ProviderRuntimeIngestion.ts` can create placeholder checkpoint/diff state before real capture finishes.
`CheckpointReactor.ts` performs the filesystem-backed checkpoint work and emits the durable completion path.

## Verification Workflow

### 1. Start at contracts

```bash
rg -n "Checkpoint|checkpointRef|thread.checkpoint.revert|thread.turn.diff.complete|OrchestrationCheckpoint" packages/contracts/src/orchestration.ts
```

### 2. Inspect runtime placeholder creation

```bash
rg -n "placeholder checkpoint|turn.diff|checkpoint" apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
```

### 3. Inspect real capture/revert logic

```bash
rg -n "captureCheckpoint|captureAndDispatchCheckpoint|restoreCheckpoint|baselineCheckpointRef|thread.checkpoint.revert" apps/server/src/orchestration/Layers/CheckpointReactor.ts
```

### 4. Inspect receipts and persistence

```bash
rg -n "CheckpointBaselineCapturedReceipt|CheckpointDiffFinalizedReceipt" apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
rg -n "checkpointRef|thread.turn-diff-completed|thread.reverted" apps/server/src/orchestration/Layers/ProjectionPipeline.ts apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
```

## Typical Questions This Skill Should Answer

- Why is a checkpoint `missing`?
- Why does a turn diff exist before checkpoint capture completed?
- Why did revert fail even though a turn exists?
- How are stale checkpoints pruned after revert?
- Why are checkpoints unavailable in a non-git workspace?

## Don’t Confuse These

- checkpoint placeholder rows vs actual filesystem checkpoints
- turn diff completion vs checkpoint capture completion
- revert intent (`thread.checkpoint.revert`) vs revert completion (`thread.reverted`)

## Escalate

- Use `t3-provider-runtime-ingestion-map` if the issue starts with provider runtime events
- Use `t3-orchestration-trace` for end-to-end UI traces involving checkpoint badges or summaries
