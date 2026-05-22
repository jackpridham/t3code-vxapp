import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serverSrcRoot = resolve(here, "../..");
const ownerClientPath = resolve(serverSrcRoot, "extensions/vxapp/agentsVxappOwnerClient.ts");
const repoRootPath = resolve(serverSrcRoot, "extensions/vxapp/agentsVxappRepoRoot.ts");
const ownerProcessPath = ["scripts", "tools", "t3-control-plane-owner"].join("/");

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir).flatMap((entry) => {
    const fullPath = resolve(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      return listSourceFiles(fullPath);
    }
    const isSourceFile = extname(fullPath) === ".ts" || extname(fullPath) === ".tsx";
    return isSourceFile && !fullPath.endsWith(".test.ts") ? [fullPath] : [];
  });
  return entries;
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(serverSrcRoot, relativePath), "utf8");
}

describe("provider harness boundary", () => {
  it("keeps the owner process path isolated to agentsVxappOwnerClient.ts", () => {
    const matches = listSourceFiles(serverSrcRoot).filter(
      (filePath) =>
        filePath !== repoRootPath && readFileSync(filePath, "utf8").includes(ownerProcessPath),
    );

    expect(matches).toEqual([ownerClientPath]);
  });

  it("routes provider-harness owner interactions through the vxapp bridge helpers", () => {
    const ingestionSource = readSource("orchestration/Layers/ProviderRuntimeIngestion.ts");
    const reactorSource = readSource("orchestration/Layers/ProviderCommandReactor.ts");

    expect(ingestionSource).toContain('from "../../extensions/vxapp/providerHarnessBridge.ts"');
    expect(ingestionSource).toContain("requestAgentsVxappApprovalRequest");
    expect(ingestionSource).toContain("requestAgentsVxappThreadEventIngest");
    expect(ingestionSource).toContain("requestAgentsVxappThreadStatus");

    expect(reactorSource).toContain('from "../../extensions/vxapp/providerHarnessBridge.ts"');
    expect(reactorSource).toContain("requestAgentsVxappApprovalResponse");
    expect(reactorSource).toContain("requestAgentsVxappUserInputResponse");

    expect(ingestionSource).not.toContain(ownerProcessPath);
    expect(reactorSource).not.toContain(ownerProcessPath);
  });

  it("keeps ProviderSessionRuntime confined to process plumbing instead of request truth authority", () => {
    const ingestionSource = readSource("orchestration/Layers/ProviderRuntimeIngestion.ts");
    const reactorSource = readSource("orchestration/Layers/ProviderCommandReactor.ts");

    expect(ingestionSource).not.toContain("ProjectionPendingApproval");
    expect(reactorSource).not.toContain("ProjectionPendingApproval");
    expect(ingestionSource).not.toContain("pendingApprovals");
    expect(reactorSource).not.toContain("pendingApprovals");
    expect(ingestionSource).not.toContain("pendingUserInputs");
    expect(reactorSource).not.toContain("pendingUserInputs");
    expect(ingestionSource).not.toContain("threadStatusByThreadId");
    expect(reactorSource).not.toContain("threadStatusByThreadId");
  });

  it("keeps CTO provider request transport owner-backed and fail-closed", () => {
    const ownerClientSource = readSource("extensions/vxapp/agentsVxappOwnerClient.ts");
    const reactorSource = readSource("orchestration/Layers/ProviderCommandReactor.ts");

    expect(ownerClientSource).toContain("requestAgentsVxappCtoProviderRequest");
    expect(reactorSource).toContain('record.kind !== "thread.turn.start"');
    expect(reactorSource).toContain("Owner provider request failed closed");
    expect(reactorSource).not.toContain("vx t3 cto operate --once --json");
  });

  it("keeps Phase 08 thread lifecycle provider transport owner-backed and fail-closed", () => {
    const ownerClientSource = readSource("extensions/vxapp/agentsVxappOwnerClient.ts");
    const reactorSource = readSource("orchestration/Layers/ProviderCommandReactor.ts");

    expect(ownerClientSource).toContain("requestAgentsVxappThreadLifecycleProviderRequest");
    for (const kind of [
      "thread_create",
      "thread_turn_start",
      "thread_turn_interrupt",
      "thread_session_stop",
      "thread_revert",
      "thread_archive",
      "thread_delete",
      "thread_lineage_update",
    ]) {
      expect(ownerClientSource).toContain(kind);
    }
    expect(ownerClientSource).toContain("Owner lifecycle payload used a legacy fallback");
    expect(ownerClientSource).toContain("Owner lifecycle payload is missing providerRequest");
    expect(ownerClientSource).toContain("Owner lifecycle providerRequest is malformed");
    expect(reactorSource).not.toContain("build_thread_start_request");
    expect(reactorSource).not.toContain("buildThreadLifecycleProviderRequest");
  });
});
