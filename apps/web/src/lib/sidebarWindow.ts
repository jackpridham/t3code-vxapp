import type { ThreadId } from "@t3tools/contracts";

export const SIDEBAR_WINDOW_ROUTE = "/sidebar" as const;
export const SIDEBAR_WINDOW_THREAD_ROUTE = "/sidebar/$threadId" as const;

export function isSidebarWindowPath(pathname: string): boolean {
  return pathname === SIDEBAR_WINDOW_ROUTE || pathname.startsWith(`${SIDEBAR_WINDOW_ROUTE}/`);
}

export function resolveThreadRouteTarget(pathname: string, threadId: ThreadId) {
  if (isSidebarWindowPath(pathname)) {
    return {
      to: SIDEBAR_WINDOW_THREAD_ROUTE,
      params: { threadId },
    } as const;
  }

  return {
    to: "/$threadId",
    params: { threadId },
  } as const;
}
