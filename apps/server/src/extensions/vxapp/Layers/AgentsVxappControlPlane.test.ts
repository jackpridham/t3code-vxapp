import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockedOwnerRoot = vi.hoisted(() => "/tmp/t3-vxapp-owner-mock");

vi.mock("../agentsVxappSqlite.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../agentsVxappSqlite.ts")>("../agentsVxappSqlite.ts");
  return {
    ...actual,
    AGENTS_VXAPP_ROOT: mockedOwnerRoot,
  };
});

import { AgentsVxappControlPlane } from "../Services/AgentsVxappControlPlane.ts";
import { AgentsVxappControlPlaneLive } from "./AgentsVxappControlPlane.ts";

const OWNER_EXPORT_PATH_ENV = "T3_AGENTS_VXAPP_OWNER_EXPORT_PATH";
const priorOwnerExportPath = process.env[OWNER_EXPORT_PATH_ENV];

afterEach(() => {
  if (priorOwnerExportPath === undefined) {
    delete process.env[OWNER_EXPORT_PATH_ENV];
    return;
  }
  process.env[OWNER_EXPORT_PATH_ENV] = priorOwnerExportPath;
});

describe("AgentsVxappControlPlaneLive", () => {
  const missingExportCases = [
    [
      "bindingAuthority",
      "ownerProjectionAuthority.bindingAuthority.getSnapshot",
      "binding-authority.json",
    ],
    [
      "programAuthority",
      "ownerProjectionAuthority.programAuthority.getSnapshot",
      "program-authority.json",
    ],
    [
      "attentionSummary",
      "ownerProjectionAuthority.attentionSummary.getSnapshot",
      "attention-summary.json",
    ],
    [
      "notificationSummary",
      "ownerProjectionAuthority.notificationSummary.getSnapshot",
      "notification-summary.json",
    ],
    ["watchSummary", "ownerProjectionAuthority.watchSummary.getSnapshot", "watch-summary.json"],
  ] as const;

  for (const [label, operation, filename] of missingExportCases) {
    it(`fails explicitly when ${label} is missing`, async () => {
      const effect = Effect.gen(function* () {
        const controlPlane = yield* AgentsVxappControlPlane;
        switch (label) {
          case "bindingAuthority":
            return yield* controlPlane.getBindingAuthorityExport();
          case "programAuthority":
            return yield* controlPlane.getProgramAuthorityExport();
          case "attentionSummary":
            return yield* controlPlane.getAttentionSummaryExport();
          case "notificationSummary":
            return yield* controlPlane.getNotificationSummaryExport();
          case "watchSummary":
            return yield* controlPlane.getWatchSummaryExport();
        }
      }).pipe(
        Effect.provide(AgentsVxappControlPlaneLive.pipe(Layer.provideMerge(NodeServices.layer))),
      );

      await expect(Effect.runPromise(effect)).rejects.toMatchObject({
        operation,
        detail: expect.stringContaining(filename),
      });
    });
  }

  it("fails explicitly when the compatibility export path is not configured", async () => {
    delete process.env[OWNER_EXPORT_PATH_ENV];

    const effect = Effect.gen(function* () {
      const controlPlane = yield* AgentsVxappControlPlane;
      return yield* controlPlane.getProjectionAuthoritySnapshot();
    }).pipe(
      Effect.provide(AgentsVxappControlPlaneLive.pipe(Layer.provideMerge(NodeServices.layer))),
    );

    await expect(Effect.runPromise(effect)).rejects.toMatchObject({
      operation: "ownerProjectionAuthority.getSnapshot",
      detail: expect.stringContaining(OWNER_EXPORT_PATH_ENV),
    });
  });
});
