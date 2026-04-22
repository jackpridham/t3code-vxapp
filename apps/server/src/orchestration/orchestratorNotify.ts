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

type Env = Readonly<Record<string, string | undefined>>;

export function isOrchestratorChatNotifyEnabled(env: Env = process.env): boolean {
  if (
    env.T3CODE_ORCHESTRATOR_NOTIFY_DISABLED === "1" ||
    env.VITEST === "true" ||
    env.NODE_ENV === "test"
  ) {
    return false;
  }

  return env.T3CODE_ORCHESTRATOR_NOTIFY_ENABLED === "1";
}

export function shouldSendOrchestratorChatNotification(
  input: {
    thread: OrchestrationThread;
    message: OrchestrationMessage;
  },
  env: Env = process.env,
): boolean {
  return isOrchestratorChatNotifyEnabled(env) && shouldNotifyOrchestratorChatMessage(input);
}

export function notifyOrchestratorChatMessage(input: {
  thread: OrchestrationThread;
  message: OrchestrationMessage;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!shouldSendOrchestratorChatNotification(input)) {
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
