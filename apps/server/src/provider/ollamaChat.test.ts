import assert from "node:assert/strict";
import { MessageId, type OrchestrationMessage, TurnId } from "@t3tools/contracts";
import { describe, it } from "vitest";

import { buildOllamaConversationHistory } from "./ollamaChat.ts";

const asMessageId = (value: string) => MessageId.makeUnsafe(value);
const asTurnId = (value: string) => TurnId.makeUnsafe(value);

function makeMessage(overrides: Partial<OrchestrationMessage> & Pick<OrchestrationMessage, "id">) {
  return {
    id: overrides.id,
    role: overrides.role ?? "user",
    text: overrides.text ?? "message",
    turnId: overrides.turnId ?? asTurnId("turn-1"),
    streaming: overrides.streaming ?? false,
    createdAt: overrides.createdAt ?? "2026-06-07T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-07T10:00:00.000Z",
    ...(overrides.attachments !== undefined ? { attachments: overrides.attachments } : {}),
  } satisfies OrchestrationMessage;
}

describe("buildOllamaConversationHistory", () => {
  it("drops transient assistant deltas, empty text, and the current user message", () => {
    const history = buildOllamaConversationHistory({
      excludeMessageId: asMessageId("user-2"),
      messages: [
        makeMessage({
          id: asMessageId("system-1"),
          role: "system",
          text: "  You are a coding assistant.  ",
          turnId: null,
        }),
        makeMessage({
          id: asMessageId("user-1"),
          role: "user",
          text: "Explain this function.",
          turnId: asTurnId("turn-1"),
        }),
        makeMessage({
          id: asMessageId("assistant-stream"),
          role: "assistant",
          text: "Thinking",
          turnId: asTurnId("turn-1"),
          streaming: true,
        }),
        makeMessage({
          id: asMessageId("assistant-1"),
          role: "assistant",
          text: " It parses the input. ",
          turnId: asTurnId("turn-1"),
        }),
        makeMessage({
          id: asMessageId("assistant-empty"),
          role: "assistant",
          text: "   ",
          turnId: asTurnId("turn-1"),
        }),
        makeMessage({
          id: asMessageId("user-2"),
          role: "user",
          text: "Reply with pong",
          turnId: asTurnId("turn-2"),
        }),
      ],
    });

    assert.deepEqual(history, [
      { role: "system", content: "You are a coding assistant." },
      { role: "user", content: "Explain this function." },
      { role: "assistant", content: "It parses the input." },
    ]);
  });

  it("preserves message order from the authoritative thread log", () => {
    const history = buildOllamaConversationHistory({
      messages: [
        makeMessage({
          id: asMessageId("user-older"),
          role: "user",
          text: "first",
          createdAt: "2026-06-07T10:00:00.000Z",
        }),
        makeMessage({
          id: asMessageId("assistant-newer"),
          role: "assistant",
          text: "second",
          createdAt: "2026-06-07T10:00:01.000Z",
        }),
        makeMessage({
          id: asMessageId("user-newest"),
          role: "user",
          text: "third",
          createdAt: "2026-06-07T10:00:02.000Z",
        }),
      ],
    });

    assert.deepEqual(history, [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
  });
});
