# Chat Streaming Render Churn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep active executive-thread assistant streaming smooth by avoiding full timeline rebuilds and timer-driven rerenders on every chunk.

**Architecture:** Reuse unchanged timeline entry objects in `session-logic`, derive revert metadata from messages instead of the mixed timeline, and reconcile `MessagesTimeline` rows so unchanged rows keep stable references. Move live elapsed-time updates into row-local components so the full chat tree does not rerender once per second during active turns.

**Tech Stack:** React, TypeScript, Zustand, Vitest, TanStack Virtual

---

### Task 1: Timeline Derivation Reuse

**Files:**

- Modify: `apps/web/src/session-logic.ts`
- Test: `apps/web/src/session-logic.test.ts`

- [ ] Add a timeline-entry reuse path that preserves object identity for unchanged messages, work entries, and proposed plans while keeping chronological ordering.
- [ ] Add a focused unit test that changes only the active assistant message and asserts unchanged timeline entries are reused by reference.
- [ ] Add a focused unit test for linear revert-count derivation from message order plus turn-diff summaries.

### Task 2: ChatView Timeline Inputs

**Files:**

- Modify: `apps/web/src/components/ChatView.tsx`

- [ ] Cache previous timeline entries in `ChatView` and call the reuse-aware `deriveTimelineEntries` path.
- [ ] Replace the current `timelineEntries`-based revert scan with the linear message-based helper so streaming chunks do not rescan the mixed timeline.
- [ ] Remove the top-level once-per-second `nowTick` state from `ChatView` so active-turn timers stop forcing the full chat view to rerender.

### Task 3: MessagesTimeline Row Reconciliation

**Files:**

- Modify: `apps/web/src/components/chat/MessagesTimeline.tsx`
- Test: `apps/web/src/components/chat/MessagesTimeline.test.tsx`

- [ ] Reconcile rows by id and payload reference so unchanged user, assistant, work, and plan rows retain stable objects across assistant chunks.
- [ ] Memoize row rendering behind a dedicated row component so unchanged rows skip rerender work even when the parent timeline component receives new props.
- [ ] Move live elapsed-time rendering for the active assistant row and working indicator into row-local timer components with their own interval state.
- [ ] Add a focused render test that covers timeline output with the updated props shape and keeps existing behavior intact.

### Task 4: Validation

**Files:**

- Modify: none

- [ ] Run targeted Vitest coverage for the changed web tests.
- [ ] Run `bun fmt`.
- [ ] Run `bun lint`.
- [ ] Run `bun typecheck`.
