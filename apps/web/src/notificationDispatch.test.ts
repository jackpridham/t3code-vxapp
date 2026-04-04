import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the toast manager
const mockAdd = vi.fn();
vi.mock("./components/ui/toast", () => ({
  toastManager: { add: mockAdd },
}));

// Mock uiStateStore
const mockGetState = vi.fn();
vi.mock("./uiStateStore", () => ({
  useUiStateStore: { getState: mockGetState },
}));

import { dispatchNotification } from "./notificationDispatch";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notificationSettings";

describe("dispatchNotification", () => {
  beforeEach(() => {
    mockAdd.mockClear();
    mockGetState.mockReturnValue({
      notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    });
  });

  it("fires toast for enabled event", () => {
    dispatchNotification("turn-completed", "info", "Turn done", "Thread X completed");
    expect(mockAdd).toHaveBeenCalledOnce();
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", title: "Turn done" }),
    );
  });

  it("skips toast when master toggle is off", () => {
    mockGetState.mockReturnValue({
      notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false },
    });
    dispatchNotification("turn-completed", "info", "Turn done");
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("skips toast for disabled event type", () => {
    dispatchNotification("thread-created", "info", "New thread");
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("maps error level to error toast type", () => {
    dispatchNotification("turn-failed", "error", "Failed", "error details");
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("maps warning level to warning toast type", () => {
    dispatchNotification("thread-rate-limited", "warning", "Rate limited");
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
  });

  it("passes description to toast", () => {
    dispatchNotification("turn-completed", "info", "Done", "Some description");
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Done", description: "Some description" }),
    );
  });

  it("includes dismissAfterVisibleMs in toast data", () => {
    dispatchNotification("turn-completed", "info", "Done");
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dismissAfterVisibleMs: expect.any(Number) }),
      }),
    );
  });

  it("handles null notificationPreferences gracefully", () => {
    mockGetState.mockReturnValue({ notificationPreferences: null });
    expect(() => dispatchNotification("turn-completed", "info", "Done")).not.toThrow();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("skips toast for event disabled via events map", () => {
    mockGetState.mockReturnValue({
      notificationPreferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        events: { ...DEFAULT_NOTIFICATION_PREFERENCES.events, "turn-completed": false },
      },
    });
    dispatchNotification("turn-completed", "info", "Done");
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
