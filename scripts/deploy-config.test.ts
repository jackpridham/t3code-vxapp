import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseYaml } from "./perf/yaml.ts";

const repoRoot = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Phase 05 deploy config", () => {
  it("declares deploy and toolchain pointers in the repo contract", () => {
    const contract = read(".vx-config.yaml");

    expect(contract).toContain("  config: .vx/deploy.yaml");
    expect(contract).toContain("  toolchain: .vx/toolchain.yaml");
  });

  it("uses command lookup defaults with only env-based absolute overrides", () => {
    const toolchain = parseYaml(read(".vx/toolchain.yaml")) as {
      tools: Record<string, { env: string; default: string }>;
      path: { prependFromTools: unknown[] };
    };

    expect(toolchain.tools.bun).toEqual({ env: "BUN_BIN", default: "bun" });
    expect(toolchain.tools.node).toEqual({ env: "NODE_BIN", default: "node" });
    expect(toolchain.tools.vx).toEqual({ env: "VX_BIN", default: "vx" });
    expect(toolchain.path.prependFromTools).toEqual([]);
  });

  it("removes committed absolute tool defaults and fixed PATH from deploy.sh", () => {
    const deployScript = read("deploy.sh");

    expect(deployScript).not.toContain("/home/gizmo/.bun/bin/bun");
    expect(deployScript).not.toContain("/usr/bin/node");
    expect(deployScript).not.toContain("/home/gizmo/vortex-scripts/bin/vx");
    expect(deployScript).not.toContain(
      "/home/gizmo/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(deployScript).toContain(
      'BUN_BIN="${BUN_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" bun default)}"',
    );
    expect(deployScript).toContain(
      'NODE_BIN="${NODE_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" node default)}"',
    );
    expect(deployScript).toContain(
      'VX_BIN="${VX_BIN:-$(yaml_tool_value "$TOOLCHAIN_CONFIG" vx default)}"',
    );
  });
});
