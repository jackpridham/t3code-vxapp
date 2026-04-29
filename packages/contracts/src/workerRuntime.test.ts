import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { describe, it } from "vitest";
import {
  WorkerRuntimeContextPlan,
  WorkerRuntimeDispatchContract,
  WorkerRuntimeInstalledPacks,
  WorkerRuntimeInstructionStackAudit,
} from "./workerRuntime";

const fixturesRoot = path.resolve(
  import.meta.dirname,
  "../../../apps/web/src/lib/workerRuntime/__fixtures__",
);
const snapshotsRoot = path.join(fixturesRoot, "snapshots");

const decodeContextPlan = Schema.decodeUnknownEffect(WorkerRuntimeContextPlan);
const decodeDispatchContract = Schema.decodeUnknownEffect(WorkerRuntimeDispatchContract);
const decodeInstalledPacks = Schema.decodeUnknownEffect(WorkerRuntimeInstalledPacks);
const decodeInstructionStackAudit = Schema.decodeUnknownEffect(WorkerRuntimeInstructionStackAudit);

describe("workerRuntime fixtures", () => {
  it("decode every committed runtime fixture snapshot", async () => {
    const fixtureIds = fs.readdirSync(snapshotsRoot).toSorted();
    assert.ok(fixtureIds.length > 0);

    for (const fixtureId of fixtureIds) {
      const fixtureDir = path.join(snapshotsRoot, fixtureId);
      const contextPlan = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, "context-plan.json"), "utf8"),
      );
      const dispatchContract = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, "dispatch-contract.json"), "utf8"),
      );
      const installedPacks = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, "installed-packs.json"), "utf8"),
      );
      const instructionStackAudit = JSON.parse(
        fs.readFileSync(path.join(fixtureDir, "instruction-stack-audit.json"), "utf8"),
      );

      await Effect.runPromise(decodeContextPlan(contextPlan));
      await Effect.runPromise(decodeDispatchContract(dispatchContract));
      await Effect.runPromise(decodeInstalledPacks(installedPacks));
      await Effect.runPromise(decodeInstructionStackAudit(instructionStackAudit));
    }
  });

  it("keep fixture paths redacted and preserve status variety", () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(fixturesRoot, "catalog.json"), "utf8"),
    ) as {
      sourceRoot: string;
      fixtures: Array<{ auditStatus: string | null }>;
    };
    const statuses = new Set(catalog.fixtures.map((fixture) => fixture.auditStatus));

    assert.equal(catalog.sourceRoot, "~/worktrees");
    assert.ok(statuses.has("clean"));
    assert.ok(statuses.has("warning"));
    assert.ok(statuses.has("error"));

    const sampleContextPlan = fs.readFileSync(
      path.join(snapshotsRoot, "partymore-vue-order-create-admin-parity-p1", "context-plan.json"),
      "utf8",
    );
    assert.ok(
      sampleContextPlan.includes("/fixtures/worktrees/partymore-vue-order-create-admin-parity-p1"),
    );
    assert.ok(!sampleContextPlan.includes("/home/gizmo/worktrees"));
  });
});
