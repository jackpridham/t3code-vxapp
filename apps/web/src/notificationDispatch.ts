/**
 * Central notification dispatch — reads user preferences, fires toasts.
 *
 * Called outside React (from Zustand store actions), so preferences are read
 * via useUiStateStore.getState() rather than a hook.
 */
import { toastManager } from "./components/ui/toast";
import { useUiStateStore } from "./uiStateStore";
import type { NotificationEventType, NotificationLevel } from "./notificationSettings";

/** Auto-dismiss delay for notification toasts (ms of visible/focused time). */
const NOTIFICATION_DISMISS_MS = 5_000;

export function dispatchNotification(
  eventType: NotificationEventType,
  level: NotificationLevel,
  title: string,
  description?: string,
): void {
  const prefs = useUiStateStore.getState().notificationPreferences;
  if (!prefs?.enabled) return;
  if (!prefs.events[eventType]) return;

  toastManager.add({
    type: level === "error" ? "error" : level === "warning" ? "warning" : "info",
    title,
    description,
    // Use the visibility-aware dismiss so the timer pauses when the tab is hidden.
    data: { dismissAfterVisibleMs: NOTIFICATION_DISMISS_MS },
  });

  // Desktop notification (if enabled and permission granted)
  if (prefs.desktopNotifications && typeof globalThis.Notification !== "undefined") {
    if (Notification.permission === "granted") {
      new Notification(title, description !== undefined ? { body: description } : {});
    }
  }
}

export function requestDesktopNotificationPermission(): void {
  if (typeof globalThis.Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
