import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";
import {
  formatOrchestratorChatNotification,
  shouldNotifyOrchestratorChatMessage,
} from "@t3tools/orchestration-core/orchestrator-notify";
import { Cause, Data, Effect } from "effect";

import { runProcess } from "../processRunner.ts";

const NOTIFY_TIMEOUT_MS = 10_000;

class OrchestratorNotifyError extends Data.TaggedError("OrchestratorNotifyError")<{
  readonly cause: unknown;
}> {}

export { formatOrchestratorChatNotification, shouldNotifyOrchestratorChatMessage };

function isOrchestratorNotifyDisabled(): boolean {
  return (
    process.env.T3CODE_ORCHESTRATOR_NOTIFY_DISABLED === "1" ||
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test"
  );
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
