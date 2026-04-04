import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import { dispatchNotification } from "./notificationDispatch";
import { useStore } from "./store";

export interface OrchestrationBatchEffects {
  clearPromotedDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  removeTerminalStateThreadIds: ThreadId[];
  needsProviderInvalidation: boolean;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;

  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed":
      case "thread.reverted": {
        needsProviderInvalidation = true;
        break;
      }

      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
          removeTerminalState: true,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  const clearPromotedDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  const removeTerminalStateThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      clearPromotedDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateThreadIds.push(threadId);
    }
  }

  return {
    clearPromotedDraftThreadIds,
    clearDeletedThreadIds,
    removeTerminalStateThreadIds,
    needsProviderInvalidation,
  };
}

// ── Notification side-effects ────────────────────────────────────────────────

/**
 * Process a batch of orchestration events and fire user notifications.
 * Called from EventRouter AFTER `applyOrchestrationEvents` has updated state.
 */
export function processEventNotifications(events: ReadonlyArray<OrchestrationEvent>): void {
  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed": {
        const threadId = event.payload.threadId;
        const thread = useStore.getState().threads.find((t) => t.id === threadId);
        const threadTitle = thread?.title ?? "Unknown thread";

        if (event.payload.status === "error") {
          dispatchNotification("turn-failed", "error", "Turn Failed", threadTitle);
        } else {
          dispatchNotification("turn-completed", "info", "Turn Completed", threadTitle);
        }
        break;
      }

      case "thread.turn-interrupt-requested": {
        if (event.payload.turnId !== undefined) {
          const threadId = event.payload.threadId;
          const thread = useStore.getState().threads.find((t) => t.id === threadId);
          const threadTitle = thread?.title ?? "Unknown thread";
          dispatchNotification("turn-failed", "warning", "Turn Interrupted", threadTitle);
        }
        break;
      }

      case "thread.created": {
        const title = event.payload.title ?? "Untitled";
        dispatchNotification("thread-created", "info", "Thread Created", title);
        break;
      }

      case "thread.meta-updated": {
        if (event.payload.labels !== undefined) {
          const threadId = event.payload.threadId;
          const thread = useStore.getState().threads.find((t) => t.id === threadId);
          const threadTitle = thread?.title ?? "Unknown thread";
          dispatchNotification("label-changed", "info", "Labels Updated", threadTitle);
        }
        break;
      }

      case "thread.session-set": {
        if (event.payload.session.lastError) {
          const errorMsg =
            typeof event.payload.session.lastError === "string"
              ? event.payload.session.lastError
              : "";
          if (
            errorMsg.toLowerCase().includes("rate") ||
            errorMsg.toLowerCase().includes("limit") ||
            errorMsg.toLowerCase().includes("429")
          ) {
            const threadId = event.payload.threadId;
            const thread = useStore.getState().threads.find((t) => t.id === threadId);
            const threadTitle = thread?.title ?? "Unknown thread";
            dispatchNotification("thread-rate-limited", "warning", "Rate Limited", threadTitle);
          }
        }
        break;
      }

      default:
        break;
    }
  }
}
