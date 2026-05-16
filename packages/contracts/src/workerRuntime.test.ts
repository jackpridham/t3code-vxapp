import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { describe, it } from "vitest";
import { AgentRuntimeSnapshot } from "./agentRuntime";
import {
  WorkerRuntimeContextPlan,
  WorkerRuntimeDispatchContract,
  WorkerRuntimeInstalledPacks,
  WorkerRuntimeInstructionStackAudit,
  WorkerRuntimeSourceFile,
} from "./workerRuntime";

const fixturesRoot = path.resolve(
  import.meta.dirname,
  "../../../apps/web/src/lib/workerRuntime/__fixtures__",
);
const snapshotsRoot = path.join(fixturesRoot, "snapshots");

const decodeEffect = <TSchema extends Schema.Schema<any>>(schema: TSchema) =>
  Schema.decodeUnknownEffect(schema as never) as (
    input: unknown,
  ) => Effect.Effect<Schema.Schema.Type<TSchema>, Schema.SchemaError, never>;

const decodeContextPlan = decodeEffect(WorkerRuntimeContextPlan);
const decodeDispatchContract = decodeEffect(WorkerRuntimeDispatchContract);
const decodeInstalledPacks = decodeEffect(WorkerRuntimeInstalledPacks);
const decodeInstructionStackAudit = decodeEffect(WorkerRuntimeInstructionStackAudit);
const decodeWorkerRuntimeSourceFile = decodeEffect(WorkerRuntimeSourceFile);
const decodeAgentRuntimeSnapshot = decodeEffect(AgentRuntimeSnapshot);

function assertNoForbiddenSchemaLiterals(filePath: string, schemaNames: readonly string[]) {
  const source = fs.readFileSync(filePath, "utf8");

  for (const schemaName of schemaNames) {
    const escaped = schemaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declarationNamePattern = `${escaped}[A-Za-z0-9_]*`;
    const literalPattern = new RegExp(
      `(?:export\\s+)?const\\s+${declarationNamePattern}\\s*=\\s*Schema\\.Literal[s]?\\(`,
      "m",
    );
    assert.ok(
      !literalPattern.test(source),
      `forbidden Schema literal declaration for ${schemaName} or suffixed variants found in ${filePath}`,
    );
    const typeLiteralUnionPattern = new RegExp(
      `(?:export\\s+)?type\\s+${declarationNamePattern}\\s*=\\s*(?!typeof\\b)[^;]*["'][^"']+["'][^;]*;`,
      "m",
    );
    assert.ok(
      !typeLiteralUnionPattern.test(source),
      `forbidden TypeScript literal-union declaration for ${schemaName} or suffixed variants found in ${filePath}`,
    );
    const schemaCastPattern = new RegExp(
      `(?:export\\s+)?const\\s+${declarationNamePattern}\\s*=\\s*.+as\\s+Schema\\.Schema<${escaped}[A-Za-z0-9_]*>`,
      "m",
    );
    assert.ok(
      !schemaCastPattern.test(source),
      `forbidden schema cast declaration for ${schemaName} or suffixed variants found in ${filePath}`,
    );
  }
}

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

  it("accepts owner-defined runtime status and kind strings as transport data", async () => {
    const sourceFile = await Effect.runPromise(
      decodeWorkerRuntimeSourceFile({
        fileName: "context-plan.json",
        absolutePath: "/tmp/context-plan.json",
        status: "runtime-source/custom",
        detail: null,
      }),
    );

    const snapshot = await Effect.runPromise(
      decodeAgentRuntimeSnapshot({
        threadId: "thread-1",
        agentKind: "agent-kind/custom",
        runtimeKind: "snapshot-kind/custom",
        workspaceRoot: null,
        runtimeDir: null,
        workspaceResolution: {
          kind: "workspace-resolution/custom",
          detail: null,
        },
        sourceFiles: [
          {
            key: "context-plan",
            label: "Context Plan",
            fileName: "context-plan.json",
            absolutePath: "/tmp/context-plan.json",
            status: "runtime-source/custom",
            detail: null,
          },
        ],
        summary: {
          repo: "t3code-vxapp",
          role: "worker",
          profile: null,
          taskClass: null,
          contextMode: null,
          closeoutAuthority: null,
          generatedAt: null,
          selectedPacks: [],
          installedSkills: [],
          packCount: 0,
          skillCount: 0,
        },
        workerDetails: {
          validationProfile: null,
          allowedCapabilities: [],
          forbiddenCapabilities: [],
          conflicts: [],
          warnings: [],
          auditStatus: "audit-status/custom",
          auditFindings: [],
          packAuditStatus: null,
          packAuditIssueCount: 0,
          packs: [],
        },
        roleDetails: null,
      }),
    );

    assert.strictEqual(sourceFile.status, "runtime-source/custom");
    assert.strictEqual(snapshot.agentKind, "agent-kind/custom");
    assert.strictEqual(snapshot.runtimeKind, "snapshot-kind/custom");
    assert.strictEqual(snapshot.workspaceResolution.kind, "workspace-resolution/custom");
    assert.strictEqual(snapshot.workerDetails?.auditStatus, "audit-status/custom");
  });

  it("does not define forbidden runtime Schema literal values in workerRuntime.ts", () => {
    assertNoForbiddenSchemaLiterals(path.resolve(import.meta.dirname, "workerRuntime.ts"), [
      "WorkerRuntimeSourceFileStatus",
      "WorkerRuntimeAuditStatus",
    ]);
  });

  it("does not define forbidden runtime Schema literal values in agentRuntime.ts", () => {
    assertNoForbiddenSchemaLiterals(path.resolve(import.meta.dirname, "agentRuntime.ts"), [
      "AgentRuntimeAgentKind",
      "AgentRuntimeSnapshotKind",
      "AgentRuntimeWorkspaceResolutionKind",
    ]);
  });
});
