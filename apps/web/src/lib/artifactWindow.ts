import { isElectron } from "../env";

export const ARTIFACT_WINDOW_ROUTE = "/artifact" as const;

export interface ArtifactWindowSearch {
  path: string;
  worktree?: string | undefined;
}

export function isArtifactWindowPath(pathname: string): boolean {
  return pathname === ARTIFACT_WINDOW_ROUTE;
}

export function parseArtifactWindowSearch(search: Record<string, unknown>): ArtifactWindowSearch {
  const path = typeof search.path === "string" ? search.path.trim() : "";
  const worktree =
    typeof search.worktree === "string" && search.worktree.trim().length > 0
      ? search.worktree.trim()
      : undefined;

  if (path.length === 0) {
    throw new Error("Artifact path is required.");
  }

  return worktree ? { path, worktree } : { path };
}

export function buildArtifactWindowHref(input: {
  path: string;
  worktreePath?: string | null | undefined;
}): string {
  const searchParams = new URLSearchParams({ path: input.path });
  if (input.worktreePath) {
    searchParams.set("worktree", input.worktreePath);
  }

  const routeWithSearch = `${ARTIFACT_WINDOW_ROUTE}?${searchParams.toString()}`;
  return isElectron ? `#${routeWithSearch}` : routeWithSearch;
}
