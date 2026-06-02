import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseYaml } from "./perf/yaml.ts";

const repoRoot = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("Phase 05 dev-state config", () => {
  it("declares the dev-state pointer and labels seed DB authority dev_only", () => {
    const contract = read(".vx-config.yaml");
    const config = parseYaml(read(".vx/dev-state.yaml")) as {
      t3Home: { env: string; default: string };
      agentsRepo: { selector: string };
      retention: { default: number };
      seedDb: { enabled: boolean; authority: string };
    };

    expect(contract).toContain("devState:");
    expect(contract).toContain("  config: .vx/dev-state.yaml");
    expect(config.t3Home).toEqual({ env: "T3CODE_HOME", default: "~/.t3" });
    expect(config.agentsRepo.selector).toBe("agents");
    expect(config.retention.default).toBe(5);
    expect(config.seedDb).toEqual({ enabled: true, authority: "dev_only" });
  });

  it("resolves seed defaults from config and repo links instead of a hardcoded agents checkout", () => {
    const source = read("scripts/seed-dev-db.py");

    expect(source).toContain("load_dev_state_config()");
    expect(source).toContain("REPO_LINKS_CONFIG_PATH");
    expect(source).not.toContain('Path.home() / "agents-vxapp"');
  });
});
