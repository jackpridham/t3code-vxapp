import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ApprovalRequestId,
  ProgramId,
  ProgramNotificationId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-05-16T00:00:00.000Z";

async function expectOwnerBoundary(command: OrchestrationCommand) {
  await expect(
    Effect.runPromise(
      decideOrchestrationCommand({
        command,
        readModel: createEmptyReadModel(now),
      }),
    ),
  ).rejects.toThrow("owned by agents-vxapp");
  await expect(
    Effect.runPromise(
      decideOrchestrationCommand({
        command,
        readModel: createEmptyReadModel(now),
      }),
    ),
  ).rejects.toThrow("agentsVxappOwnerClient");
}

describe("agents-vxapp authority boundary", () => {
  it("rejects Program and notification command domains instead of deciding local truth", async () => {
    await expectOwnerBoundary({
      type: "program.create",
      commandId: CommandId.makeUnsafe("cmd-program-boundary"),
      programId: ProgramId.makeUnsafe("program-boundary"),
      title: "Program Boundary",
      objective: null,
      declaredRepos: ["repo"],
      affectedAppTargets: [],
      requiredLocalSuites: [],
      requiredExternalE2ESuites: [],
      requireDevelopmentDeploy: false,
      requireExternalE2E: false,
      requireCleanPostFlight: false,
      requirePrPerRepo: false,
      executiveProjectId: ProjectId.makeUnsafe("project-boundary"),
      executiveThreadId: ThreadId.makeUnsafe("thread-boundary"),
      createdAt: now,
    });

    await expectOwnerBoundary({
      type: "program.notification.upsert",
      commandId: CommandId.makeUnsafe("cmd-notification-boundary"),
      notificationId: ProgramNotificationId.makeUnsafe("notification-boundary"),
      programId: ProgramId.makeUnsafe("program-boundary"),
      kind: "blocked",
      summary: "Blocked",
      createdAt: now,
    });
  });

  it("rejects approval, user-input, and wake command domains instead of deciding local truth", async () => {
    await expectOwnerBoundary({
      type: "thread.approval.respond",
      commandId: CommandId.makeUnsafe("cmd-approval-boundary"),
      threadId: ThreadId.makeUnsafe("thread-boundary"),
      requestId: ApprovalRequestId.makeUnsafe("approval-boundary"),
      decision: "accept",
      createdAt: now,
    });

    await expectOwnerBoundary({
      type: "thread.user-input.respond",
      commandId: CommandId.makeUnsafe("cmd-user-input-boundary"),
      threadId: ThreadId.makeUnsafe("thread-boundary"),
      requestId: ApprovalRequestId.makeUnsafe("user-input-boundary"),
      answers: {},
      createdAt: now,
    });

    await expectOwnerBoundary({
      type: "thread.orchestrator-wake.upsert",
      commandId: CommandId.makeUnsafe("cmd-wake-boundary"),
      threadId: ThreadId.makeUnsafe("orchestrator-thread-boundary"),
      wakeItem: {
        wakeId: "wake-boundary",
        orchestratorThreadId: ThreadId.makeUnsafe("orchestrator-thread-boundary"),
        orchestratorProjectId: ProjectId.makeUnsafe("orchestrator-project-boundary"),
        workerThreadId: ThreadId.makeUnsafe("worker-thread-boundary"),
        workerProjectId: ProjectId.makeUnsafe("worker-project-boundary"),
        workerTurnId: TurnId.makeUnsafe("turn-boundary"),
        workerTitleSnapshot: "Worker",
        outcome: "completed",
        summary: "Done",
        queuedAt: now,
        state: "pending",
        deliveredAt: null,
        consumedAt: null,
      },
      createdAt: now,
    });
  });

  it("does not rebuild owner current truth from local Program, notification, or wake events", async () => {
    const model = createEmptyReadModel(now);
    const events: ReadonlyArray<OrchestrationEvent> = [
      {
        sequence: 1,
        eventId: "event-program" as OrchestrationEvent["eventId"],
        aggregateKind: "program",
        aggregateId: ProgramId.makeUnsafe("program-boundary"),
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "program.created",
        payload: {
          programId: ProgramId.makeUnsafe("program-boundary"),
          title: "Program Boundary",
          objective: null,
          status: "active",
          declaredRepos: ["repo"],
          affectedAppTargets: [],
          requiredLocalSuites: [],
          requiredExternalE2ESuites: [],
          requireDevelopmentDeploy: false,
          requireExternalE2E: false,
          requireCleanPostFlight: false,
          requirePrPerRepo: false,
          executiveProjectId: ProjectId.makeUnsafe("project-boundary"),
          executiveThreadId: ThreadId.makeUnsafe("thread-boundary"),
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
        },
      },
      {
        sequence: 2,
        eventId: "event-notification" as OrchestrationEvent["eventId"],
        aggregateKind: "program",
        aggregateId: ProgramId.makeUnsafe("program-boundary"),
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "program.notification-upserted",
        payload: {
          notificationId: ProgramNotificationId.makeUnsafe("notification-boundary"),
          programId: ProgramId.makeUnsafe("program-boundary"),
          executiveProjectId: ProjectId.makeUnsafe("project-boundary"),
          executiveThreadId: ThreadId.makeUnsafe("thread-boundary"),
          orchestratorThreadId: null,
          kind: "blocked",
          severity: "critical",
          summary: "Blocked",
          evidence: {},
          state: "pending",
          queuedAt: now,
          deliveredAt: null,
          consumedAt: null,
          droppedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    ];

    const afterEvents = await events.reduce(
      async (previous, event) => Effect.runPromise(projectEvent(await previous, event)),
      Promise.resolve(model),
    );

    expect(afterEvents.programs).toEqual([]);
    expect(afterEvents.programNotifications).toEqual([]);
    expect(afterEvents.ctoAttentionItems).toEqual([]);
    expect(afterEvents.orchestratorWakeItems).toEqual([]);
  });

  it("still accepts provider-local thread transport mechanics", async () => {
    const projectEventResult = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-local"),
          projectId: ProjectId.makeUnsafe("project-local"),
          title: "Local",
          workspaceRoot: "/tmp/local",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(createEmptyReadModel(now), {
        ...(Array.isArray(projectEventResult) ? projectEventResult[0]! : projectEventResult),
        sequence: 1,
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-local"),
            threadId: ThreadId.makeUnsafe("thread-local"),
            projectId: ProjectId.makeUnsafe("project-local"),
            title: "Local Thread",
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).resolves.toMatchObject({ type: "thread.created" });
  });

  it("keeps orchestration-core free of owner command literals or owner-client dependencies", () => {
    const deciderSource = readFileSync(new URL("./decider.ts", import.meta.url), "utf8");
    const invariantsSource = readFileSync(
      new URL("./commandInvariants.ts", import.meta.url),
      "utf8",
    );
    const projectorSource = readFileSync(new URL("./projector.ts", import.meta.url), "utf8");

    for (const source of [deciderSource, invariantsSource, projectorSource]) {
      expect(source).not.toMatch(/from\s+["'][^"']*agentsVxappOwnerClient(?:\.ts)?["']/);
      expect(source).not.toMatch(/t3code-[a-z0-9-]+/);
      expect(source).not.toMatch(
        /thread_(?:create|turn_start|turn_interrupt|session_stop|revert|archive|delete|lineage_update)/,
      );
    }
  });
});
