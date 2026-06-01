---
name: t3-ui-state-and-projection-boundaries
description: "Decide where state should live in T3 Code: browser UI state, web store projection, server project/thread metadata, or server projection/query layers. Use this whenever the user asks whether a value should be kept in the browser, stored in project metadata, persisted in projections, hydrated through snapshots, or shared across refreshes/windows. Triggers on: 'where should this state live', 'browser state or db', 'persist this selection', 'should this survive refresh', 'ui state vs projection', 'store this in metadata', 'shared across clients', 'sidebar state placement', 'session selection persistence'."
allowed-tools: Read, Grep, Bash
---

# UI State And Projection Boundaries

Use this skill to place state deliberately in `t3code-vxapp`. Do not default to "whatever is easiest in the current component."

## The Four Buckets

### 1. Browser UI state

Use for local presentation and interaction state:

- expanded/collapsed rows
- drag hover state
- active label filter chips
- local selection anchors
- temporary form input

Typical homes:

- `apps/web/src/uiStateStore.ts`
- local React state in components

If losing it on refresh is acceptable, this bucket is usually fine.

### 2. Web app read model

Use for browser-side live projection of server truth:

- hydrated threads/projects
- incoming orchestration events
- active thread/session snapshots already produced by the server

Typical home:

- `apps/web/src/store.ts`

Do not invent durable truth here. The web store mirrors server-authoritative data for rendering.

### 3. Aggregate metadata

Use for durable per-project or per-thread semantics that should survive refresh and be queryable consistently:

- project parent override
- current orchestration session root for a project
- thread/project titles and durable flags

Typical path:

- contracts schema
- command in `decider.ts`
- read-model update in `projector.ts`
- persistence in projection pipeline

If the value belongs to one project/thread as part of its identity or durable behavior, metadata is usually right.

### 4. Projection/query layer

Use when the value is not just one field on one aggregate, but a derived read concern needed by bootstrap, catalogs, or cross-cutting queries:

- session catalogs
- thread family membership views
- archived-inclusive lists
- query-time joins or derived thread summaries

Typical files:

- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProjectionOperationalQuery.ts`

If you need the server to answer a read question efficiently and consistently, this bucket is usually right.

## Decision Rules

Ask these in order:

1. Should the value survive browser refresh?
2. Should it survive app restart?
3. Should another window or client see the same value?
4. Is it part of one aggregate's durable identity/behavior?
5. Is it a derived multi-aggregate read concern?

Use the first "yes" that meaningfully narrows placement:

- only local UX: browser UI state
- server truth already exists and just needs rendering: web store
- durable per-project/per-thread meaning: aggregate metadata
- derived cross-cutting read model: projection/query layer

## Strong Repo-Specific Rules

- Do not store durable sidebar identity only in `uiStateStore`.
- Do not push temporary hover/expansion state into server metadata.
- Do not make the browser store the source of truth for values the server must answer on bootstrap.
- Do not add projection tables for values that are just local UI preferences.

## Files To Inspect First

```bash
rg -n "uiStateStore|useUiStateStore|projectExpandedById|labelFiltersByProject" apps/web/src
rg -n "currentSessionRootThreadId|sidebarParentProjectId|project.meta.update|thread.meta.update" packages/contracts apps/server/src/orchestration apps/web/src
rg -n "ProjectionSnapshotQuery|ProjectionOperationalQuery|ProjectionPipeline" apps/server/src/orchestration/Layers
rg -n "syncServerReadModel|orchestration.domainEvent" apps/web/src/store.ts apps/web/src/routes/__root.tsx
```

## Fast Heuristics

- "Should this survive refresh?" usually means not local React state.
- "Should every client see the same value?" usually means not browser-only state.
- "Is this a property of a project/thread?" usually means metadata.
- "Is this a query answer assembled from many records?" usually means projection/query.

## Examples

### Good browser UI state

- project row expansion
- active multi-select set
- a temporary add-project input value

### Good metadata

- explicit parent project for sidebar bucketing
- current selected orchestration session root for a project

### Good projection/query concern

- list of all session roots for an orchestrator
- all threads in a session family including archived workers

## Response Pattern

When answering, structure the result in this order:

1. Recommended bucket
2. Why the other buckets are wrong
3. Exact write path
4. Exact read path
5. Migration/query/test implications

## Escalate

- Use `t3-orchestration-trace` when you need to follow a concrete field end-to-end
- Use `t3-settings-workflow` when the state is actually a user preference
- Use `t3-orchestration-sidebar-modeling` when the state question is driven by sidebar structure
