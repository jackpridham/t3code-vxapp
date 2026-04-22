import { ProgramNotificationId, ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  acknowledgeCtoAttentionItem,
  dropCtoAttentionItem,
  projectCtoAttentionFromProgramNotification,
  selectOperationalCtoAttentionItems,
  selectSnapshotCtoAttentionItems,
  sortCtoAttentionItems,
  updateCtoAttentionItemByNotificationId,
  upsertCtoAttentionItemByKey,
  type ProgramNotificationCtoAttentionInput,
} from "./ctoAttention.ts";

const now = "2026-04-22T00:00:00.000Z";

function notificationInput(
  overrides: Partial<ProgramNotificationCtoAttentionInput> = {},
): ProgramNotificationCtoAttentionInput {
  return {
    notificationId: ProgramNotificationId.makeUnsafe("notification-1"),
    programId: ProgramId.makeUnsafe("program-1"),
    executiveProjectId: ProjectId.makeUnsafe("project-cto"),
    executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
    orchestratorThreadId: ThreadId.makeUnsafe("thread-orchestrator"),
    kind: "blocked",
    severity: "critical",
    summary: "Worker is blocked",
    evidence: { workerThreadId: ThreadId.makeUnsafe("thread-worker") },
    state: "pending",
    queuedAt: now,
    deliveredAt: null,
    consumedAt: null,
    droppedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("cto attention projection helpers", () => {
  it("projects actionable program notifications into CTO attention items", () => {
    const item = projectCtoAttentionFromProgramNotification(notificationInput());

    expect(item).toMatchObject({
      notificationId: ProgramNotificationId.makeUnsafe("notification-1"),
      programId: ProgramId.makeUnsafe("program-1"),
      executiveProjectId: ProjectId.makeUnsafe("project-cto"),
      executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
      sourceThreadId: ThreadId.makeUnsafe("thread-worker"),
      sourceRole: "worker",
      kind: "blocked",
      state: "required",
      severity: "critical",
      summary: "Worker is blocked",
    });
  });

  it("filters passive notification kinds and maps legacy aliases", () => {
    expect(
      projectCtoAttentionFromProgramNotification(
        notificationInput({ kind: "worker_progress", notificationId: "passive-notification" }),
      ),
    ).toBeNull();

    const aliased = projectCtoAttentionFromProgramNotification(
      notificationInput({ kind: "closeout_ready", notificationId: "alias-notification" }),
    );
    expect(aliased).toMatchObject({
      kind: "final_review_ready",
      state: "required",
    });
  });

  it("derives source fallback and terminal states from notification state", () => {
    const consumed = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "consumed-notification",
        evidence: {},
        state: "consumed",
        consumedAt: "2026-04-22T00:01:00.000Z",
      }),
    );
    expect(consumed).toMatchObject({
      sourceThreadId: ThreadId.makeUnsafe("thread-orchestrator"),
      sourceRole: "orchestrator",
      state: "acknowledged",
      acknowledgedAt: "2026-04-22T00:01:00.000Z",
    });

    const dropped = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "dropped-notification",
        state: "dropped",
        droppedAt: "2026-04-22T00:02:00.000Z",
      }),
    );
    expect(dropped).toMatchObject({
      state: "dropped",
      droppedAt: "2026-04-22T00:02:00.000Z",
    });
  });

  it("upserts, acknowledges, drops, and orders attention items", () => {
    const later = "2026-04-22T00:00:01.000Z";
    const item = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: ProgramNotificationId.makeUnsafe("notification-2"),
        kind: "decision_required",
        severity: "warning",
        summary: "Needs a decision",
      }),
    );

    expect(item).not.toBeNull();
    const acknowledged = acknowledgeCtoAttentionItem(item!, later, later);
    const dropped = dropCtoAttentionItem(acknowledged, later, later);
    const items = upsertCtoAttentionItemByKey([item!], dropped);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      attentionKey: item!.attentionKey,
      state: "dropped",
      acknowledgedAt: later,
      droppedAt: later,
    });
    expect(selectOperationalCtoAttentionItems(items)).toEqual(items);
  });

  it("updates items by notification id without touching unrelated items", () => {
    const first = projectCtoAttentionFromProgramNotification(
      notificationInput({ notificationId: "notification-first" }),
    )!;
    const second = projectCtoAttentionFromProgramNotification(
      notificationInput({ notificationId: "notification-second" }),
    )!;
    const updated = updateCtoAttentionItemByNotificationId(
      [first, second],
      "notification-second",
      (item) => acknowledgeCtoAttentionItem(item, "2026-04-22T00:03:00.000Z", item.updatedAt),
    );

    expect(updated[0]).toBe(first);
    expect(updated[1]).toMatchObject({
      notificationId: ProgramNotificationId.makeUnsafe("notification-second"),
      state: "acknowledged",
      acknowledgedAt: "2026-04-22T00:03:00.000Z",
    });
  });

  it("sorts snapshots deterministically and keeps all required operational items", () => {
    const requiredOld = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "required-old",
        updatedAt: "2026-04-22T00:00:01.000Z",
      }),
    )!;
    const requiredNew = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "required-new",
        updatedAt: "2026-04-22T00:00:03.000Z",
      }),
    )!;
    const droppedNewest = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "dropped-newest",
        state: "dropped",
        droppedAt: "2026-04-22T00:00:04.000Z",
        updatedAt: "2026-04-22T00:00:04.000Z",
      }),
    )!;
    const acknowledgedMiddle = projectCtoAttentionFromProgramNotification(
      notificationInput({
        notificationId: "acknowledged-middle",
        state: "consumed",
        consumedAt: "2026-04-22T00:00:02.000Z",
        updatedAt: "2026-04-22T00:00:02.000Z",
      }),
    )!;

    expect(
      sortCtoAttentionItems([requiredOld, droppedNewest, requiredNew]).map(
        (item) => item.notificationId,
      ),
    ).toEqual([
      ProgramNotificationId.makeUnsafe("dropped-newest"),
      ProgramNotificationId.makeUnsafe("required-new"),
      ProgramNotificationId.makeUnsafe("required-old"),
    ]);
    expect(selectSnapshotCtoAttentionItems([requiredOld, requiredNew])).toEqual([
      requiredNew,
      requiredOld,
    ]);
    expect(
      selectOperationalCtoAttentionItems(
        [droppedNewest, acknowledgedMiddle, requiredOld, requiredNew],
        1,
      ).map((item) => item.notificationId),
    ).toEqual([
      ProgramNotificationId.makeUnsafe("required-new"),
      ProgramNotificationId.makeUnsafe("required-old"),
      ProgramNotificationId.makeUnsafe("dropped-newest"),
    ]);
  });
});
