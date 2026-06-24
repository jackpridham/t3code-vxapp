# Direct Thread Hydration Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the second targeted hydration pass on direct `/threadId` bootstrap while preserving bootstrap summary global state and correct orchestrator-session detail loading.

**Architecture:** Keep the route bootstrap flow responsible for sequencing targeted thread hydration and bootstrap summary enrichment. Move any missing direct-thread mode detection into the targeted hydration helper so the first direct-thread fetch can load orchestrator-session detail when needed, then let bootstrap summary merge as a normal partial read model.

**Tech Stack:** React, TanStack Router, TypeScript, Vitest, Bun

---

### Task 1: Route Bootstrap Dedup

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`
- Test: `apps/web/src/routes/__root.test.tsx`

- [ ] **Step 1: Update the direct-route bootstrap branch**

Replace the second `loadPreferredThreadDetailReadModel(routeThreadId, summary)` call with a plain bootstrap-summary apply after the targeted route thread has already been applied.

- [ ] **Step 2: Verify the routed-thread bootstrap test covers the new contract**

Assert that direct `/threadId` bootstrap still requests bootstrap summary, but only performs one targeted message/history fetch for the routed thread.

### Task 2: Direct Thread Mode Detection

**Files:**

- Modify: `apps/web/src/lib/orchestrationCurrentStateHydration.ts`
- Test: `apps/web/src/lib/orchestrationCurrentStateHydration.test.ts`

- [ ] **Step 1: Resolve actual targeted hydration mode from fetched thread summaries**

Allow the initial targeted helper path to upgrade from `thread` to `orchestrator-session` when the routed thread summary indicates an orchestrator root, so the first load remains complete without a second targeted pass.

- [ ] **Step 2: Add a focused helper test**

Cover the case where `loadTargetedThreadDetailReadModel` starts from `baseReadModel: null` for an orchestrator root and still loads worker checkpoint detail in a single pass.

### Task 3: Validation

**Files:**

- No code changes

- [ ] **Step 1: Run focused tests**

Run the relevant Vitest files for the route bootstrap and hydration helper.

- [ ] **Step 2: Run repo validation**

Run `bun fmt`, `bun lint`, and `bun typecheck`.
