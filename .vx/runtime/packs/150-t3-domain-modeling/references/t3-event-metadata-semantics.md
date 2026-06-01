---
name: t3-event-metadata-semantics
description: "Explain orchestration event metadata semantics, especially `eventId`, `commandId`, `causationEventId`, and `correlationId`. Use this whenever the user asks what these IDs mean, whether a correlation token belongs to a thread or orchestrator, whether IDs are unique per command/thread/session, or how multi-event command fanout is linked. Triggers on: 'correlationId', 'commandId', 'causationEventId', 'event metadata', 'what does this id mean', 'is this unique per thread', 'correlation token', 'link events together'."
allowed-tools: Read, Grep, Bash
---

# Event Metadata Semantics

Use this skill to explain orchestration event metadata precisely. Do not guess based on naming.

## Source of Truth

Primary files:

- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/persistence/Layers/OrchestrationEventStore.ts`

## Semantic Model

- `eventId`: unique identifier for one concrete event
- `commandId`: the command that directly produced the event, if any
- `correlationId`: command-scoped correlation key used to group events caused by the same command
- `causationEventId`: the specific prior event that directly caused this event

In this repo, the decider normally sets:

- `commandId = input.commandId`
- `correlationId = input.commandId`

That means `correlationId` is usually command-scoped, not thread-scoped and not orchestrator-scoped.

## Key Consequences

- A single command may emit multiple events with the same `correlationId`
- Those events may touch multiple aggregates
- `correlationId` is not the thread lineage mechanism
- `causationEventId` is the stronger signal for direct event-to-event linkage

## Verification Workflow

```bash
rg -n "correlationId|commandId|causationEventId|eventId" packages/contracts/src/orchestration.ts
rg -n "withEventBase|correlationId: input.commandId|causationEventId" apps/server/src/orchestration/decider.ts
rg -n "correlation_id|command_id|causation_event_id" apps/server/src/persistence/Layers/OrchestrationEventStore.ts
```

Then inspect at least one fanout command:

```bash
rg -n "case \"project.meta.update\"|case \"thread.turn.start\"" apps/server/src/orchestration/decider.ts
```

## Typical Questions This Skill Should Answer

- Is `correlationId` unique per thread? No, it is usually unique per command emission group.
- Is `correlationId` an orchestrator token? No.
- What links worker threads back to orchestrators? Thread lineage fields, not event metadata.
- Why do two different events share the same `correlationId`? They came from the same command.

## Don’t Confuse These

- `correlationId` vs orchestrator linkage
- `causationEventId` vs `correlationId`
- event metadata vs thread state fields

## Escalate

- Use `t3-thread-lineage-decoder` if the user really means orchestrator/worker linkage
- Use `t3-orchestration-trace` if the user needs a full end-to-end path for a specific command or event
