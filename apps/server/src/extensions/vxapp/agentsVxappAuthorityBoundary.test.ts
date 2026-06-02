import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const vxappServerRoot = path.resolve(import.meta.dirname, "../../..");
const ownerClientPath = path.resolve(import.meta.dirname, "agentsVxappOwnerClient.ts");
const ownerClientConfigPath = path.resolve(
  import.meta.dirname,
  "../../../../..",
  ".vx/runtime/owner-client.yaml",
);
const controlPlaneLayerPath = path.resolve(
  import.meta.dirname,
  "Layers/AgentsVxappControlPlane.ts",
);
const repoRootPath = path.resolve(import.meta.dirname, "agentsVxappRepoRoot.ts");
const ownerClientSource = fs.readFileSync(ownerClientPath, "utf8");
const ownerClientConfigSource = fs.readFileSync(ownerClientConfigPath, "utf8");
const controlPlaneLayerSource = fs.readFileSync(controlPlaneLayerPath, "utf8");

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFiles(absolutePath);
    }
    return entry.isFile() && absolutePath.endsWith(".ts") ? [absolutePath] : [];
  });
}

describe("agents-vxapp owner authority boundary", () => {
  it("centralizes vxapp owner process routes in agentsVxappOwnerClient.ts", () => {
    const offenders = listTsFiles(vxappServerRoot)
      .filter((filePath) => !filePath.endsWith(".test.ts"))
      .filter((filePath) => path.resolve(filePath) !== ownerClientPath)
      .filter((filePath) => path.resolve(filePath) !== repoRootPath)
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        const matches = [
          "scripts/tools/t3-control-plane-owner",
          "scripts/tools/role-session-owner",
          "--compatibility-mode",
        ].filter((needle) => source.includes(needle));
        return matches.map((needle) => ({ filePath, needle }));
      });

    expect(offenders).toEqual([]);
  });

  it("keeps owner command literals and the bootstrap manifest route centralized in the owner client", () => {
    expect(ownerClientConfigSource).toContain("command: t3code-contract-manifest");
    expect(ownerClientSource).toContain("config.manifestCommand");
    expect(ownerClientSource).toContain("t3code-thread-status");
    expect(ownerClientSource).toContain("t3code-thread-event-ingest");
    expect(ownerClientSource).toContain("t3code-projects-event-ingest");
    expect(ownerClientSource).toContain("t3code-approval-request");
    expect(ownerClientSource).toContain("t3code-approval-respond");
    expect(ownerClientSource).toContain("t3code-user-input-respond");
    expect(ownerClientSource).not.toContain("t3code-cto-status");
    expect(ownerClientSource).not.toContain("t3code-projects-list");
    expect(ownerClientSource).not.toContain("t3code-worker-dispatch");
    expect(ownerClientSource).not.toContain("t3code-provider-ws-request");

    const offenders = listTsFiles(vxappServerRoot)
      .filter((filePath) => !filePath.endsWith(".test.ts"))
      .filter((filePath) => path.resolve(filePath) !== ownerClientPath)
      .filter((filePath) => /["']t3code-[a-z0-9-]+["']/.test(fs.readFileSync(filePath, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("rejects object-shaped owner manifest fallback paths in the owner client", () => {
    expect(ownerClientSource).not.toContain("root?.commands");
    expect(ownerClientSource).not.toContain("root?.ownerCommands");
    expect(ownerClientSource).toContain("Owner manifest must provide ownerCommandManifest[]");
    expect(ownerClientSource).toContain("Owner manifest must provide callerContractManifest[]");
  });

  it("routes all TODO owner actions through manifest wrapper key todo_mutate", () => {
    expect(ownerClientSource).toContain('const TODO_MUTATE_WRAPPER_KEY = "todo_mutate"');
    expect(ownerClientSource).toContain("commandsByWrapperKey");
    expect(ownerClientSource).toContain("callManifestCommandByWrapperKey");
    expect(ownerClientSource).not.toContain(
      'callManifestCommand<ServerAgentsVxappOwnerMutationResult>("todos", input)',
    );

    for (const action of [
      "create",
      "update",
      "delete",
      "show",
      "list",
      "recent",
      "search",
      "current",
      "link_plan",
      "unlink_plan",
    ]) {
      expect(ownerClientSource).toContain(`"${action}"`);
    }
  });

  it("does not fall back from owner-backed TODO snapshots to projection data", () => {
    const todosSnapshotStart = controlPlaneLayerSource.indexOf("getProgramsTodosSnapshot:");
    const todosSnapshotEnd = controlPlaneLayerSource.indexOf("createProgram: (input) =>");

    expect(todosSnapshotStart).toBeGreaterThanOrEqual(0);
    expect(todosSnapshotEnd).toBeGreaterThan(todosSnapshotStart);

    const todosSnapshotBlock = controlPlaneLayerSource.slice(todosSnapshotStart, todosSnapshotEnd);
    expect(todosSnapshotBlock).toContain("fetchAgentsVxappProgramsTodosSnapshot(input)");
    expect(todosSnapshotBlock).not.toContain("fetchAgentsVxappProgramsProjectionSnapshot()");
    expect(todosSnapshotBlock).toContain(
      'ownerPromise("ownerControlPlane.programsTodos.getProgramsTodosSnapshot", () =>',
    );
  });
});
