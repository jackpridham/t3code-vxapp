---
name: t3-thread-lineage-decoder
description: "Explain orchestration thread lineage and orchestrator linkage fields: `orchestratorProjectId`, `orchestratorThreadId`, `parentThreadId`, `spawnRole`, `spawnedBy`, and `workflowId`. Use this whenever the user asks how worker threads link back to an orchestrator, how spawned threads are modeled, which field is the source of truth for ancestry, or how lineage reaches the UI. Triggers on: 'worker thread', 'orchestrator thread', 'parentThreadId', 'spawnRole', 'spawnedBy', 'workflowId', 'lineage', 'who spawned this thread', 'link back to orchestrator'."
allowed-tools: Read, Grep, Bash
---

# Thread Lineage Decoder

Use this skill for questions about thread ancestry. This is the real linkage model for orchestrators and workers.

## Source of Truth

Primary files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/web/src/store.ts`

## Core Fields

- `orchestratorProjectId`: owning orchestrator project
- `orchestratorThreadId`: root orchestrator thread associated with the worker/supervisor thread
- `parentThreadId`: immediate parent in the spawn tree
- `spawnRole`: orchestration role such as `orchestrator`, `worker`, or `supervisor`
- `spawnedBy`: human-readable or system identifier for the spawner
- `workflowId`: optional cross-thread workflow grouping key

## Interpretation Rules

- Use `parentThreadId` for direct parent/child relationships
- Use `orchestratorThreadId` for "which orchestrator thread owns this work"
- Use `workflowId` for cross-thread grouping across the same orchestration workflow
- Use `spawnRole` to understand intended behavior, not ownership

## Verification Workflow

```bash
rg -n "orchestratorProjectId|orchestratorThreadId|parentThreadId|spawnRole|spawnedBy|workflowId" packages/contracts/src/orchestration.ts
rg -n "orchestratorProjectId|orchestratorThreadId|parentThreadId|spawnRole|spawnedBy|workflowId" apps/server/src/orchestration/decider.ts apps/server/src/orchestration/projector.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
rg -n "orchestratorProjectId|orchestratorThreadId|parentThreadId|spawnRole|spawnedBy|workflowId" apps/web/src/store.ts apps/web/src/routes/__root.tsx apps/web/src/components
```

## Typical Conclusions

- Orchestrator linkage is carried on thread payload/state, not event metadata
- A worker can have both a `parentThreadId` and an `orchestratorThreadId`
- `orchestratorThreadId` may be stable across multiple spawned worker threads in one orchestration workflow
- `workflowId` is optional and groups related orchestration work without replacing ancestry

## Don’t Confuse These

- `parentThreadId` is not necessarily the same as `orchestratorThreadId`
- `spawnedBy` is descriptive, not a stable identity key
- `workflowId` groups work; it does not define direct parentage

## Escalate

- Use `t3-orchestrator-wake-flow` when lineage questions become wake-delivery questions
- Use `t3-event-metadata-semantics` when the user is mixing lineage with `correlationId`
- Use `t3-orchestration-trace` for a full server-to-UI trace of one lineage field
