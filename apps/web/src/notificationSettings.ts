/**
 * Notification event types and user preferences.
 * Persisted via uiStateStore.
 */

export type NotificationEventType =
  | "turn-completed" // Agent turn finished (any thread)
  | "turn-failed" // Agent turn errored
  | "thread-rate-limited" // Thread hit provider rate limit
  | "hook-failure" // Project hook execution failed
  | "thread-created" // New thread dispatched (by orchestrator)
  | "label-changed"; // Thread labels updated

export type NotificationLevel = "info" | "warning" | "error";

export interface NotificationPreferences {
  enabled: boolean; // Master toggle
  events: Record<NotificationEventType, boolean>;
  desktopNotifications: boolean; // Browser Notification API
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  events: {
    "turn-completed": true,
    "turn-failed": true,
    "thread-rate-limited": true,
    "hook-failure": true,
    "thread-created": false, // Noisy for orchestrators, off by default
    "label-changed": false, // Off by default
  },
  desktopNotifications: false,
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  "turn-completed": "Turn Completed",
  "turn-failed": "Turn Failed",
  "thread-rate-limited": "Rate Limited",
  "hook-failure": "Hook Failure",
  "thread-created": "Thread Created",
  "label-changed": "Label Changed",
};

export const NOTIFICATION_EVENT_DESCRIPTIONS: Record<NotificationEventType, string> = {
  "turn-completed": "Notify when an agent turn finishes successfully",
  "turn-failed": "Notify when an agent turn errors or is interrupted",
  "thread-rate-limited": "Notify when a thread hits a provider rate limit",
  "hook-failure": "Notify when a project hook fails to execute",
  "thread-created": "Notify when a new thread is created (noisy for orchestrators)",
  "label-changed": "Notify when thread labels are updated",
};

/**
 * Merges partial persisted notification preferences with defaults.
 * Ensures fields missing from storage fall back gracefully.
 */
export function mergeNotificationPreferences(
  raw: Partial<NotificationPreferences> | undefined | null,
): NotificationPreferences {
  if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    enabled:
      typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_NOTIFICATION_PREFERENCES.enabled,
    desktopNotifications:
      typeof raw.desktopNotifications === "boolean"
        ? raw.desktopNotifications
        : DEFAULT_NOTIFICATION_PREFERENCES.desktopNotifications,
    events: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.events,
      ...(raw.events && typeof raw.events === "object" ? raw.events : {}),
    },
  };
}
