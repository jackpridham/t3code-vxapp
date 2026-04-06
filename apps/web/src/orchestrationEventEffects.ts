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
    const state = useStore.getState();
    const resolveThreadContext = (threadId: ThreadId) => {
      const thread = state.threads.find((entry) => entry.id === threadId);
      const project = thread
        ? state.projects.find((entry) => entry.id === thread.projectId)
        : undefined;
      return {
        thread,
        projectName: project?.name ?? "Unknown project",
        labels: thread?.labels ?? [],
      };
    };

    switch (event.type) {
      case "thread.turn-diff-completed": {
        const threadId = event.payload.threadId;
        const context = resolveThreadContext(threadId);

        if (event.payload.status === "error") {
          dispatchNotification("turn-failed", "error", "Turn Failed", undefined, {
            threadId,
            projectName: context.projectName,
            labels: context.labels,
            occurredAt: event.payload.completedAt,
          });
        } else {
          dispatchNotification("turn-completed", "info", "Turn Completed", undefined, {
            threadId,
            projectName: context.projectName,
            labels: context.labels,
            occurredAt: event.payload.completedAt,
          });
        }
        break;
      }

      case "thread.turn-interrupt-requested": {
        if (event.payload.turnId !== undefined) {
          const threadId = event.payload.threadId;
          const context = resolveThreadContext(threadId);
          dispatchNotification("turn-failed", "warning", "Turn Interrupted", undefined, {
            threadId,
            projectName: context.projectName,
            labels: context.labels,
            occurredAt: event.occurredAt,
          });
        }
        break;
      }

      case "thread.created": {
        const state = useStore.getState();
        const project = state.projects.find((entry) => entry.id === event.payload.projectId);
        dispatchNotification("thread-created", "info", "Thread Created", undefined, {
          threadId: event.payload.threadId,
          projectName: project?.name ?? "Unknown project",
          labels:
            "labels" in event.payload && Array.isArray(event.payload.labels)
              ? event.payload.labels
              : [],
          occurredAt: event.payload.createdAt,
        });
        break;
      }

      case "thread.meta-updated": {
        if (event.payload.labels !== undefined) {
          const threadId = event.payload.threadId;
          const context = resolveThreadContext(threadId);
          dispatchNotification("label-changed", "info", "Labels Updated", undefined, {
            threadId,
            projectName: context.projectName,
            labels: event.payload.labels,
            occurredAt: event.payload.updatedAt,
          });
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
            const context = resolveThreadContext(threadId);
            dispatchNotification("thread-rate-limited", "warning", "Rate Limited", undefined, {
              threadId,
              projectName: context.projectName,
              labels: context.labels,
              occurredAt: event.payload.session.updatedAt,
              detail: errorMsg,
            });
          }
        }
        break;
      }

      case "thread.activity-appended": {
        if (
          event.payload.activity.tone === "error" &&
          /hook/i.test(event.payload.activity.kind)
        ) {
          const context = resolveThreadContext(event.payload.threadId);
          dispatchNotification(
            "hook-failure",
            "error",
            "Hook failed",
            undefined,
            {
              threadId: event.payload.threadId,
              projectName: context.projectName,
              labels: context.labels,
              occurredAt: event.payload.activity.createdAt,
              detail: event.payload.activity.summary,
            },
          );
        }
        break;
      }

      default:
        break;
    }
  }
}
