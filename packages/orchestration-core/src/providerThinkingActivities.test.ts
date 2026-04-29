import {
  EventId,
  RuntimeItemId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { projectThinkingActivitiesFromRuntimeEvent } from "./providerThinkingActivities.ts";

const now = "2026-04-27T14:00:00.000Z";
const threadId = ThreadId.makeUnsafe("thread-thinking");
const turnId = TurnId.makeUnsafe("turn-thinking");

describe("provider thinking activity projection", () => {
  it("projects task progress into a thinking activity", () => {
    const event: ProviderRuntimeEvent = {
      type: "task.progress",
      eventId: EventId.makeUnsafe("evt-task-progress"),
      provider: "codex",
      threadId,
      turnId,
      createdAt: now,
      payload: {
        taskId: RuntimeTaskId.makeUnsafe("task-1"),
        description: "Inspecting provider event ordering.",
        summary: "Comparing the current Codex event shapes.",
      },
    };

    expect(projectThinkingActivitiesFromRuntimeEvent({ event, sequence: 3 })).toEqual([
      {
        id: EventId.makeUnsafe("evt-task-progress"),
        createdAt: now,
        tone: "thinking",
        kind: "task.progress",
        summary: "Thinking",
        payload: {
          taskId: RuntimeTaskId.makeUnsafe("task-1"),
          detail: "Comparing the current Codex event shapes.",
          summary: "Comparing the current Codex event shapes.",
        },
        turnId,
        sequence: 3,
      },
    ]);
  });

  it("projects reasoning deltas into thinking activities", () => {
    const event: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: EventId.makeUnsafe("evt-reasoning-delta"),
      provider: "codex",
      threadId,
      turnId,
      itemId: RuntimeItemId.makeUnsafe("reasoning-item-1"),
      createdAt: now,
      payload: {
        streamKind: "reasoning_summary_text",
        delta: "Checked the post-turn reasoning summary.",
        summaryIndex: 0,
      },
    };

    expect(projectThinkingActivitiesFromRuntimeEvent({ event })).toEqual([
      {
        id: EventId.makeUnsafe("evt-reasoning-delta"),
        createdAt: now,
        tone: "thinking",
        kind: "thinking.delta",
        summary: "Thinking",
        payload: {
          text: "Checked the post-turn reasoning summary.",
          streamKind: "reasoning_summary_text",
          itemId: RuntimeItemId.makeUnsafe("reasoning-item-1"),
          summaryIndex: 0,
        },
        turnId,
      },
    ]);
  });

  it("ignores non-reasoning content streams", () => {
    const event: ProviderRuntimeEvent = {
      type: "content.delta",
      eventId: EventId.makeUnsafe("evt-assistant-delta"),
      provider: "codex",
      threadId,
      turnId,
      createdAt: now,
      payload: {
        streamKind: "assistant_text",
        delta: "Final answer text.",
      },
    };

    expect(projectThinkingActivitiesFromRuntimeEvent({ event })).toEqual([]);
  });
});
