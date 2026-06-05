import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentsVxappRepoLink } from "./repo-links.ts";

function writeFileTree(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", "utf8");
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "t3code-dev-links-"));
}

function createRepoFixture(root: string): { repoRoot: string; siblingRoot: string } {
  const repoRoot = resolve(root, "t3code-vxapp");
  const siblingRoot = resolve(root, "agents-vxapp");
  mkdirSync(resolve(repoRoot, ".vx"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".vx/repo-links.yaml"),
    `schemaVersion: 1.0.0
documentKind: vx_repo_links
links:
  agents:
    selector: agents
    requiredEntrypoints:
      - scripts/tools/t3-control-plane-owner
      - scripts/tools/role-session-owner
    envAliases:
      - T3_AGENTS_VXAPP_REPO_ROOT
      - AGENTS_VXAPP_REPO_ROOT
      - VX_AGENTS_REPO_ROOT
    fallbackSibling: false
`,
    "utf8",
  );
  writeFileTree(resolve(siblingRoot, "scripts/tools/t3-control-plane-owner"));
  writeFileTree(resolve(siblingRoot, "scripts/tools/role-session-owner"));
  return { repoRoot, siblingRoot };
}

const cleanupRoots: string[] = [];

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("repo-links helper", () => {
  it("resolves the sibling agents checkout for localized dev when env aliases are unset", () => {
    const root = createWorkspace();
    cleanupRoots.push(root);
    const { repoRoot, siblingRoot } = createRepoFixture(root);

    const link = resolveAgentsVxappRepoLink(repoRoot, {});

    expect(link.root).toBe(siblingRoot);
    expect(link.source).toBe(`sibling:${siblingRoot}`);
    expect(link.envAssignments.T3_AGENTS_VXAPP_REPO_ROOT).toBe(siblingRoot);
    expect(link.envAssignments.AGENTS_VXAPP_REPO_ROOT).toBe(siblingRoot);
    expect(link.envAssignments.VX_AGENTS_REPO_ROOT).toBe(siblingRoot);
  });

  it("fails when configured env aliases disagree", () => {
    const root = createWorkspace();
    cleanupRoots.push(root);
    const { repoRoot } = createRepoFixture(root);

    expect(() =>
      resolveAgentsVxappRepoLink(repoRoot, {
        T3_AGENTS_VXAPP_REPO_ROOT: "/tmp/agents-a",
        AGENTS_VXAPP_REPO_ROOT: "/tmp/agents-b",
      }),
    ).toThrow(/repo-root env aliases disagree/);
  });
});
