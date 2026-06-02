import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER_ENTRYPOINTS = [
  "scripts/tools/t3-control-plane-owner",
  "scripts/tools/role-session-owner",
] as const;
const T3CODE_REPO_ROOT_SENTINELS = ["bun.lock", "apps/server/package.json"] as const;
const ENV_REPO_ROOT_ALIASES = [
  "T3_AGENTS_VXAPP_REPO_ROOT",
  "AGENTS_VXAPP_REPO_ROOT",
  "VX_AGENTS_REPO_ROOT",
] as const;
const REPO_LINKS_CONFIG = ".vx/repo-links.yaml";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function isT3CodeRepoRoot(candidate: string): boolean {
  return T3CODE_REPO_ROOT_SENTINELS.every((relativePath) =>
    fs.existsSync(path.join(candidate, relativePath)),
  );
}

export function resolveT3CodeRepoRoot(fromDir: string): string {
  let candidate = path.resolve(fromDir);

  while (true) {
    if (isT3CodeRepoRoot(candidate)) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Unable to resolve t3code-vxapp repo root from ${fromDir}.`);
    }
    candidate = parent;
  }
}

const T3CODE_REPO_ROOT = resolveT3CodeRepoRoot(MODULE_DIR);

function hasOwnerEntrypoints(repoRoot: string): boolean {
  return OWNER_ENTRYPOINTS.every((relativePath) =>
    fs.existsSync(path.join(repoRoot, relativePath)),
  );
}

function configuredEnvRoots(): Array<{ alias: string; root: string }> {
  return ENV_REPO_ROOT_ALIASES.flatMap((alias) => {
    const value = process.env[alias]?.trim();
    return value ? [{ alias, root: path.resolve(value) }] : [];
  });
}

function repoLinksConfigPath(): string {
  return path.join(T3CODE_REPO_ROOT, REPO_LINKS_CONFIG);
}

function resolveAgentsVxappRepoRoot(): string {
  const repoLinksPath = repoLinksConfigPath();
  if (!fs.existsSync(repoLinksPath)) {
    throw new Error(`Missing agents-vxapp repo-link config at ${repoLinksPath}.`);
  }

  const envRoots = configuredEnvRoots();
  if (envRoots.length === 0) {
    const siblingHint = path.resolve(T3CODE_REPO_ROOT, "../agents-vxapp");
    throw new Error(
      `Unable to resolve agents-vxapp checkout from repo-link config. Set one of ${ENV_REPO_ROOT_ALIASES.join(
        ", ",
      )}; sibling checkout ${siblingHint} is only a repair hint.`,
    );
  }

  const uniqueRoots = new Set(envRoots.map((entry) => entry.root));
  if (uniqueRoots.size > 1) {
    const details = envRoots.map((entry) => `${entry.alias}=${entry.root}`).join(", ");
    throw new Error(`agents-vxapp repo-root env aliases disagree: ${details}.`);
  }

  const resolved = envRoots[0]?.root;
  if (!resolved || !hasOwnerEntrypoints(resolved)) {
    const aliases = envRoots.map((entry) => entry.alias).join(", ");
    throw new Error(`Configured ${aliases} does not point at a valid agents-vxapp checkout.`);
  }

  return resolved;
}

export const AGENTS_VXAPP_REPO_ROOT = resolveAgentsVxappRepoRoot();
