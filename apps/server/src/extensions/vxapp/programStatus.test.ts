import { describe, expect, it } from "vitest";
import {
  hydrateProgramSnapshotFromCloseoutFile,
  readLifecycleStatusFromCloseout,
  resolveProgramCurrentStatus,
} from "./programStatus";

describe("programStatus", () => {
  it("prefers closeout lifecycle status over stale projection status", () => {
    expect(
      resolveProgramCurrentStatus({
        closeout: {
          lifecycle: {
            status: "blocked",
          },
        },
        currentStatus: "active",
        status: "active",
      }),
    ).toBe("blocked");
  });

  it("falls back to currentStatus then base status when closeout is absent", () => {
    expect(
      resolveProgramCurrentStatus({
        currentStatus: "awaiting_external",
        status: "active",
      }),
    ).toBe("awaiting_external");

    expect(
      resolveProgramCurrentStatus({
        status: "active",
      }),
    ).toBe("active");
  });

  it("returns null for malformed closeout lifecycle payloads", () => {
    expect(readLifecycleStatusFromCloseout(null)).toBeNull();
    expect(readLifecycleStatusFromCloseout({ lifecycle: { status: "" } })).toBeNull();
    expect(readLifecycleStatusFromCloseout({ lifecycle: [] })).toBeNull();
  });

  it("hydrates Program status from the fresher closeout file when owner data is stale", async () => {
    const hydrated = await hydrateProgramSnapshotFromCloseoutFile(
      {
        id: "program-1",
        status: "active",
        currentStatus: "active",
        currentOrchestratorThreadId: "orch-stale",
        closeout: {
          lifecycle: {
            status: "active",
          },
        },
        metadata: {
          closeoutPath: "/tmp/program-1.json",
        },
      },
      async () =>
        JSON.stringify({
          currentOrchestratorThreadId: "orch-fresh",
          lifecycle: {
            status: "blocked",
          },
          updatedAt: "2026-05-10T10:00:00.000Z",
        }),
    );

    expect(hydrated.currentStatus).toBe("blocked");
    expect(hydrated.status).toBe("blocked");
    expect(hydrated.currentOrchestratorThreadId).toBe("orch-fresh");
    expect(hydrated.closeout).toEqual({
      currentOrchestratorThreadId: "orch-fresh",
      lifecycle: {
        status: "blocked",
      },
      updatedAt: "2026-05-10T10:00:00.000Z",
    });
  });
});
