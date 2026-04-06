import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the toast manager
const { mockAdd, mockGetState, mockLocationAssign } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockGetState: vi.fn(),
  mockLocationAssign: vi.fn(),
}));

vi.mock("./components/ui/toast", () => ({
  toastManager: { add: mockAdd },
}));

// Mock uiStateStore
vi.mock("./uiStateStore", () => ({
  useUiStateStore: { getState: mockGetState },
}));

const { mockOpenThreadRoute } = vi.hoisted(() => ({
  mockOpenThreadRoute: vi.fn(),
}));

vi.mock("./appNavigation", () => ({
  openThreadRoute: mockOpenThreadRoute,
}));

import { dispatchNotification } from "./notificationDispatch";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notificationSettings";

describe("dispatchNotification", () => {
  beforeEach(() => {
    mockAdd.mockClear();
    mockLocationAssign.mockClear();
    mockOpenThreadRoute.mockReset();
    mockGetState.mockReturnValue({
      notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    });
    vi.stubGlobal(
      "location",
      Object.assign(new URL("http://localhost:5733/"), { assign: mockLocationAssign }),
    );
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
      expect.objectContaining({
        title: "Done",
        description: "Some description",
        data: expect.objectContaining({
          notificationMeta: expect.objectContaining({
            subtitle: "Turn Completed",
            detail: "Some description",
          }),
        }),
      }),
    );
  });

  it("creates persistent notification toasts", () => {
    dispatchNotification("turn-completed", "info", "Done");
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 0,
        data: expect.objectContaining({ targetThreadId: null }),
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

  it("adds thread targeting and notification metadata for thread-scoped notifications", () => {
    const threadId = ThreadId.makeUnsafe("thread-123");

    dispatchNotification("turn-completed", "info", "Turn Completed", undefined, {
      threadId,
      projectName: "VX App",
      occurredAt: "2026-04-06T04:00:00.000Z",
      labels: ["prod", "urgent"],
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "VX App",
        data: expect.objectContaining({
          targetThreadId: threadId,
          notificationMeta: expect.objectContaining({
            subtitle: "Turn Completed",
            metadataLine: expect.stringContaining("Labels: prod, urgent"),
            tooltip: "Left click to open thread. Right click to dismiss.",
          }),
        }),
      }),
    );
  });

  it("does not attach an explicit action button to notification toasts", () => {
    dispatchNotification("turn-completed", "info", "Turn Completed", undefined, {
      threadId: ThreadId.makeUnsafe("thread-123"),
      projectName: "VX App",
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.not.objectContaining({
        actionProps: expect.anything(),
      }),
    );
  });
});
