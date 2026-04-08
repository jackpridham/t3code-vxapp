import { isElectron } from "../env";
import { cleanDiscoveredChangesRawRef } from "./changesPath";
import type { ChangesPanelContentMode } from "../uiStateStore";

export const CHANGES_WINDOW_ROUTE = "/changes/$threadId" as const;

export interface ChangesWindowSearch {
  path?: string | undefined;
  mode?: ChangesPanelContentMode | undefined;
}

export function isChangesWindowPath(pathname: string): boolean {
  return /^\/changes\/[^/]+$/.test(pathname);
}

export function parseChangesWindowSearch(search: Record<string, unknown>): ChangesWindowSearch {
  const path =
    typeof search.path === "string" && search.path.trim().length > 0
      ? cleanDiscoveredChangesRawRef(search.path)
      : undefined;
  const mode = search.mode === "preview" || search.mode === "diff" ? search.mode : undefined;

  return {
    ...(path ? { path } : {}),
    ...(mode ? { mode } : {}),
  };
}

export function buildChangesWindowHref(input: {
  threadId: string;
  path?: string | null | undefined;
  mode?: ChangesPanelContentMode | undefined;
}): string {
  const searchParams = new URLSearchParams();
  if (input.path) {
    searchParams.set("path", cleanDiscoveredChangesRawRef(input.path));
  }
  if (input.mode) {
    searchParams.set("mode", input.mode);
  }

  const route = `/changes/${encodeURIComponent(input.threadId)}`;
  const routeWithSearch = searchParams.size > 0 ? `${route}?${searchParams.toString()}` : route;
  return isElectron ? `#${routeWithSearch}` : routeWithSearch;
}
