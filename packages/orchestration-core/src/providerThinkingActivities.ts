import type { OrchestrationThreadActivity, ProviderRuntimeEvent } from "@t3tools/contracts";

type ThinkingProjectionInput = {
  readonly event: ProviderRuntimeEvent;
  readonly sequence?: number;
};

export function projectThinkingActivitiesFromRuntimeEvent(
  input: ThinkingProjectionInput,
): ReadonlyArray<OrchestrationThreadActivity> {
  const { event, sequence } = input;
  const maybeSequence = sequence === undefined ? {} : { sequence };

  switch (event.type) {
    case "task.progress":
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "thinking",
          kind: "task.progress",
          summary: "Thinking",
          payload: {
            taskId: event.payload.taskId,
            detail: event.payload.summary ?? event.payload.description,
            ...(event.payload.summary ? { summary: event.payload.summary } : {}),
            ...(event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
          turnId: event.turnId ?? null,
          ...maybeSequence,
        },
      ];

    case "content.delta":
      if (
        event.payload.streamKind !== "reasoning_text" &&
        event.payload.streamKind !== "reasoning_summary_text"
      ) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "thinking",
          kind: "thinking.delta",
          summary: "Thinking",
          payload: {
            text: event.payload.delta,
            streamKind: event.payload.streamKind,
            ...(event.itemId ? { itemId: event.itemId } : {}),
            ...(event.payload.contentIndex !== undefined
              ? { contentIndex: event.payload.contentIndex }
              : {}),
            ...(event.payload.summaryIndex !== undefined
              ? { summaryIndex: event.payload.summaryIndex }
              : {}),
          },
          turnId: event.turnId ?? null,
          ...maybeSequence,
        },
      ];

    default:
      return [];
  }
}
