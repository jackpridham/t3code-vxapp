import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

const PROGRAM_DELIVERY_SPEC = {
  declaredRepos: ["t3code-vxapp"],
  affectedAppTargets: ["web"],
  requiredLocalSuites: [],
  requiredExternalE2ESuites: [],
  requireDevelopmentDeploy: false,
  requireExternalE2E: false,
  requireCleanPostFlight: false,
  requirePrPerRepo: false,
} as const;

async function expectProgramBoundary(
  command: Parameters<typeof decideOrchestrationCommand>[0]["command"],
) {
  await expect(
    Effect.runPromise(
      decideOrchestrationCommand({
        command,
        readModel: createEmptyReadModel("2026-04-20T00:00:00.000Z"),
      }),
    ),
  ).rejects.toBeInstanceOf(OrchestrationCommandInvariantError);
}

describe("decider programs", () => {
  it("rejects local program envelope creation because Program truth is owner-backed", async () => {
    const now = new Date().toISOString();

    await expectProgramBoundary({
      type: "program.create",
      commandId: CommandId.makeUnsafe("cmd-program-create"),
      programId: "program-cto" as never,
      title: "CTO web orchestration",
      objective: "Run CTO from web above Jasper.",
      ...PROGRAM_DELIVERY_SPEC,
      executiveProjectId: ProjectId.makeUnsafe("project-cto"),
      executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
      createdAt: now,
    });
  });

  it("rejects the full local program status/create surface", async () => {
    const now = new Date().toISOString();

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
      await expectProgramBoundary({
        type: "program.create",
        commandId: CommandId.makeUnsafe(`cmd-program-${status}`),
        programId: `program-${status}` as never,
        title: `Program ${status}`,
        ...PROGRAM_DELIVERY_SPEC,
        status,
        executiveProjectId: ProjectId.makeUnsafe("project-cto"),
        executiveThreadId: ThreadId.makeUnsafe("thread-cto"),
        createdAt: now,
      });
    }
  });

  it("rejects local program scope and lifecycle mutations", async () => {
    await expectProgramBoundary({
      type: "program.scope.update",
      commandId: CommandId.makeUnsafe("cmd-program-scope-update"),
      programId: "program-cto" as never,
      declaredRepos: ["t3code-vxapp", "vortex-scripts"],
      affectedAppTargets: ["web", "api"],
      requireExternalE2E: false,
    });

    await expectProgramBoundary({
      type: "program.meta.update",
      commandId: CommandId.makeUnsafe("cmd-program-complete"),
      programId: "program-cto" as never,
      status: "completed",
    });

    await expectProgramBoundary({
      type: "program.meta.update",
      commandId: CommandId.makeUnsafe("cmd-program-cancel"),
      programId: "program-cto" as never,
      status: "cancelled",
      cancelReason: "Founder superseded the scope",
      cancelledAt: "2026-04-20T00:21:00.000Z",
      supersededByProgramId: "program-cto-v2" as never,
    });
  });

  it("rejects local program evidence and notification mutations", async () => {
    const now = new Date().toISOString();

    for (const command of [
      {
        type: "program.repo-pr.upsert",
        commandId: CommandId.makeUnsafe("cmd-program-pr"),
        programId: "program-cto" as never,
        repoPr: {
          repo: "t3code-vxapp",
          url: "https://github.com/t3tools/t3code-vxapp/pull/42",
          number: 42 as never,
          state: "OPEN",
          isDraft: false,
          reviewDecision: "APPROVED",
          mergeStateStatus: "CLEAN",
          headRefName: "feature/program-closeout",
          baseRefName: "main",
          updatedAt: now,
        },
      },
      {
        type: "program.local-validation.upsert",
        commandId: CommandId.makeUnsafe("cmd-program-local"),
        programId: "program-cto" as never,
        localValidation: {
          repo: "t3code-vxapp",
          suiteId: "lint",
          kind: "bun_lint",
          status: "passed",
          summary: "bun lint passed",
          command: "bun lint",
          recordedAt: now,
        },
      },
      {
        type: "program.app-validation.upsert",
        commandId: CommandId.makeUnsafe("cmd-program-app"),
        programId: "program-cto" as never,
        appValidation: {
          target: "web",
          kind: "development_deploy",
          suiteId: "dev-deploy",
          status: "passed",
          summary: "Development deploy succeeded",
          command: "vx apps web --deploy development",
          url: "https://web.dev.example.test",
          recordedAt: now,
        },
      },
      {
        type: "program.observed-repo.upsert",
        commandId: CommandId.makeUnsafe("cmd-program-observed"),
        programId: "program-cto" as never,
        observedRepo: {
          repo: "t3code-vxapp",
          source: "git-status",
          observedAt: now,
        },
      },
      {
        type: "program.post-flight.set",
        commandId: CommandId.makeUnsafe("cmd-program-post-flight"),
        programId: "program-cto" as never,
        postFlight: {
          status: "clean",
          summary: "Worktree clean after validation and push",
          recordedAt: now,
        },
      },
      {
        type: "program.notification.upsert",
        commandId: CommandId.makeUnsafe("cmd-program-notification-upsert"),
        programId: "program-cto" as never,
        notificationId: "notification-1" as never,
        kind: "blocked",
        summary: "Program blocked pending review.",
        severity: "critical",
        evidence: {
          workerThreadId: ThreadId.makeUnsafe("thread-worker"),
        },
        correlationId: "corr-notification",
        sourceThreadId: ThreadId.makeUnsafe("thread-worker"),
        sourceRole: "worker",
        createdAt: now,
      },
      {
        type: "program.notification.consume",
        commandId: CommandId.makeUnsafe("cmd-program-notification-consume"),
        programId: "program-cto" as never,
        notificationId: "notification-1" as never,
        consumeReason: "reviewed",
        consumedAt: now,
      },
    ] as const) {
      await expectProgramBoundary(command);
    }
  });

  it("still accepts provider-local transport mechanics outside the Program owner surface", async () => {
    const now = new Date().toISOString();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create"),
          projectId: ProjectId.makeUnsafe("project-transport"),
          title: "Transport",
          workspaceRoot: "/tmp/transport",
          createdAt: now,
        },
        readModel: createEmptyReadModel(now),
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect(event.aggregateKind).toBe("project");
    expect(event.aggregateId).toBe(ProjectId.makeUnsafe("project-transport"));
  });
});
