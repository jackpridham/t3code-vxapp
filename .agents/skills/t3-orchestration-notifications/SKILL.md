---
name: t3-orchestration-notifications
description: "Trace, explain, add, or debug T3 Code orchestration notifications, especially the sidebar's Program notifications panel, CTO Attention, program.notification-* events, notification persistence, and the boundary between orchestration notifications vs browser/user toasts. Use this whenever the user asks what a sidebar notification means, why a notification appeared or is missing, why something went to CTO Attention instead of Program notifications, where a program notification is stored, how notification state changes, or how notification kinds map into the sidebar."
allowed-tools: Read, Grep, Bash
---

# T3 Orchestration Notifications

Use this skill when the question is about orchestration-visible notifications in T3 Code.

This area is easy to misread because the repo has several different notification systems:

- `Program notifications` in the sidebar
- `CTO Attention` items in the sidebar
- browser/native user notifications and in-app toasts
- orchestrator wake items

Do not treat these as the same subsystem.

The repo currently has two different source systems that can affect what users
call “orchestration notifications”:

- orchestration projection persistence and eventing, which still define the
  underlying program-notification records and actionable kinds
- `agents-vxapp` owner-backed sidebar authority, which is now the semantic
  source for VX sidebar, Program dialogs, Project sidebar summaries, and the
  dev orchestration menu context in the web app

Do not explain one layer using the other.

## Source Of Truth

Start with these files:

