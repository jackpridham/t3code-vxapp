/**
 * Central notification dispatch — reads user preferences, fires toasts.
 *
 * Called outside React (from Zustand store actions), so preferences are read
 * via useUiStateStore.getState() rather than a hook.
 */
import { type ThreadId } from "@t3tools/contracts";
import { openThreadRoute } from "./appNavigation";
import { toastManager } from "./components/ui/toast";
import { useUiStateStore } from "./uiStateStore";
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventType,
  type NotificationLevel,
} from "./notificationSettings";

interface NotificationDispatchOptions {
  threadId?: ThreadId | null;
  projectName?: string | null;
  labels?: readonly string[] | null;
  occurredAt?: string | null;
  detail?: string | null;
}

function formatNotificationTimestamp(occurredAt: string | null | undefined): string {
  if (!occurredAt) {
    return "Time unknown";
  }
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return occurredAt;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function dispatchNotification(
  eventType: NotificationEventType,
  level: NotificationLevel,
  title: string,
  description?: string,
  options: NotificationDispatchOptions = {},
): void {
  const prefs = useUiStateStore.getState().notificationPreferences;
  if (!prefs?.enabled) return;
  if (!prefs.events[eventType]) return;
  const threadId = options.threadId ?? null;
  const notificationLabel = NOTIFICATION_EVENT_LABELS[eventType] ?? title;
  const toastTitle = options.projectName?.trim() || title;
  const labels = (options.labels ?? []).filter((label) => label.trim().length > 0);
  const metadataParts = [formatNotificationTimestamp(options.occurredAt)];
  if (labels.length > 0) {
    metadataParts.push(`Labels: ${labels.join(", ")}`);
  }
  const detail = options.detail?.trim() || description?.trim() || undefined;

  toastManager.add({
    type: level === "error" ? "error" : level === "warning" ? "warning" : "info",
    title: toastTitle,
    description: detail,
    timeout: 0,
    data: {
      targetThreadId: threadId,
      notificationMeta: {
        subtitle: notificationLabel,
        metadataLine: metadataParts.join(" · "),
        ...(detail ? { detail } : {}),
        tooltip: threadId
          ? "Left click to open thread. Right click to dismiss."
          : "Right click to dismiss.",
      },
    },
  });

  // Desktop notification (if enabled and permission granted)
  if (prefs.desktopNotifications && typeof globalThis.Notification !== "undefined") {
    if (Notification.permission === "granted") {
      const bodyLines = [notificationLabel, metadataParts.join(" · "), detail]
        .filter((line) => typeof line === "string" && line.length > 0)
        .join("\n");
      const notification = new Notification(
        toastTitle,
        bodyLines.length > 0 ? { body: bodyLines } : {},
      );
      if (threadId) {
        notification.onclick = () => {
          notification.close();
          globalThis.focus?.();
          openThreadRoute(threadId);
        };
      }
    }
  }
}

export function requestDesktopNotificationPermission(): void {
  if (typeof globalThis.Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
