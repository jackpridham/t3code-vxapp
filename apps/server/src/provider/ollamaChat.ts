import type { MessageId, OrchestrationMessage, ProviderSendTurnInput } from "@t3tools/contracts";

type OllamaConversationHistoryEntry = NonNullable<
  ProviderSendTurnInput["conversationHistory"]
>[number];

export function buildOllamaConversationHistory(input: {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly excludeMessageId?: MessageId;
}): ReadonlyArray<OllamaConversationHistoryEntry> {
  const history: OllamaConversationHistoryEntry[] = [];

  for (const message of input.messages) {
    if (input.excludeMessageId !== undefined && message.id === input.excludeMessageId) {
      continue;
    }
    if (message.role === "assistant" && message.streaming) {
      continue;
    }

    const content = message.text.trim();
    if (content.length === 0) {
      continue;
    }

    history.push({
      role: message.role,
      content,
    });
  }

  return history;
}
