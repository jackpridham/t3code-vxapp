import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  formatOrchestratorChatNotification,
  shouldNotifyOrchestratorChatMessage,
} from "./orchestratorNotify.ts";

const baseThread = {
  id: "thread-1",
  title: "Jasper",
  labels: [],
  modelSelection: { provider: "codex", model: "gpt-5.4", reasoningEffort: "medium" },
  runtimeMode: "shell",
  interactionMode: "streaming",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-14T00:00:00.000Z",
  updatedAt: "2026-04-14T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  snapshotCoverage: undefined,
  session: null,
  spawnRole: "orchestrator",
} as unknown as OrchestrationThread;

const baseMessage = {
  id: "message-1",
  role: "assistant",
  text: "Ready to continue.",
  turnId: null,
  streaming: false,
  createdAt: "2026-04-14T00:00:00.000Z",
  updatedAt: "2026-04-14T00:00:00.000Z",
} as unknown as OrchestrationMessage;

describe("orchestratorNotify", () => {
  it("notifies only finalized visible assistant messages from orchestrator threads", () => {
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

  it("formats the visible chat message without tool or reasoning metadata", () => {
    expect(formatOrchestratorChatNotification({ thread: baseThread, message: baseMessage })).toBe(
      "Orchestrator: Jasper\n\nReady to continue.",
    );
  });

  it("bounds long notifications", () => {
    const body = formatOrchestratorChatNotification({
      thread: baseThread,
      message: { ...baseMessage, text: "x".repeat(4_000) } as OrchestrationMessage,
    });

    expect(body.length).toBeLessThanOrEqual(3_500);
    expect(body).toContain("[message truncated by T3 Code]");
  });
});
