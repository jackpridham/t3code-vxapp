import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";

export const MAX_NOTIFY_MESSAGE_CHARS = 3_500;

export function shouldNotifyOrchestratorChatMessage(input: {
  thread: OrchestrationThread;
  message: OrchestrationMessage;
}): boolean {
  return (
    input.thread.spawnRole === "orchestrator" &&
    input.message.role === "assistant" &&
    input.message.streaming === false &&
    input.message.text.trim().length > 0
  );
}

export function truncateOrchestratorNotifyMessage(value: string): string {
  if (value.length <= MAX_NOTIFY_MESSAGE_CHARS) {
    return value;
  }

  const suffix = "\n\n[message truncated by T3 Code]";
  return `${value.slice(0, MAX_NOTIFY_MESSAGE_CHARS - suffix.length).trimEnd()}${suffix}`;
}

export function formatOrchestratorChatNotification(input: {
  thread: Pick<OrchestrationThread, "title">;
  message: Pick<OrchestrationMessage, "text">;
}): string {
  const title = input.thread.title.trim();
  const label = title.length > 0 ? `Orchestrator: ${title}` : "Orchestrator";
  return truncateOrchestratorNotifyMessage(`${label}\n\n${input.message.text.trim()}`);
}
