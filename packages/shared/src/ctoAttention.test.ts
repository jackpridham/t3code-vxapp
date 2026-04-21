import { describe, expect, it } from "vitest";

import {
  CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS,
  CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS,
  LEGACY_CTO_ACTIONABLE_NOTIFICATION_KIND_ALIASES,
  buildCtoAttentionKey,
  deriveCtoAttentionStateFromProgramNotificationState,
  extractCtoAttentionSource,
  isCtoActionableProgramNotificationKind,
  isCtoPassiveProgramNotificationKind,
  toCtoAttentionKind,
} from "./ctoAttention";

describe("cto attention helpers", () => {
  it("classifies actionable, passive, and legacy notification kinds", () => {
    expect(CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS).toEqual([
      "decision_required",
      "blocked",
      "risk_escalated",
      "founder_update_required",
      "final_review_ready",
      "program_completed",
    ]);
    expect(CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS).toEqual([
      "worker_started",
      "worker_progress",
      "worker_completed",
      "routine_status",
      "test_retry",
      "implementation_progress",
      "status_update",
    ]);
    expect(LEGACY_CTO_ACTIONABLE_NOTIFICATION_KIND_ALIASES).toEqual({
      closeout_ready: "final_review_ready",
    });

    for (const kind of CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS) {
      expect(isCtoActionableProgramNotificationKind(kind)).toBe(true);
      expect(toCtoAttentionKind(kind)).toBe(kind);
    }

    for (const kind of CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS) {
      expect(isCtoActionableProgramNotificationKind(kind)).toBe(false);
      expect(isCtoPassiveProgramNotificationKind(kind)).toBe(true);
      expect(toCtoAttentionKind(kind)).toBeNull();
    }

    expect(toCtoAttentionKind("closeout_ready")).toBe("final_review_ready");
    expect(isCtoActionableProgramNotificationKind("closeout_ready")).toBe(true);
  });

  it("maps program notification lifecycle states to CTO attention states", () => {
    expect(deriveCtoAttentionStateFromProgramNotificationState("pending")).toBe("required");
    expect(deriveCtoAttentionStateFromProgramNotificationState("delivering")).toBe("required");
    expect(deriveCtoAttentionStateFromProgramNotificationState("delivered")).toBe("required");
    expect(deriveCtoAttentionStateFromProgramNotificationState("consumed")).toBe("acknowledged");
    expect(deriveCtoAttentionStateFromProgramNotificationState("dropped")).toBe("dropped");
  });

  it("extracts source details from evidence and falls back to the orchestrator thread", () => {
    expect(
      extractCtoAttentionSource(
        {
          workerThreadId: "thread-worker",
        },
        "thread-jasper",
      ),
    ).toEqual({
      sourceThreadId: "thread-worker",
      sourceRole: "worker",
    });

    expect(extractCtoAttentionSource(null, "thread-jasper")).toEqual({
      sourceThreadId: "thread-jasper",
      sourceRole: "orchestrator",
    });
  });

  it("builds a stable key with normalized kind and correlation fallback", () => {
    const sharedInput = {
      programId: "program-cto",
      kind: "closeout_ready",
      sourceThreadId: "thread-worker",
      sourceRole: "worker",
      evidence: { correlationId: "corr-1" },
    } as const;

    const firstKey = buildCtoAttentionKey(sharedInput);
    const secondKey = buildCtoAttentionKey(sharedInput);

    expect(firstKey).toBe(secondKey);
    expect(firstKey).toContain("program:program-cto");
    expect(firstKey).toContain("kind:final_review_ready");
    expect(firstKey).toContain("source-thread:thread-worker");
    expect(firstKey).toContain("source-role:worker");
    expect(firstKey).toContain("correlation:corr-1");

    const notificationFallbackKey = buildCtoAttentionKey({
      programId: "program-cto",
      kind: "final_review_ready",
      notificationId: "notif-1",
    });
    expect(notificationFallbackKey).toContain("correlation:notif-1");
  });
});
