import { execFileSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  ProviderKind,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import {
  Effect,
  Exit,
  FileSystem,
  Layer,
  ManagedRuntime,
  Option,
  Path,
  Ref,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";

import { CheckpointStoreLive } from "../src/checkpointing/Layers/CheckpointStore.ts";
import { CheckpointStore } from "../src/checkpointing/Services/CheckpointStore.ts";
import { GitCoreLive } from "../src/git/Layers/GitCore.ts";
import { GitCore, type GitCoreShape } from "../src/git/Services/GitCore.ts";
import { TextGeneration, type TextGenerationShape } from "../src/git/Services/TextGeneration.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../src/persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../src/persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionCheckpointRepositoryLive } from "../src/persistence/Layers/ProjectionCheckpoints.ts";
import { ProjectionPendingApprovalRepositoryLive } from "../src/persistence/Layers/ProjectionPendingApprovals.ts";
import { ProjectionThreadMessageRepositoryLive } from "../src/persistence/Layers/ProjectionThreadMessages.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../src/persistence/Layers/ProviderSessionRuntime.ts";
import { makeSqlitePersistenceLive } from "../src/persistence/Layers/Sqlite.ts";
import { ProjectionCheckpointRepository } from "../src/persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionPendingApprovalRepository } from "../src/persistence/Services/ProjectionPendingApprovals.ts";
import type { ProjectionPendingApproval } from "../src/persistence/Services/ProjectionPendingApprovals.ts";
import { ProjectionThreadMessageRepository } from "../src/persistence/Services/ProjectionThreadMessages.ts";
import { ProviderUnsupportedError } from "../src/provider/Errors.ts";
import { ProviderAdapterRegistry } from "../src/provider/Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";
import { ProjectHooksService } from "../src/extensions/vxapp/Services/ProjectHooksService.ts";
import { makeProviderServiceLive } from "../src/provider/Layers/ProviderService.ts";
import { makeCodexAdapterLive } from "../src/provider/Layers/CodexAdapter.ts";
import { CodexAdapter } from "../src/provider/Services/CodexAdapter.ts";
import { makeOllamaAdapterLive } from "../src/provider/Layers/OllamaAdapter.ts";
import { OllamaAdapter } from "../src/provider/Services/OllamaAdapter.ts";
import { ProviderService } from "../src/provider/Services/ProviderService.ts";
import { AnalyticsService } from "../src/telemetry/Services/AnalyticsService.ts";
import { CheckpointReactorLive } from "../src/orchestration/Layers/CheckpointReactor.ts";
import { OrchestrationEngineLive } from "../src/orchestration/Layers/OrchestrationEngine.ts";
import { OrchestratorWakeReactorLive } from "../src/extensions/vxapp/Layers/OrchestratorWakeReactor.ts";
import { OrchestrationProjectionPipelineLive } from "../src/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../src/orchestration/Layers/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "../src/orchestration/Layers/RuntimeReceiptBus.ts";
import { OrchestrationReactorLive } from "../src/orchestration/Layers/OrchestrationReactor.ts";
import { ProviderCommandReactorLive } from "../src/orchestration/Layers/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionLive } from "../src/orchestration/Layers/ProviderRuntimeIngestion.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../src/orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationReactor } from "../src/orchestration/Services/OrchestrationReactor.ts";
import { ProjectionSnapshotQuery } from "../src/orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../src/orchestration/Services/RuntimeReceiptBus.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";
import { deriveServerPaths, ServerConfig } from "../src/config.ts";
import { WorkspaceEntriesLive } from "../src/workspace/Layers/WorkspaceEntries.ts";

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

const initializeGitWorkspace = Effect.fn(function* (cwd: string) {
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  const fileSystem = yield* FileSystem.FileSystem;
  const { join } = yield* Path.Path;
  yield* fileSystem.writeFileString(join(cwd, "README.md"), "v1\n");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
});

export function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function gitShowFileAtRef(cwd: string, ref: string, filePath: string): string {
  return runGit(cwd, ["show", `${ref}:${filePath}`]);
}

class WaitForTimeoutError extends Schema.TaggedErrorClass<WaitForTimeoutError>()(
  "WaitForTimeoutError",
  {
    description: Schema.String,
  },
) {}

function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs?: number,
): Effect.Effect<A, never>;
function waitFor<A, B extends A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => value is B,
  description: string,
  timeoutMs?: number,
): Effect.Effect<B, never>;
function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs = 10_000,
): Effect.Effect<A, never> {
  const RETRY_SIGNAL = "wait_for_retry";
  const retryIntervalMs = 10;
  const maxRetries = Math.max(0, Math.floor(timeoutMs / retryIntervalMs));
  const retrySchedule = Schedule.spaced(`${retryIntervalMs} millis`);

  return read.pipe(
    Effect.filterOrFail(predicate, () => RETRY_SIGNAL),
    Effect.retry({
      schedule: retrySchedule,
      times: maxRetries,
      while: (error) => error === RETRY_SIGNAL,
    }),
    Effect.mapError((error) =>
      error === RETRY_SIGNAL ? new WaitForTimeoutError({ description }) : error,
    ),
    Effect.orDie,
  );
}

