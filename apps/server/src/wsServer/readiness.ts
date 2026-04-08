import { Deferred, Effect } from "effect";

export interface ServerReadiness {
  readonly awaitServerReady: Effect.Effect<void>;
  readonly isServerReady: Effect.Effect<boolean>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly markPushBusReady: Effect.Effect<void>;
  readonly markKeybindingsReady: Effect.Effect<void>;
  readonly markTerminalSubscriptionsReady: Effect.Effect<void>;
  readonly markOrchestrationSubscriptionsReady: Effect.Effect<void>;
}

export const makeServerReadiness = Effect.gen(function* () {
  const httpListening = yield* Deferred.make<void>();
  const pushBusReady = yield* Deferred.make<void>();
  const keybindingsReady = yield* Deferred.make<void>();
  const terminalSubscriptionsReady = yield* Deferred.make<void>();
  const orchestrationSubscriptionsReady = yield* Deferred.make<void>();

  let httpListeningReady = false;
  let pushBusReadyFlag = false;
  let keybindingsReadyFlag = false;
  let terminalSubscriptionsReadyFlag = false;
  let orchestrationSubscriptionsReadyFlag = false;

  const complete = (deferred: Deferred.Deferred<void>, setReady: () => void): Effect.Effect<void> =>
    Effect.gen(function* () {
      setReady();
      yield* Deferred.succeed(deferred, undefined).pipe(Effect.orDie);
    });

  return {
    awaitServerReady: Effect.all([
      Deferred.await(httpListening),
      Deferred.await(pushBusReady),
      Deferred.await(keybindingsReady),
      Deferred.await(terminalSubscriptionsReady),
      Deferred.await(orchestrationSubscriptionsReady),
    ]).pipe(Effect.asVoid),
    isServerReady: Effect.sync(
      () =>
        httpListeningReady &&
        pushBusReadyFlag &&
        keybindingsReadyFlag &&
        terminalSubscriptionsReadyFlag &&
        orchestrationSubscriptionsReadyFlag,
    ),
    markHttpListening: complete(httpListening, () => {
      httpListeningReady = true;
    }),
    markPushBusReady: complete(pushBusReady, () => {
      pushBusReadyFlag = true;
    }),
    markKeybindingsReady: complete(keybindingsReady, () => {
      keybindingsReadyFlag = true;
    }),
    markTerminalSubscriptionsReady: complete(terminalSubscriptionsReady, () => {
      terminalSubscriptionsReadyFlag = true;
    }),
    markOrchestrationSubscriptionsReady: complete(orchestrationSubscriptionsReady, () => {
      orchestrationSubscriptionsReadyFlag = true;
    }),
  } satisfies ServerReadiness;
});
