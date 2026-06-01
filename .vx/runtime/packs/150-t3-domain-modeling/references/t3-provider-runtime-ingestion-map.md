---
name: t3-provider-runtime-ingestion-map
description: "Map provider runtime events into orchestration events, sessions, activities, assistant messages, turn diffs, token usage, and proposed plans. Use this whenever the user asks how Codex/Claude runtime output becomes orchestration state, why a provider event created a thread activity or session update, or why turn/session state looks wrong after provider events. Triggers on: 'provider runtime', 'runtime ingestion', 'session.state.changed', 'thread.started', 'assistant delta', 'turn diff', 'token usage', 'where did this provider event go', 'how does runtime map into orchestration'."
allowed-tools: Read, Grep, Bash
---

# Provider Runtime Ingestion Map

Use this skill when the question starts with provider/runtime output and ends with orchestration state.

## Source of Truth

Primary files:

- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/web/src/store.ts`

## What This Layer Does

`ProviderRuntimeIngestion.ts` translates raw provider/runtime events into orchestration commands, activities, sessions, deltas, turn completions, checkpoint placeholders, and proposed plan updates.

This is the right place for questions like:

- why a runtime event changed session status
- why an activity appeared in the thread timeline
- how assistant deltas and completions are materialized
- why turn diffs/checkpoint placeholders appear before checkpoint capture finishes

## Verification Workflow

### 1. Find the runtime event contract

```bash
rg -n "<runtime event>|ProviderRuntimeEvent" packages/contracts/src/providerRuntime.ts
```

### 2. Find the ingestion mapping

```bash
rg -n "<runtime event>|runtimeEventToActivities|session.state.changed|thread.started|thread.token-usage.updated|turn.diff" apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
```

### 3. Check downstream orchestration writes

```bash
rg -n "thread.activity.append|thread.session.set|thread.message.assistant.delta|thread.message.assistant.complete|thread.turn.diff.complete|thread.proposed-plan.upsert" apps/server/src/orchestration/decider.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
```

### 4. Check browser projection

```bash
rg -n "thread.activity-appended|thread.session-set|thread.turn-diff-completed|thread.proposed-plan-upserted|thread.message-sent" apps/web/src/store.ts
```

## Common Subsystems in This File

- session lifecycle normalization
- assistant buffering and delta completion
- approval/user-input request mapping
- token usage/context window activities
- proposed plan buffering/upsert
- turn diff / placeholder checkpoint handling

## Don’t Confuse These

- `ProviderCommandReactor` reacts to orchestration domain events and sends work to providers
- `ProviderRuntimeIngestion` reacts to provider/runtime output and folds it back into orchestration state

## Escalate

- Use `t3-checkpoint-lifecycle` if the question becomes about real checkpoint capture/restore
- Use `t3-orchestration-trace` for a broader field trace that extends beyond provider runtime
- Use `t3-orchestrator-wake-flow` if the question is about worker completion waking orchestrators
