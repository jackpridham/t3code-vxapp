import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";
import { Cause, Data, Effect } from "effect";

import { runProcess } from "../processRunner.ts";

const MAX_NOTIFY_MESSAGE_CHARS = 3_500;
const NOTIFY_TIMEOUT_MS = 10_000;

class OrchestratorNotifyError extends Data.TaggedError("OrchestratorNotifyError")<{
  readonly cause: unknown;
}> {}

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

function isOrchestratorNotifyDisabled(): boolean {
  return (
    process.env.T3CODE_ORCHESTRATOR_NOTIFY_DISABLED === "1" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test"
  );
}

function truncateNotifyMessage(value: string): string {
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
  return truncateNotifyMessage(`${label}\n\n${input.message.text.trim()}`);
}

export function notifyOrchestratorChatMessage(input: {
  thread: OrchestrationThread;
  message: OrchestrationMessage;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!shouldNotifyOrchestratorChatMessage(input) || isOrchestratorNotifyDisabled()) {
      return;
    }

    const body = formatOrchestratorChatNotification(input);
    const result = yield* Effect.tryPromise({
      try: () =>
        runProcess("vx", ["notify", body], {
          timeoutMs: NOTIFY_TIMEOUT_MS,
          allowNonZeroExit: true,
          maxBufferBytes: 16 * 1024,
          outputMode: "truncate",
        }),
      catch: (cause) => new OrchestratorNotifyError({ cause }),
    });

    if (result.timedOut || result.code !== 0) {
      yield* Effect.logWarning(
        `vx notify failed for orchestrator chat message ${input.message.id}: code=${
          result.code ?? "null"
        } signal=${result.signal ?? "null"} timedOut=${String(result.timedOut)}`,
      );
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to send orchestrator chat notification", {
        cause: Cause.pretty(cause),
      }),
    ),
  );
}