class OrchestrationHarnessRuntimeError extends Schema.TaggedErrorClass<OrchestrationHarnessRuntimeError>()(
  "OrchestrationHarnessRuntimeError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const tryRuntimePromise = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new OrchestrationHarnessRuntimeError({ operation, cause }),
  });

export interface OrchestrationIntegrationHarness {
  readonly rootDir: string;
  readonly workspaceDir: string;
  readonly dbPath: string;
  readonly adapterHarness: TestProviderAdapterHarness | null;
  readonly engine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQuery["Service"];
  readonly providerService: ProviderService["Service"];
  readonly checkpointStore: CheckpointStore["Service"];
  readonly checkpointRepository: ProjectionCheckpointRepository["Service"];
  readonly pendingApprovalRepository: ProjectionPendingApprovalRepository["Service"];
  readonly threadMessageRepository: ProjectionThreadMessageRepository["Service"];
  readonly waitForThread: (
    threadId: string,
    predicate: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<OrchestrationThread, never>;
  readonly waitForDomainEvent: (
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<ReadonlyArray<OrchestrationEvent>, never>;
  readonly waitForPendingApproval: (
    requestId: string,
    predicate: (row: ProjectionPendingApproval) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<ProjectionPendingApproval, never>;
  readonly waitForReceipt: {
    (
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ): Effect.Effect<OrchestrationRuntimeReceipt, never>;
    <Receipt extends OrchestrationRuntimeReceipt>(
      predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
      timeoutMs?: number,
    ): Effect.Effect<Receipt, never>;
  };
  readonly restart: Effect.Effect<
    OrchestrationIntegrationHarness,
    never,
    FileSystem.FileSystem | Path.Path | Scope.Scope
  >;
  readonly dispose: Effect.Effect<void, never>;
}

interface MakeOrchestrationIntegrationHarnessOptions {
  readonly provider?: ProviderKind;
  readonly realCodex?: boolean;
  readonly realOllama?: boolean;
  readonly rootDir?: string;
  readonly workspaceDir?: string;
  readonly dbPath?: string;
  readonly preserveDirectories?: boolean;
}

interface HarnessBuildServices {
  readonly path: typeof Path.Path.Service;
  readonly fileSystem: typeof FileSystem.FileSystem.Service;
}

const buildOrchestrationIntegrationHarness = (
  options?: MakeOrchestrationIntegrationHarnessOptions,
  services?: HarnessBuildServices,
): Effect.Effect<
  OrchestrationIntegrationHarness,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const path = services?.path ?? (yield* Path.Path);
    const fileSystem = services?.fileSystem ?? (yield* FileSystem.FileSystem);

    const provider = options?.provider ?? "codex";
    const useRealCodex = options?.realCodex === true;
    const useRealOllama = options?.realOllama === true;
    const adapterHarness =
      useRealCodex || useRealOllama
        ? null
        : yield* makeTestProviderAdapterHarness({
            provider,
          });
    const fakeRegistry = adapterHarness
      ? Layer.succeed(ProviderAdapterRegistry, {
          getByProvider: (resolvedProvider) =>
            resolvedProvider === adapterHarness.provider
              ? Effect.succeed(adapterHarness.adapter)
              : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
          listProviders: () => Effect.succeed([adapterHarness.provider]),
        } as typeof ProviderAdapterRegistry.Service)
      : null;
    const shouldPreserveDirectories = options?.preserveDirectories === true;
    const rootDir =
      options?.rootDir ??
      (yield* fileSystem
        .makeTempDirectoryScoped({
          prefix: "t3-orchestration-integration-",
        })
        .pipe(Effect.orDie));
    const workspaceDir = options?.workspaceDir ?? path.join(rootDir, "workspace");
    const derivedServerPaths = yield* deriveServerPaths(rootDir, undefined).pipe(
      Effect.provideService(Path.Path, path),
    );
    const stateDir = path.dirname(options?.dbPath ?? derivedServerPaths.dbPath);
    const dbPath = options?.dbPath ?? derivedServerPaths.dbPath;

    if (!shouldPreserveDirectories) {
      yield* fileSystem.makeDirectory(workspaceDir, { recursive: true }).pipe(Effect.orDie);
      yield* fileSystem.makeDirectory(stateDir, { recursive: true }).pipe(Effect.orDie);
      yield* initializeGitWorkspace(workspaceDir).pipe(Effect.orDie);
    }

    const liveOllamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://192.168.10.12:11435/api";
    const liveOllamaUrl = new URL(liveOllamaBaseUrl);
    const liveOllamaSettings = {
      providers: {
        ollamaLocal: {
          protocol: liveOllamaUrl.protocol === "https:" ? ("https" as const) : ("http" as const),
          host: liveOllamaUrl.hostname,
          port: Number(liveOllamaUrl.port || (liveOllamaUrl.protocol === "https:" ? "443" : "80")),
          apiPath: liveOllamaUrl.pathname || "/api",
          responsesApiPath: process.env.OLLAMA_RESPONSES_API_PATH ?? "/v1",
          codexHomePath: path.join(rootDir, "ollama-codex-home"),
          defaultModel: process.env.OLLAMA_MODEL ?? "qwen3:8b",
        },
      },
    } as const;

    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const realCodexRegistry = Layer.effect(
      ProviderAdapterRegistry,
      Effect.gen(function* () {
        const codexAdapter = yield* CodexAdapter;
        return {
          getByProvider: (resolvedProvider) =>
            resolvedProvider === "codex"
              ? Effect.succeed(codexAdapter)
              : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
          listProviders: () => Effect.succeed(["codex"] as const),
        } as typeof ProviderAdapterRegistry.Service;
      }),
    ).pipe(
      Layer.provide(makeCodexAdapterLive()),
      Layer.provideMerge(ServerSettingsService.layerTest(useRealOllama ? liveOllamaSettings : {})),
      Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const realOllamaRegistry = Layer.effect(
      ProviderAdapterRegistry,
      Effect.gen(function* () {
        const ollamaAdapter = yield* OllamaAdapter;
        return {
          getByProvider: (resolvedProvider) =>
            resolvedProvider === "ollamaLocal"
              ? Effect.succeed(ollamaAdapter)
              : Effect.fail(new ProviderUnsupportedError({ provider: resolvedProvider })),
          listProviders: () => Effect.succeed(["ollamaLocal"] as const),
        } as typeof ProviderAdapterRegistry.Service;
      }),
    ).pipe(
      Layer.provide(makeOllamaAdapterLive()),
      Layer.provideMerge(ServerSettingsService.layerTest(liveOllamaSettings)),
      Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(providerSessionDirectoryLayer),
    );
    const providerLayer = makeProviderServiceLive().pipe(
      Layer.provide(providerSessionDirectoryLayer),
      Layer.provide(
        useRealCodex ? realCodexRegistry : useRealOllama ? realOllamaRegistry : fakeRegistry!,
      ),
      Layer.provide(AnalyticsService.layerTest),
    );

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const checkpointStoreLayer = CheckpointStoreLive.pipe(Layer.provide(GitCoreLive));
    const runtimeServicesLayer = Layer.mergeAll(
      orchestrationLayer,
      OrchestrationProjectionSnapshotQueryLive,
      ProjectionCheckpointRepositoryLive,
      ProjectionPendingApprovalRepositoryLive,
      ProjectionThreadMessageRepositoryLive,
      checkpointStoreLayer,
      providerLayer,
      RuntimeReceiptBusLive,
    );
    const serverSettingsLayer = ServerSettingsService.layerTest(
      useRealOllama ? liveOllamaSettings : {},
    );
    const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(serverSettingsLayer),
    );
    const gitCoreLayer = Layer.succeed(GitCore, {
      renameBranch: (input: Parameters<GitCoreShape["renameBranch"]>[0]) =>
        Effect.succeed({ branch: input.newBranch }),
    } as unknown as GitCoreShape);
    const textGenerationLayer = Layer.succeed(TextGeneration, {
      generateBranchName: () => Effect.succeed({ branch: "update" }),
      generateThreadTitle: () => Effect.succeed({ title: "New thread" }),
    } as unknown as TextGenerationShape);
    const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(gitCoreLayer),
      Layer.provideMerge(textGenerationLayer),
      Layer.provideMerge(serverSettingsLayer),
    );
    const checkpointReactorLayer = CheckpointReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
      Layer.provideMerge(
        WorkspaceEntriesLive.pipe(
          Layer.provideMerge(gitCoreLayer),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
    const orchestratorWakeReactorLayer = OrchestratorWakeReactorLive.pipe(
      Layer.provideMerge(runtimeServicesLayer),
    );
    const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
      Layer.provideMerge(runtimeIngestionLayer),
      Layer.provideMerge(providerCommandReactorLayer),
      Layer.provideMerge(checkpointReactorLayer),
      Layer.provideMerge(orchestratorWakeReactorLayer),
    );
    const layer = Layer.mergeAll(runtimeServicesLayer, orchestrationReactorLayer).pipe(
      Layer.provide(persistenceLayer),
      Layer.provideMerge(ProjectHooksService.layerTest),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(ServerConfig.layerTest(workspaceDir, rootDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    const runtime = ManagedRuntime.make(layer);
    const engine = yield* tryRuntimePromise("load OrchestrationEngine service", () =>
      runtime.runPromise(Effect.service(OrchestrationEngineService)),
    ).pipe(Effect.orDie);
    const reactor = yield* tryRuntimePromise("load OrchestrationReactor service", () =>
      runtime.runPromise(Effect.service(OrchestrationReactor)),
    ).pipe(Effect.orDie);
    const snapshotQuery = yield* tryRuntimePromise("load ProjectionSnapshotQuery service", () =>
      runtime.runPromise(Effect.service(ProjectionSnapshotQuery)),
    ).pipe(Effect.orDie);
    const providerService = yield* tryRuntimePromise("load ProviderService service", () =>
      runtime.runPromise(Effect.service(ProviderService)),
    ).pipe(Effect.orDie);
    const checkpointStore = yield* tryRuntimePromise("load CheckpointStore service", () =>
      runtime.runPromise(Effect.service(CheckpointStore)),
    ).pipe(Effect.orDie);
    const checkpointRepository = yield* tryRuntimePromise(
      "load ProjectionCheckpointRepository service",
      () => runtime.runPromise(Effect.service(ProjectionCheckpointRepository)),
    ).pipe(Effect.orDie);
    const pendingApprovalRepository = yield* tryRuntimePromise(
      "load ProjectionPendingApprovalRepository service",
      () => runtime.runPromise(Effect.service(ProjectionPendingApprovalRepository)),
    ).pipe(Effect.orDie);
    const threadMessageRepository = yield* tryRuntimePromise(
      "load ProjectionThreadMessageRepository service",
      () => runtime.runPromise(Effect.service(ProjectionThreadMessageRepository)),
    ).pipe(Effect.orDie);
    const runtimeReceiptBus = yield* tryRuntimePromise("load RuntimeReceiptBus service", () =>
      runtime.runPromise(Effect.service(RuntimeReceiptBus)),
    ).pipe(Effect.orDie);

    const scope = yield* Scope.make("sequential");
    yield* tryRuntimePromise("start OrchestrationReactor", () =>
      runtime.runPromise(reactor.start().pipe(Scope.provide(scope))),
    ).pipe(Effect.orDie);
    const receiptHistory = yield* Ref.make<ReadonlyArray<OrchestrationRuntimeReceipt>>([]);
    yield* Stream.runForEach(runtimeReceiptBus.stream, (receipt) =>
      Ref.update(receiptHistory, (history) => [...history, receipt]).pipe(Effect.asVoid),
    ).pipe(Effect.forkIn(scope));
    yield* Effect.sleep(10);

    const waitForThread: OrchestrationIntegrationHarness["waitForThread"] = (
      threadId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        snapshotQuery
          .getSnapshot()
          .pipe(
            Effect.map(
              (snapshot) => snapshot.threads.find((thread) => thread.id === threadId) ?? null,
            ),
          ),
        (thread): thread is OrchestrationThread => thread !== null && predicate(thread),
        `projected thread '${threadId}'`,
        timeoutMs,
      ) as Effect.Effect<OrchestrationThread, never>;

    const waitForDomainEvent: OrchestrationIntegrationHarness["waitForDomainEvent"] = (
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        Stream.runCollect(engine.readEvents(0)).pipe(
          Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
        ),
        (events) => events.some(predicate),
        "domain event",
        timeoutMs,
      );

    const waitForPendingApproval: OrchestrationIntegrationHarness["waitForPendingApproval"] = (
      requestId,
      predicate,
      timeoutMs,
    ) =>
      waitFor(
        pendingApprovalRepository
          .getByRequestId({ requestId: ApprovalRequestId.makeUnsafe(requestId) })
          .pipe(
            Effect.map((row) =>
              Option.match(row, {
                onNone: () => null,
                onSome: (value) => value,
              }),
            ),
          ),
        (row): row is ProjectionPendingApproval => row !== null && predicate(row),
        `pending approval '${requestId}'`,
        timeoutMs,
      ) as Effect.Effect<ProjectionPendingApproval, never>;

    function waitForReceipt(
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ): Effect.Effect<OrchestrationRuntimeReceipt, never>;
    function waitForReceipt<Receipt extends OrchestrationRuntimeReceipt>(
      predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
      timeoutMs?: number,
    ): Effect.Effect<Receipt, never>;
    function waitForReceipt(
      predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
      timeoutMs?: number,
    ) {
      const readMatchingReceipt = Ref.get(receiptHistory).pipe(
        Effect.map((history) => history.find(predicate)),
      );

      return waitFor(
        readMatchingReceipt,
        (receipt): receipt is OrchestrationRuntimeReceipt => receipt !== undefined,
        "runtime receipt",
        timeoutMs,
      );
    }

    let disposed = false;
    const dispose: OrchestrationIntegrationHarness["dispose"] = Effect.gen(function* () {
      if (disposed) {
        return;
      }
      disposed = true;

      const shutdown = Effect.gen(function* () {
        const closeScopeExit = yield* Effect.exit(Scope.close(scope, Exit.void));
        const disposeRuntimeExit = yield* Effect.exit(Effect.promise(() => runtime.dispose()));

        const failureCause = Exit.isFailure(closeScopeExit)
          ? closeScopeExit.cause
          : Exit.isFailure(disposeRuntimeExit)
            ? disposeRuntimeExit.cause
            : null;

        if (failureCause) {
          return yield* Effect.failCause(failureCause);
        }
      });

      yield* shutdown;
    });

    const restart: OrchestrationIntegrationHarness["restart"] = Effect.gen(function* () {
      yield* dispose;
      return yield* buildOrchestrationIntegrationHarness(
        {
          provider,
          realCodex: useRealCodex,
          realOllama: useRealOllama,
          rootDir,
          workspaceDir,
          dbPath,
          preserveDirectories: true,
        },
        { path, fileSystem },
      );
    });

    return {
      rootDir,
      workspaceDir,
      dbPath,
      adapterHarness,
      engine,
      snapshotQuery,
      providerService,
      checkpointStore,
      checkpointRepository,
      pendingApprovalRepository,
      threadMessageRepository,
      waitForThread,
      waitForDomainEvent,
      waitForPendingApproval,
      waitForReceipt,
      restart,
      dispose,
    } satisfies OrchestrationIntegrationHarness;
  });

export const makeOrchestrationIntegrationHarness = (
  options?: MakeOrchestrationIntegrationHarnessOptions,
): Effect.Effect<
  OrchestrationIntegrationHarness,
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> => buildOrchestrationIntegrationHarness(options);
