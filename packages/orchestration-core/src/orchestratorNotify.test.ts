import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  MAX_NOTIFY_MESSAGE_CHARS,
  formatOrchestratorChatNotification,
  shouldNotifyOrchestratorChatMessage,
  truncateOrchestratorNotifyMessage,
} from "./orchestratorNotify.ts";

const baseThread = {
  title: "Jasper",
  spawnRole: "orchestrator",
} as OrchestrationThread;

const baseMessage = {
  role: "assistant",
  text: "Ready to continue.",
  streaming: false,
} as OrchestrationMessage;

describe("orchestrator notify helpers", () => {
  it("notifies only finalized non-empty assistant messages from orchestrator threads", () => {
    expect(shouldNotifyOrchestratorChatMessage({ thread: baseThread, message: baseMessage })).toBe(
      true,
    );

    expect(
      shouldNotifyOrchestratorChatMessage({
        thread: { ...baseThread, spawnRole: "worker" } as OrchestrationThread,
        message: baseMessage,
      }),
    ).toBe(false);

    expect(
      shouldNotifyOrchestratorChatMessage({
        thread: baseThread,
        message: { ...baseMessage, role: "user" } as OrchestrationMessage,
      }),
    ).toBe(false);

    expect(
      shouldNotifyOrchestratorChatMessage({
        thread: baseThread,
        message: { ...baseMessage, role: "system" } as OrchestrationMessage,
      }),
    ).toBe(false);

    expect(
      shouldNotifyOrchestratorChatMessage({
        thread: baseThread,
        message: { ...baseMessage, streaming: true } as OrchestrationMessage,
      }),
    ).toBe(false);

    expect(
      shouldNotifyOrchestratorChatMessage({
        thread: baseThread,
        message: { ...baseMessage, text: "   " } as OrchestrationMessage,
      }),
    ).toBe(false);
  });

  it("formats and bounds notification text", () => {
    expect(formatOrchestratorChatNotification({ thread: baseThread, message: baseMessage })).toBe(
      "Orchestrator: Jasper\n\nReady to continue.",
    );

    const body = formatOrchestratorChatNotification({
      thread: baseThread,
      message: { ...baseMessage, text: "x".repeat(4_000) } as OrchestrationMessage,
    });

    expect(body.length).toBeLessThanOrEqual(3_500);
    expect(body).toContain("[message truncated by T3 Code]");
  });

  it("trims title and message text and falls back for untitled orchestrators", () => {
    expect(
      formatOrchestratorChatNotification({
        thread: { title: "   " },
        message: { text: "  Ready.  " },
      }),
    ).toBe("Orchestrator\n\nReady.");

    expect(
      formatOrchestratorChatNotification({
        thread: { title: "  Jasper CTO  " },
        message: { text: "\n\nDecision needed.\n" },
      }),
    ).toBe("Orchestrator: Jasper CTO\n\nDecision needed.");
  });

  it("leaves boundary-sized notification text unchanged and truncates only overflow", () => {
    const exact = "x".repeat(MAX_NOTIFY_MESSAGE_CHARS);
    expect(truncateOrchestratorNotifyMessage(exact)).toBe(exact);

    const overflow = `${exact}y`;
    const truncated = truncateOrchestratorNotifyMessage(overflow);
    expect(truncated).toHaveLength(MAX_NOTIFY_MESSAGE_CHARS);
    expect(truncated.endsWith("[message truncated by T3 Code]")).toBe(true);
    expect(truncated.startsWith("x".repeat(MAX_NOTIFY_MESSAGE_CHARS - 32))).toBe(true);
  });
});
