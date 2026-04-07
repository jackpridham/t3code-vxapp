import { type ThreadId } from "@t3tools/contracts";
import { isElectron } from "./env";
import type { AppRouter } from "./router";

let activeRouter: AppRouter | null = null;

export function registerAppRouter(router: AppRouter): void {
  activeRouter = router;
}

export function navigateToThreadRoute(threadId: ThreadId): boolean {
  if (!activeRouter) {
    return false;
  }

  void activeRouter.navigate({
    to: "/$threadId",
    params: { threadId },
  });
  return true;
}

function buildThreadHref(threadId: ThreadId): string {
  return isElectron ? `#/${threadId}` : `/${threadId}`;
}

export function openThreadRoute(threadId: ThreadId): void {
  if (navigateToThreadRoute(threadId)) {
    return;
  }
  if (typeof globalThis.location === "undefined") {
    return;
  }
  globalThis.location.assign(buildThreadHref(threadId));
}
