import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER_ENTRYPOINTS = [
  "scripts/tools/t3-control-plane-owner",
  "scripts/tools/role-session-owner",
] as const;
const ENV_REPO_ROOT = "T3_AGENTS_VXAPP_REPO_ROOT";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const T3CODE_REPO_ROOT = path.resolve(MODULE_DIR, "../../../../..");

function hasOwnerEntrypoints(repoRoot: string): boolean {
  return OWNER_ENTRYPOINTS.every((relativePath) =>
    fs.existsSync(path.join(repoRoot, relativePath)),
  );
}

function resolveAgentsVxappRepoRoot(): string {
  const explicitRoot = process.env[ENV_REPO_ROOT]?.trim();
  if (explicitRoot) {
    const resolved = path.resolve(explicitRoot);
    if (!hasOwnerEntrypoints(resolved)) {
      throw new Error(
        `Configured ${ENV_REPO_ROOT} does not point at a valid agents-vxapp checkout.`,
      );
    }
    return resolved;
  }

  const siblingRoot = path.resolve(T3CODE_REPO_ROOT, "../agents-vxapp");
  if (hasOwnerEntrypoints(siblingRoot)) {
    return siblingRoot;
  }

  throw new Error(
    `Unable to resolve agents-vxapp checkout. Set ${ENV_REPO_ROOT} or place agents-vxapp beside t3code-vxapp.`,
  );
}

export const AGENTS_VXAPP_REPO_ROOT = resolveAgentsVxappRepoRoot();
