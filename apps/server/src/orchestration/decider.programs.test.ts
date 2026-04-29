import {
  CommandId,
  EventId,
  PositiveInt,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProgramId = (value: string): ProgramId => ProgramId.makeUnsafe(value);
const asProgramNotificationId = (value: string): ProgramNotificationId =>
  ProgramNotificationId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

const PROGRAM_DELIVERY_SPEC = {
  declaredRepos: ["t3code-vxapp"],
  affectedAppTargets: ["web"],
  requiredLocalSuites: [
    {
      repo: "t3code-vxapp",
      suiteId: "lint",
      description: "Run lint before founder review.",
    },
  ],
  requiredExternalE2ESuites: [
    {
      target: "web",
      suiteId: "founder-e2e",
      description: "Founder-visible E2E contract.",
    },
  ],
  requireDevelopmentDeploy: true,
  requireExternalE2E: true,
  requireCleanPostFlight: true,
  requirePrPerRepo: true,
} as const;

const PROGRAM_REPO_PR = {
  repo: "t3code-vxapp",
  url: "https://github.com/t3tools/t3code-vxapp/pull/42",
  number: PositiveInt.makeUnsafe(42),
  state: "OPEN",
  isDraft: false,
  reviewDecision: "APPROVED",
  mergeStateStatus: "CLEAN",
  headRefName: "feature/program-closeout",
  baseRefName: "main",
  updatedAt: "2026-04-20T00:10:00.000Z",
} as const;

const PROGRAM_LOCAL_VALIDATION = {
  repo: "t3code-vxapp",
  suiteId: "lint",
  kind: "bun_lint",
  status: "passed",
  summary: "bun lint passed",
  command: "bun lint",
  recordedAt: "2026-04-20T00:11:00.000Z",
} as const;

const PROGRAM_APP_VALIDATION = {
  target: "web",
  kind: "development_deploy",
  suiteId: "dev-deploy",
  status: "passed",
  summary: "Development deploy succeeded",
  command: "vx apps web --deploy development",
  url: "https://web.dev.example.test",
  recordedAt: "2026-04-20T00:12:00.000Z",
} as const;

const PROGRAM_OBSERVED_REPO = {
  repo: "t3code-vxapp",
  source: "git-status",
  observedAt: "2026-04-20T00:13:00.000Z",
} as const;

const PROGRAM_POST_FLIGHT = {
  status: "clean",
  summary: "Worktree clean after validation and push",
  recordedAt: "2026-04-20T00:14:00.000Z",
} as const;

function makeProgramCreatedPayload(now: string, overrides: Record<string, unknown> = {}) {
  return {
    programId: asProgramId("program-cto"),
    title: "CTO web orchestration",
    objective: null,
    status: "active" as const,
    ...PROGRAM_DELIVERY_SPEC,
    executiveProjectId: asProjectId("project-cto"),
    executiveThreadId: asThreadId("thread-cto"),
    currentOrchestratorThreadId: null,
    repoPrs: [],
    localValidation: [],
    appValidations: [],
    observedRepos: [],
    postFlight: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelReason: null,
    cancelledAt: null,
    supersededByProgramId: null,
    ...overrides,
  };
}

async function makeExecutiveReadModel(now: string) {
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: asEventId("evt-project-cto"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-cto"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-project-cto"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        projectId: asProjectId("project-cto"),
        title: "CTO",
        workspaceRoot: "/home/gizmo/agents-vxapp/CTO",
        kind: "executive",
        defaultModelSelection: null,
        scripts: [],
        hooks: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-cto"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-cto"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-thread-cto"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId: asThreadId("thread-cto"),
        projectId: asProjectId("project-cto"),
        title: "Founder to CTO",
        labels: ["cto", "executive"],
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

async function makeCreatedProgramReadModel(now: string, overrides: Record<string, unknown> = {}) {
  const readModel = await makeExecutiveReadModel(now);
  return Effect.runPromise(
    projectEvent(readModel, {
      sequence: 3,
      eventId: asEventId("evt-program-cto"),
      aggregateKind: "program",
      aggregateId: asProgramId("program-cto"),
      type: "program.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-program-created"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: makeProgramCreatedPayload(now, overrides),
    }),
  );
}

describe("decider programs", () => {
  it("creates an executive-owned program envelope", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.create",
          commandId: CommandId.makeUnsafe("cmd-program-create"),
          programId: asProgramId("program-cto"),
          title: "CTO web orchestration",
          objective: "Run CTO from web above Jasper.",
          ...PROGRAM_DELIVERY_SPEC,
          executiveProjectId: asProjectId("project-cto"),
          executiveThreadId: asThreadId("thread-cto"),
          createdAt: now,
        },
        readModel,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.created");
    expect(event.aggregateKind).toBe("program");
    expect(event.aggregateId).toBe("program-cto");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      title: "CTO web orchestration",
      objective: "Run CTO from web above Jasper.",
      status: "active",
      declaredRepos: ["t3code-vxapp"],
      affectedAppTargets: ["web"],
      requiredLocalSuites: PROGRAM_DELIVERY_SPEC.requiredLocalSuites,
      requiredExternalE2ESuites: PROGRAM_DELIVERY_SPEC.requiredExternalE2ESuites,
      requireDevelopmentDeploy: true,
      requireExternalE2E: true,
      requireCleanPostFlight: true,
      requirePrPerRepo: true,
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      currentOrchestratorThreadId: null,
      repoPrs: [],
      localValidation: [],
      appValidations: [],
      observedRepos: [],
      postFlight: null,
      completedAt: null,
      cancelReason: null,
      cancelledAt: null,
      supersededByProgramId: null,
    });
  });

  it("rejects duplicate active programs", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);
    const created = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 3,
        eventId: asEventId("evt-program-cto"),
        aggregateKind: "program",
        aggregateId: asProgramId("program-cto"),
        type: "program.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-program-created"),
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          ...makeProgramCreatedPayload(now, {
            objective: "Run CTO from web above Jasper.",
          }),
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "program.create",
            commandId: CommandId.makeUnsafe("cmd-program-duplicate"),
            programId: asProgramId("program-cto"),
            title: "Duplicate program",
            ...PROGRAM_DELIVERY_SPEC,
            executiveProjectId: asProjectId("project-cto"),
            executiveThreadId: asThreadId("thread-cto"),
            createdAt: now,
          },
          readModel: created,
        }),
      ),
    ).rejects.toBeInstanceOf(OrchestrationCommandInvariantError);
  });

  it("accepts the expanded status set on program.create", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);

    for (const status of [
      "active",
      "blocked",
      "awaiting_founder",
      "awaiting_external",
      "closeout_in_progress",
      "founder_review_ready",
      "completed",
      "cancelled",
    ] as const) {
      const result = await Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "program.create",
            commandId: CommandId.makeUnsafe(`cmd-program-${status}`),
            programId: asProgramId(`program-${status}`),
            title: `Program ${status}`,
            ...PROGRAM_DELIVERY_SPEC,
            status,
            executiveProjectId: asProjectId("project-cto"),
            executiveThreadId: asThreadId("thread-cto"),
            createdAt: now,
          },
          readModel,
        }),
      );
      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("program.created");
      expect(event.payload.status).toBe(status);
    }
  });

  it("updates only delivery scope fields via program.scope.update", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.scope.update",
          commandId: CommandId.makeUnsafe("cmd-program-scope-update"),
          programId: asProgramId("program-cto"),
          declaredRepos: ["t3code-vxapp", "vortex-scripts"],
          affectedAppTargets: ["web", "api"],
          requireExternalE2E: false,
        },
        readModel: created,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.scope-updated");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      declaredRepos: ["t3code-vxapp", "vortex-scripts"],
      affectedAppTargets: ["web", "api"],
      requireExternalE2E: false,
    });
    expect(event.payload).not.toHaveProperty("title");
    expect(event.payload).not.toHaveProperty("status");
    expect(event.payload).not.toHaveProperty("executiveProjectId");
  });

  it("marks a program completed when status moves to completed", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.meta.update",
          commandId: CommandId.makeUnsafe("cmd-program-complete"),
          programId: asProgramId("program-cto"),
          status: "completed",
        },
        readModel: created,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.meta-updated");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      status: "completed",
    });
    expect(event.payload).toHaveProperty("completedAt");
  });

  it("carries explicit completion metadata on program.meta.update", async () => {
    const now = new Date().toISOString();
    const completedAt = "2026-04-20T00:20:00.000Z";
    const created = await makeCreatedProgramReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.meta.update",
          commandId: CommandId.makeUnsafe("cmd-program-complete-explicit"),
          programId: asProgramId("program-cto"),
          status: "completed",
          completedAt,
        },
        readModel: created,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.meta-updated");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      status: "completed",
      completedAt,
    });
  });

  it("carries cancellation metadata on program.meta.update", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.meta.update",
          commandId: CommandId.makeUnsafe("cmd-program-cancel"),
          programId: asProgramId("program-cto"),
          status: "cancelled",
          cancelReason: "Founder superseded the scope",
          cancelledAt: "2026-04-20T00:21:00.000Z",
          supersededByProgramId: asProgramId("program-cto-v2"),
        },
        readModel: created,
      }),
    );
    const event = Array.isArray(result) ? result[0] : result;

    expect(event.type).toBe("program.meta-updated");
    expect(event.payload).toMatchObject({
      programId: "program-cto",
      status: "cancelled",
      cancelReason: "Founder superseded the scope",
      cancelledAt: "2026-04-20T00:21:00.000Z",
      supersededByProgramId: "program-cto-v2",
    });
  });

  it("upserts repo PR evidence by repo key", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const firstResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.repo-pr.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-pr-1"),
          programId: asProgramId("program-cto"),
          repoPr: PROGRAM_REPO_PR,
        },
        readModel: created,
      }),
    );
    const firstEvent = Array.isArray(firstResult) ? firstResult[0] : firstResult;
    expect(firstEvent.type).toBe("program.repo-pr-upserted");

    const withFirst = await Effect.runPromise(
      projectEvent(created, { ...firstEvent, sequence: 4 }),
    );
    const secondResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.repo-pr.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-pr-2"),
          programId: asProgramId("program-cto"),
          repoPr: {
            ...PROGRAM_REPO_PR,
            state: "MERGED",
            updatedAt: "2026-04-20T00:15:00.000Z",
          },
        },
        readModel: withFirst,
      }),
    );
    const secondEvent = Array.isArray(secondResult) ? secondResult[0] : secondResult;
    expect(secondEvent.payload.repoPr.state).toBe("MERGED");

    const projected = await Effect.runPromise(
      projectEvent(withFirst, { ...secondEvent, sequence: 5 }),
    );
    expect((projected.programs ?? [])[0]?.repoPrs).toEqual([
      {
        ...PROGRAM_REPO_PR,
        state: "MERGED",
        updatedAt: "2026-04-20T00:15:00.000Z",
      },
    ]);
  });

  it("upserts local validation evidence by repo+suiteId+kind", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const firstResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.local-validation.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-local-1"),
          programId: asProgramId("program-cto"),
          localValidation: PROGRAM_LOCAL_VALIDATION,
        },
        readModel: created,
      }),
    );
    const firstEvent = Array.isArray(firstResult) ? firstResult[0] : firstResult;
    const withFirst = await Effect.runPromise(
      projectEvent(created, { ...firstEvent, sequence: 4 }),
    );

    const secondResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.local-validation.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-local-2"),
          programId: asProgramId("program-cto"),
          localValidation: {
            ...PROGRAM_LOCAL_VALIDATION,
            status: "failed",
            summary: "bun lint failed",
            recordedAt: "2026-04-20T00:16:00.000Z",
          },
        },
        readModel: withFirst,
      }),
    );
    const secondEvent = Array.isArray(secondResult) ? secondResult[0] : secondResult;
    const projected = await Effect.runPromise(
      projectEvent(withFirst, { ...secondEvent, sequence: 5 }),
    );

    expect((projected.programs ?? [])[0]?.localValidation).toEqual([
      {
        ...PROGRAM_LOCAL_VALIDATION,
        status: "failed",
        summary: "bun lint failed",
        recordedAt: "2026-04-20T00:16:00.000Z",
      },
    ]);
  });

  it("upserts app validation evidence by target+suiteId+kind", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const firstResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.app-validation.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-app-1"),
          programId: asProgramId("program-cto"),
          appValidation: PROGRAM_APP_VALIDATION,
        },
        readModel: created,
      }),
    );
    const firstEvent = Array.isArray(firstResult) ? firstResult[0] : firstResult;
    const withFirst = await Effect.runPromise(
      projectEvent(created, { ...firstEvent, sequence: 4 }),
    );

    const secondResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.app-validation.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-app-2"),
          programId: asProgramId("program-cto"),
          appValidation: {
            ...PROGRAM_APP_VALIDATION,
            status: "failed",
            summary: "Deploy blocked",
            recordedAt: "2026-04-20T00:17:00.000Z",
          },
        },
        readModel: withFirst,
      }),
    );
    const secondEvent = Array.isArray(secondResult) ? secondResult[0] : secondResult;
    const projected = await Effect.runPromise(
      projectEvent(withFirst, { ...secondEvent, sequence: 5 }),
    );

    expect((projected.programs ?? [])[0]?.appValidations).toEqual([
      {
        ...PROGRAM_APP_VALIDATION,
        status: "failed",
        summary: "Deploy blocked",
        recordedAt: "2026-04-20T00:17:00.000Z",
      },
    ]);
  });

  it("upserts observed repos by repo+source and persists post-flight evidence", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const observedResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.observed-repo.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-observed-1"),
          programId: asProgramId("program-cto"),
          observedRepo: PROGRAM_OBSERVED_REPO,
        },
        readModel: created,
      }),
    );
    const observedEvent = Array.isArray(observedResult) ? observedResult[0] : observedResult;
    const withObserved = await Effect.runPromise(
      projectEvent(created, { ...observedEvent, sequence: 4 }),
    );

    const observedReplaceResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.observed-repo.upsert",
          commandId: CommandId.makeUnsafe("cmd-program-observed-2"),
          programId: asProgramId("program-cto"),
          observedRepo: {
            ...PROGRAM_OBSERVED_REPO,
            observedAt: "2026-04-20T00:18:00.000Z",
          },
        },
        readModel: withObserved,
      }),
    );
    const observedReplaceEvent = Array.isArray(observedReplaceResult)
      ? observedReplaceResult[0]
      : observedReplaceResult;
    const withObservedReplace = await Effect.runPromise(
      projectEvent(withObserved, { ...observedReplaceEvent, sequence: 5 }),
    );

    const postFlightResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.post-flight.set",
          commandId: CommandId.makeUnsafe("cmd-program-post-flight"),
          programId: asProgramId("program-cto"),
          postFlight: PROGRAM_POST_FLIGHT,
        },
        readModel: withObservedReplace,
      }),
    );
    const postFlightEvent = Array.isArray(postFlightResult)
      ? postFlightResult[0]
      : postFlightResult;
    const projected = await Effect.runPromise(
      projectEvent(withObservedReplace, { ...postFlightEvent, sequence: 6 }),
    );

    expect((projected.programs ?? [])[0]?.observedRepos).toEqual([
      {
        ...PROGRAM_OBSERVED_REPO,
        observedAt: "2026-04-20T00:18:00.000Z",
      },
    ]);
    expect((projected.programs ?? [])[0]?.postFlight).toEqual(PROGRAM_POST_FLIGHT);
  });

  it("upserts and consumes program notifications on the program aggregate", async () => {
    const now = new Date().toISOString();
    const created = await makeCreatedProgramReadModel(now);

    const upsertResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.notification.upsert",
          commandId: CommandId.makeUnsafe("cmd-notify"),
          notificationId: asProgramNotificationId("notif-cto"),
          programId: asProgramId("program-cto"),
          kind: "decision_required",
          severity: "warning",
          summary: "Choose the deployment lane.",
          evidence: { workerThreadId: "thread-worker" },
          createdAt: now,
        },
        readModel: created,
      }),
    );
    const upsertEvent = Array.isArray(upsertResult) ? upsertResult[0] : upsertResult;
    expect(upsertEvent.type).toBe("program.notification-upserted");
    expect(upsertEvent.aggregateKind).toBe("program");
    expect(upsertEvent.aggregateId).toBe("program-cto");
    expect(upsertEvent.payload).toMatchObject({
      notificationId: "notif-cto",
      programId: "program-cto",
      executiveProjectId: "project-cto",
      executiveThreadId: "thread-cto",
      kind: "decision_required",
      severity: "warning",
      state: "pending",
      evidence: { workerThreadId: "thread-worker" },
    });

    const withNotification = await Effect.runPromise(
      projectEvent(created, { ...upsertEvent, sequence: 4 }),
    );
    const consumeResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "program.notification.consume",
          commandId: CommandId.makeUnsafe("cmd-notify-consume"),
          programId: asProgramId("program-cto"),
          notificationId: asProgramNotificationId("notif-cto"),
          consumeReason: "reviewed",
          consumedAt: now,
        },
        readModel: withNotification,
      }),
    );
    const consumeEvent = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
    expect(consumeEvent.type).toBe("program.notification-consumed");
    expect(consumeEvent.payload).toMatchObject({
      programId: "program-cto",
      notificationId: "notif-cto",
      consumedAt: now,
      consumeReason: "reviewed",
    });
  });

  it("rejects Jasper as a worker even when a caller bypasses the CLI guard", async () => {
    const now = new Date().toISOString();
    const readModel = await makeExecutiveReadModel(now);

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-jasper-worker"),
            threadId: asThreadId("thread-jasper-worker"),
            projectId: asProjectId("project-cto"),
            title: "Jasper worker bypass",
            labels: ["worker", "agent:jasper"],
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            spawnRole: "worker",
            spawnedBy: "cto",
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("Jasper is reserved for primary orchestrator threads");
  });
});
