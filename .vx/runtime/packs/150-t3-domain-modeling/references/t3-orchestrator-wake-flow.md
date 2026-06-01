---
name: t3-orchestrator-wake-flow
description: "Trace orchestrator wake-item creation, persistence, delivery, drain, finalization, and consumption. Use this whenever the user asks how worker completion wakes an orchestrator, why a wake item is stuck or duplicated, how wake items are stored, or how the orchestrator session is selected/drained. Triggers on: 'wake item', 'orchestrator wake', 'worker finished', 'wake flow', 'pending wake', 'delivering wake', 'consumed wake', 'drain orchestrator', 'why did the orchestrator wake'."
allowed-tools: Read, Grep, Bash
---

# Orchestrator Wake Flow

Use this skill to explain the worker-to-orchestrator callback path. This flow is spread across contracts, reactors, projections, and UI-visible state.

## Source of Truth

Primary files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/Layers/OrchestratorWakeReactor.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/web/src/store.ts`

## Mental Model

Wake items are explicit records. They are not inferred from thread metadata.

A wake item carries:

- orchestrator thread/project
- worker thread/project
- worker turn
- worker title snapshot
- workflow id
- outcome
- state
- optional consume reason

## Default Workflow

### 1. Start at the contract

```bash
rg -n "OrchestratorWakeItem|thread.orchestrator-wake.upsert|thread.orchestrator-wake-upserted|OrchestratorWakeState|OrchestratorWakeConsumeReason" packages/contracts/src/orchestration.ts
```

### 2. Check producer and reactor logic

```bash
rg -n "orchestrator-wake|wakeItem|evaluateDrainForOrchestrator|finalizeDeliveringWakeItemsForOrchestrator|consumeReviewedDeliveredWakeItemsForOrchestrator" apps/server/src/orchestration/Layers/OrchestratorWakeReactor.ts
```

### 3. Check persistence

```bash
rg -n "orchestratorThreadId|wakeItem|thread.orchestrator-wake-upserted" apps/server/src/orchestration/Layers/ProjectionPipeline.ts apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
```

### 4. Check browser projection

```bash
rg -n "orchestratorWakeItems|thread.orchestrator-wake-upserted" apps/web/src/store.ts apps/web/src/components apps/web/src/routes/__root.tsx
```

## What This Skill Should Explain

- when wake items are upserted
- how pending/delivering/delivered/consumed/dropped states evolve
- why drain may wait on orchestrator session state
- how duplicates or mismatches are consumed/dropped
- how wake items reappear in snapshots and browser state

## Common Failure Questions

- Why is a wake item stuck in `pending` or `delivering`?
- Why was a wake item dropped?
- Why didn’t the orchestrator resume after a worker finished?
- Why does the orchestrator wake for the wrong thread?

## Don’t Confuse These

- thread lineage fields are not wake items
- wake items are not event metadata
- wake delivery state is separate from thread session state, even though they interact closely

## Escalate

- Use `t3-thread-lineage-decoder` for ancestry-only questions
- Use `t3-provider-runtime-ingestion-map` if the wake depends on provider runtime turn completion semantics
- Use `t3-orchestration-trace` to follow one wake-related field all the way to the UI