- `packages/contracts/src/orchestration.ts`
- `packages/shared/src/ctoAttention.ts`
- `packages/orchestration-core/src/projector.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/persistence/Services/ProjectionProgramNotifications.ts`
- `apps/web/src/agentsVxappStore.ts`
- `apps/web/src/lib/agentsVxappStoreBridge.ts`
- `apps/web/src/store.ts`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/sidebar/ProgramNotificationsPanel.tsx`
- `apps/web/src/components/sidebar/CtoAttentionPanel.tsx`
- `apps/server/src/extensions/vxapp/agentsVxappOwnerClient.ts`
- `apps/server/src/extensions/vxapp/Layers/AgentsVxappControlPlane.ts`
- `apps/web/src/components/vx/OrchestrationSidebar.tsx`
- `apps/web/src/components/ProjectSidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/orchestrationEventEffects.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`

## Mental Model

### 1. Program notifications

Program notifications are durable orchestration records attached to a `Program`.

They are stored and projected as explicit read-model data, not inferred from thread state and not transient UI toasts.

Typical kinds include:

- `worker_started`
- `worker_progress`
- `worker_completed`
- `routine_status`
- `test_retry`
- `implementation_progress`
- `status_update`
- `milestone_completed`

These are the main "status feed" for program-level orchestration work.

### 2. CTO Attention

CTO Attention is the actionable subset of program notifications.

Kinds like these are treated as executive/actionable:

- `decision_required`
- `blocked`
- `risk_escalated`
- `founder_update_required`
- `final_review_ready`
- `program_completed`

These should usually appear in the CTO Attention panel, not the passive Program notifications panel.

### 3. Browser/user notifications

Browser notifications, desktop notifications, and in-app user notifications are a different feature.

Those are driven by web notification settings and runtime-side notification effects, not by the sidebar Program notifications panel directly.

If the question sounds like "why did I get a toast?" or "why didn't desktop notifications fire?", check the browser notification path, not the sidebar projection path.

### 4. Orchestrator wake items

Wake items are worker-to-orchestrator callback records.

They are not program notifications, even if both happen around worker completion.

Use the wake flow skill if the real question is about resuming the orchestrator after worker work completes.

## Default Workflow

### 1. Identify which notification system the user means

Classify the question first:

- sidebar Program notifications panel
- sidebar CTO Attention panel
- VX orchestration sidebar / Program dialogs
- browser/native notification
- wake-item / orchestrator resume behavior

If the user says "notification" loosely, resolve this ambiguity before tracing behavior.

### 2. Check the contract and kinds

Start here:

```bash
rg -n "OrchestrationProgramNotificationKind|OrchestrationCtoAttentionKind|OrchestrationProgramNotificationState|ProgramNotificationEvidence" packages/contracts/src/orchestration.ts
rg -n "CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS|CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS|isCtoActionableProgramNotificationKind" packages/shared/src/ctoAttention.ts
```

This tells you:

- which kinds exist
- which ones are actionable vs passive
- which states matter: `pending`, `delivering`, `delivered`, `consumed`, `dropped`

### 3. Trace server write and persistence

Use these searches:

```bash
rg -n "program.notification-upserted|program.notification-consumed|program.notification-dropped" packages/orchestration-core/src/projector.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
rg -n "ProjectionProgramNotification|projection_program_notifications" apps/server/src/persistence apps/server/src/orchestration/Layers
```

Answer these questions:

- where the notification record is upserted
- when state changes to `consumed` or `dropped`
- whether the notification is persisted in `projection_program_notifications`

### 4. Trace snapshot/bootstrap read path

Use:

```bash
rg -n "programNotifications|ctoAttentionItems" apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts apps/server/src/orchestration/Layers/ProjectionBootstrapSummaryQuery.ts
rg -n "sidebar_authority_snapshot|t3code-sidebar-authority-snapshot|notifications|attentionItems|openWakes" apps/server/src/extensions/vxapp apps/server/src/wsServer.ts
```

This separates:

- how persisted projection rows are surfaced in orchestration snapshots
- how owner-backed notification, attention, and wake truth is fetched for VX
  surfaces

### 5. Trace browser projection and panel selection

Use:

```bash
rg -n "useAgentsVxappStore|programCards|notifications|attentionItems|openWakes" apps/web/src/agentsVxappStore.ts apps/web/src/lib/agentsVxappStoreBridge.ts apps/web/src/components
rg -n "buildSidebarProgramNotificationGroups|buildSidebarCtoAttentionGroups|ProgramNotificationsPanel|CtoAttentionPanel" apps/web/src/components
rg -n "program.notification-upserted|program.notification-consumed|program.notification-dropped" apps/web/src/store.ts
```

This is the critical boundary for current sidebar behavior:

- `agentsVxappStore.ts` is the semantic source for VX/sidebar-program owner
  reads
- `Sidebar.logic.ts` still decides how grouped notification and attention items
  are presented
- the panel components only render what the grouping logic gives them

For VX surfaces, use a different boundary:

- `agentsVxappOwnerClient.ts` and the vxapp extension layers fetch owner-backed
  notification/attention/wake truth
- `agentsVxappStoreBridge.ts` normalizes that payload
- `apps/web/src/components/vx/OrchestrationSidebar.tsx`,
  `ProjectSidebar.tsx`, `ProgramsTodosView.tsx`, and `ChatView.tsx` should read
  that owner truth via `useAgentsVxappStore(...)`

## What The Sidebar Actually Shows

Program notifications panel:

- shows notifications grouped by `programId`
- orders by severity and recency
- only shows non-actionable program notifications
- only shows notifications still in active states like `pending` or `delivering`

CTO Attention panel:

- shows actionable items derived from program notifications
- focuses on `required` attention state instead of passive status feed behavior

If a user asks "why didn't this notification show in Program notifications?", first check whether the kind is actionable and therefore surfaced in CTO Attention instead.

## Fast Verification Commands

```bash
rg -n "ProgramNotificationsPanel|CtoAttentionPanel" apps/web/src/components
rg -n "buildSidebarProgramNotificationGroups|buildSidebarCtoAttentionGroups" apps/web/src/components/Sidebar.logic.ts
rg -n "useAgentsVxappStore|programCards|notifications|attentionItems|openWakes" apps/web/src/agentsVxappStore.ts apps/web/src/components
rg -n "program.notification-upserted|program.notification-consumed|program.notification-dropped" apps/web/src/store.ts packages/orchestration-core/src/projector.ts apps/server/src/orchestration/Layers/ProjectionPipeline.ts
rg -n "notificationSupported|Desktop notifications|Enable notifications|orchestrationEventEffects" apps/web/src/components/settings/SettingsPanels.tsx apps/web/src/orchestrationEventEffects.ts
```

## Common Questions This Skill Should Answer

- What are the Program notifications in the sidebar?
- Why did this item appear in CTO Attention instead of Program notifications?
- Why is a notification missing from the sidebar?
- Where are program notifications persisted?
- Why does a notification stay pending or disappear?
- Why did I get a toast even though the sidebar looks different?
- Why did worker completion create a sidebar item but not wake the orchestrator?

## Footguns

- Do not confuse `programNotifications` with browser notification preferences.
- Do not explain VX sidebar notification or attention behavior from
  `store.programNotifications` or `store.ctoAttentionItems` when the feature is
  actually owner-backed through `agentsVxappStore`.
- Do not assume `server.getAgentsVxappSidebarGraph` or
  `getAgentsVxappControlPlaneSnapshot` are valid semantic read paths for current
  VX notification UI.
- Do not assume `delivered` means "visible in the Program notifications panel"; the panel logic may only show active states.
- Do not assume worker completion implies a wake-item problem or vice versa.
- Do not explain CTO Attention as a separate source system; it is largely derived from actionable program notifications.
- Do not start in the web UI if the real issue is missing persistence or projection writes.
- Do not start in persistence if the bug is only panel filtering or label rendering.

## Response Pattern

When answering, structure the result in this order:

1. which notification system the question is about
2. source of truth
3. write/persistence path
4. browser/sidebar path
5. the concrete reason it appears, is filtered, or changes panel

## Escalate

- Use `t3-orchestration-trace` when one specific field or event must be followed end-to-end.
- Use `t3-provider-runtime-ingestion-map` when the question begins with provider/runtime output and ends with notification creation.
- Use `t3-orchestrator-wake-flow` when the real issue is orchestrator wake delivery rather than sidebar notification display.
