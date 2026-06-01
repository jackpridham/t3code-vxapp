---
name: 150-t3-domain-modeling
description: "Consolidated T3 domain-modeling references: checkpoints, event metadata, orchestrator wake flow, thread lineage, UI state boundaries, provider ingestion map, orchestration trace, sidebar modeling, document title workflow."
---

# T3 Domain Modeling

Consolidated T3 domain-modeling references: checkpoints, event metadata, orchestrator wake flow, thread lineage, UI state boundaries, provider ingestion map, orchestration trace, sidebar modeling, document title workflow.

## Scope

This is a **repo** pack for `t3code-vxapp`. Mount it only when working inside
`t3code-vxapp` and the worker's task class selects it (see
`repos/t3code-vxapp/pack-profile.json`).

## Upstream source

Composed from: repo:t3-checkpoint-lifecycle, repo:t3-document-title-workflow, repo:t3-event-metadata-semantics, repo:t3-orchestration-sidebar-modeling, repo:t3-orchestration-trace, repo:t3-orchestrator-wake-flow, repo:t3-provider-runtime-ingestion-map, repo:t3-thread-lineage-decoder, repo:t3-ui-state-and-projection-boundaries.

## References

- `references/t3-checkpoint-lifecycle.md`
- `references/t3-document-title-workflow.md`
- `references/t3-event-metadata-semantics.md`
- `references/t3-orchestration-sidebar-modeling.md`
- `references/t3-orchestration-trace.md`
- `references/t3-orchestrator-wake-flow.md`
- `references/t3-provider-runtime-ingestion-map.md`
- `references/t3-thread-lineage-decoder.md`
- `references/t3-ui-state-and-projection-boundaries.md`

Read the reference files before acting. If the task exceeds this pack's
scope, load the adjacent repo pack or escalate.
