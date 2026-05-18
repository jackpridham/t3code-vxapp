import path from "node:path";

import type { AgentsVxappRoleSessionRuntimePaths } from "./Services/AgentsVxappExternalRoleAuthority.ts";

export interface AgentsVxappWorktreeAuthority {
  readonly runtimePaths: AgentsVxappRoleSessionRuntimePaths | null | undefined;
  readonly authoritativeWorktreePaths?:
    | ReadonlySet<string>
    | ReadonlyArray<string>
    | null
    | undefined;
}

function normalizeComparablePath(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? path.resolve(normalized) : null;
}

function isPathWithinRoot(
  candidatePath: string | null | undefined,
  rootPath: string | null | undefined,
): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  const root = normalizeComparablePath(rootPath);
  if (!candidate || !root) {
    return false;
  }
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isAuthoritativeWorktreePath(
  candidatePath: string | null | undefined,
  authoritativeWorktreePaths:
    | ReadonlySet<string>
    | ReadonlyArray<string>
    | null
    | undefined,
): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  if (!candidate || !authoritativeWorktreePaths) {
    return false;
  }
  const comparablePaths =
    authoritativeWorktreePaths instanceof Set
      ? authoritativeWorktreePaths
      : new Set(authoritativeWorktreePaths);
  for (const authoritativePath of comparablePaths) {
    if (normalizeComparablePath(authoritativePath) === candidate) {
      return true;
    }
  }
  return false;
}

export function isAgentsVxappWorkspaceRoot(
  workspaceRoot: string | null | undefined,
  runtimePaths: AgentsVxappRoleSessionRuntimePaths | null | undefined,
): boolean {
  if (!workspaceRoot || !runtimePaths) {
    return false;
  }
  return (
    isPathWithinRoot(
      workspaceRoot,
      runtimePaths.roles.cto.generatedWorkspaceRoot,
    ) ||
    isPathWithinRoot(
      workspaceRoot,
      runtimePaths.roles.jasper.generatedWorkspaceRoot,
    )
  );
}

export function isAgentsVxappWorktreePath(
  worktreePath: string | null | undefined,
  authority: AgentsVxappWorktreeAuthority | null | undefined,
): boolean {
  if (!worktreePath || !authority) {
    return false;
  }
  return (
    isPathWithinRoot(worktreePath, authority.runtimePaths?.roleSessionsRoot) ||
    isAuthoritativeWorktreePath(
      worktreePath,
      authority.authoritativeWorktreePaths,
    )
  );
}
