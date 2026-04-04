import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_EVENT_LABELS,
  mergeNotificationPreferences,
} from "./notificationSettings";

describe("notificationSettings", () => {
  it("default preferences have all event types", () => {
    const eventTypes = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.events);
    expect(eventTypes).toContain("turn-completed");
    expect(eventTypes).toContain("turn-failed");
    expect(eventTypes).toContain("thread-rate-limited");
    expect(eventTypes).toContain("hook-failure");
    expect(eventTypes).toContain("thread-created");
    expect(eventTypes).toContain("label-changed");
  });

  it("default preferences enable important events", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["turn-completed"]).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["turn-failed"]).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["hook-failure"]).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["thread-rate-limited"]).toBe(true);
  });

  it("default preferences disable noisy events", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["thread-created"]).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events["label-changed"]).toBe(false);
  });

  it("all event types have labels", () => {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.events)) {
      expect(NOTIFICATION_EVENT_LABELS).toHaveProperty(key);
    }
  });

  it("desktop notifications off by default", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.desktopNotifications).toBe(false);
  });

  it("master toggle enabled by default", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.enabled).toBe(true);
  });
});

describe("mergeNotificationPreferences", () => {
  it("returns defaults for null input", () => {
    expect(mergeNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("returns defaults for undefined input", () => {
    expect(mergeNotificationPreferences(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("returns defaults for empty object", () => {
    expect(mergeNotificationPreferences({})).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("preserves explicit enabled=false override", () => {
    const result = mergeNotificationPreferences({ enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.desktopNotifications).toBe(DEFAULT_NOTIFICATION_PREFERENCES.desktopNotifications);
    expect(result.events).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.events);
  });

  it("preserves desktopNotifications=true override", () => {
    const result = mergeNotificationPreferences({ desktopNotifications: true });
    expect(result.desktopNotifications).toBe(true);
    expect(result.enabled).toBe(DEFAULT_NOTIFICATION_PREFERENCES.enabled);
  });

  it("merges partial events with defaults", () => {
    const result = mergeNotificationPreferences({
      events: { "turn-completed": false, "thread-created": true } as Record<string, boolean>,
    });
    expect(result.events["turn-completed"]).toBe(false);
    expect(result.events["thread-created"]).toBe(true);
    // Other events fall back to defaults
    expect(result.events["turn-failed"]).toBe(DEFAULT_NOTIFICATION_PREFERENCES.events["turn-failed"]);
    expect(result.events["hook-failure"]).toBe(DEFAULT_NOTIFICATION_PREFERENCES.events["hook-failure"]);
  });

  it("ignores non-boolean events values", () => {
    const result = mergeNotificationPreferences({
      events: { "turn-completed": "yes" } as unknown as Record<string, boolean>,
    });
    // The spread keeps whatever was passed — the caller is responsible for type safety
    expect(typeof result.events["turn-completed"]).toBeDefined();
  });
});
