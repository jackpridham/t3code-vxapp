# Smooth Executive Thread UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the executive thread load and stream smoothly by removing duplicate direct-thread hydration and cutting avoidable full-thread recomputation during active turns.

**Architecture:** Keep server transport behavior unchanged and fix the remaining slowness in the web app. Direct `/threadId` bootstrap should fetch targeted thread detail once, then merge bootstrap summary data without re-reading the same thread. Chat rendering should stop paying full-array work for hidden activity kinds and user-message revert bookkeeping should derive from message order instead of rescanning the mixed timeline.

**Tech Stack:** React, TanStack Router, TanStack Virtual, Zustand store, Vitest, Bun

---

### Task 1: Remove duplicate direct-thread hydration

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`
- Test: `apps/web/src/routes/__root.test.tsx`

- [ ] Update `bootstrapOrchestrationState` so a successful direct-thread targeted hydration applies thread detail first, then applies `getBootstrapSummary()` directly instead of calling `loadPreferredThreadDetailReadModel(routeThreadId, summary)` a second time.
- [ ] Preserve the existing fallback behavior when targeted hydration fails or summary enrichment fails.
- [ ] Add a regression test proving a routed thread only triggers one targeted message/activity load on bootstrap while summary still applies.

### Task 2: Cut hidden-activity derive churn

**Files:**

- Modify: `apps/web/src/session-logic.ts`
- Test: `apps/web/src/session-logic.test.ts`

- [ ] Extract a small visibility predicate for work-log activities and filter before sorting so hidden kinds such as `context-window.updated`, `tool.started`, and `task.*` do not force full visible work-log rebuild cost.
- [ ] Keep the visible work-log output exactly the same for supported activity kinds.
- [ ] Add tests proving hidden kinds do not change visible work-log output while normal tool rows still render.

### Task 3: Replace timeline-scan revert bookkeeping with message-order bookkeeping

**Files:**

- Modify: `apps/web/src/session-logic.ts`
- Modify: `apps/web/src/components/ChatView.tsx`
- Test: `apps/web/src/session-logic.test.ts`

- [ ] Add a helper that derives `revertTurnCountByUserMessageId` from ordered chat messages plus turn-diff summaries, without scanning the mixed `timelineEntries` array.
- [ ] Switch `ChatView` to use that helper so assistant chunk updates no longer trigger O(n²) timeline rescans.
- [ ] Add focused tests covering the first assistant-after-user match and checkpoint-turn fallback behavior.

### Task 4: Reduce active-turn timer churn in chat render

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`
- Test: `apps/web/src/components/chat/MessagesTimeline.test.tsx`

- [ ] Move the running-turn timer dependency out of `ChatView` so the parent chat view does not rerender once per second during active turns.
- [ ] Keep elapsed-time labels working for the active assistant row and working indicator.
- [ ] Add a focused rendering test that still shows streaming/working duration text without requiring parent-provided `nowIso`.

### Task 5: Validate on live route and repo gates

**Files:**

- Modify: none

- [ ] Rebuild the served web assets before route verification if needed.
- [ ] Re-prove the executive route in Playwright by checking websocket outbound tags and incoming assistant chunk cadence on `http://127.0.0.1:7421/thread-7c791bde830a`.
- [ ] Run targeted Vitest for touched suites, then run `bun fmt`, `bun lint`, and `bun typecheck`.
