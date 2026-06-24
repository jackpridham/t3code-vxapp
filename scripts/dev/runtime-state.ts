import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import type { DevMode } from "../dev-runner.ts";

export interface DevServerState {
  readonly schemaVersion: "1.0.0";
  readonly workspace: string;
  readonly workspaceKey: string;
  readonly mode: DevMode;
  readonly pid: number;
  readonly bindHost: string;
  readonly publicHost: string;
  readonly serverPort: number;
  readonly webPort: number;
  readonly serverUrl: string;
  readonly serverHealthUrl: string;
  readonly webUrl: string | null;
  readonly primaryUrl: string;
  readonly log: string;
  readonly branch: string | null;
  readonly owner: string | null;
  readonly startedAt: string;
  readonly registry: string;
}

export function workspaceKey(workspace: string): string {
  return createHash("sha1").update(workspace).digest("hex").slice(0, 12);
}

export function registryRoot(): string {
  return join(tmpdir(), "t3code-vxapp-dev-server");
}

export function stateDir(workspace: string): string {
  return join(registryRoot(), workspaceKey(workspace));
}

export function metadataFile(workspace: string): string {
  return join(stateDir(workspace), "server.json");
}

export function logFile(workspace: string): string {
  return join(stateDir(workspace), "server.log");
}

export function ensureStateDir(workspace: string): string {
  const dir = stateDir(workspace);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function isPidRunning(pid: number | null | undefined): boolean {
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
    return false;
  }
  try {
    process.kill(pid!, 0);
    return true;
  } catch {
    return false;
  }
}

export function readState(workspace: string): DevServerState | null {
  const file = metadataFile(workspace);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as DevServerState;
  } catch {
    return null;
  }
}

export function writeState(state: DevServerState): void {
  ensureStateDir(state.workspace);
  writeFileSync(metadataFile(state.workspace), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearState(workspace: string): void {
  rmSync(metadataFile(workspace), { force: true });
}

export function clearStaleState(workspace: string): DevServerState | null {
  const state = readState(workspace);
  if (!state) {
    return null;
  }
  if (isPidRunning(state.pid)) {
    return state;
  }
  clearState(workspace);
  return null;
}

export function currentBranch(workspace: string): string | null {
  try {
    const branch = execFileSync("git", ["-C", workspace, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

export function linkedWorktrees(projectRoot: string): string[] {
  try {
    const output = execFileSync("git", ["-C", projectRoot, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const worktrees = output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter(Boolean);
    return worktrees.length > 0 ? worktrees : [projectRoot];
  } catch {
    return [projectRoot];
  }
}
