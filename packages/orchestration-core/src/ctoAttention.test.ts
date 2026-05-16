import {
  CtoAttentionId,
  ProgramNotificationId,
  ProgramId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  projectCtoAttentionFromProgramNotification,
  selectOperationalCtoAttentionItems,
  selectSnapshotCtoAttentionItems,
  sortCtoAttentionItems,
  type ProgramNotificationCtoAttentionInput,
} from "./ctoAttention.ts";

const now = "2026-04-22T00:00:00.000Z";

function notificationInput(): ProgramNotificationCtoAttentionInput {
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
  };
}

describe("cto attention projection boundary", () => {
  it("does not derive current CTO attention from local Program notifications", () => {
    expect(projectCtoAttentionFromProgramNotification(notificationInput())).toBeNull();
  });

  it("keeps residual selectors as pass-through ordering helpers for owner-provided items", () => {
    const requiredOld = {
      attentionId: CtoAttentionId.makeUnsafe("attention-old"),
      attentionKey: "attention-old",
      notificationId: ProgramNotificationId.makeUnsafe("notification-old"),
      programId: ProgramId.makeUnsafe("program-1"),
      executiveProjectId: ProjectId.makeUnsafe("project-cto"),
      executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
      sourceThreadId: null,
      sourceRole: null,
      kind: "blocked",
      severity: "critical",
      summary: "Old",
      evidence: {},
      state: "required",
      queuedAt: now,
      acknowledgedAt: null,
      resolvedAt: null,
      droppedAt: null,
      createdAt: now,
      updatedAt: "2026-04-22T00:00:01.000Z",
    } as const;
    const droppedNew = {
      ...requiredOld,
      attentionId: CtoAttentionId.makeUnsafe("attention-new"),
      attentionKey: "attention-new",
      notificationId: ProgramNotificationId.makeUnsafe("notification-new"),
      state: "dropped",
      droppedAt: "2026-04-22T00:00:02.000Z",
      updatedAt: "2026-04-22T00:00:02.000Z",
    } as const;

    expect(
      sortCtoAttentionItems([requiredOld, droppedNew]).map((item) => item.attentionId),
    ).toEqual([
      CtoAttentionId.makeUnsafe("attention-new"),
      CtoAttentionId.makeUnsafe("attention-old"),
    ]);
    expect(selectSnapshotCtoAttentionItems([requiredOld])).toEqual([requiredOld]);
    expect(selectOperationalCtoAttentionItems([droppedNew, requiredOld], 0)).toEqual([requiredOld]);
  });
});
