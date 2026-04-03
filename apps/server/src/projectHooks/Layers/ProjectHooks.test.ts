import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  type ThreadTurnStartCommand,
} from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectHooksService } from "../Services/ProjectHooksService.ts";
import { makeProjectHooksLive } from "./ProjectHooks.ts";

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-04-03T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        hooks: [
          {
            id: "search-context",
            name: "Search Context",
            trigger: "before-prompt",
            enabled: true,
            command: "node search.js",
            executionTarget: "project-root-or-worktree",
            timeoutMs: 15_000,
            selectors: {
              providers: [],
              interactionModes: [],
              runtimeModes: [],
              turnStates: [],
            },
            onError: "fail",
            output: {
              capture: "stdout",
              placement: "before",
              prefix: "Context:\n",
              suffix: "",
            },
          },
          {
            id: "notify-done",
            name: "Notify Done",
            trigger: "turn-completed",
            enabled: true,
            command: "node notify.js",
            executionTarget: "project-root-or-worktree",
            timeoutMs: 15_000,
            selectors: {
              providers: [],
              interactionModes: [],
              runtimeModes: [],
              turnStates: ["completed"],
            },
          },
        ],
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Thread",
        labels: [],
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: MessageId.makeUnsafe("message-1"),
            role: "user",
            text: "Investigate",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-03T00:00:00.000Z",
            updatedAt: "2026-04-03T00:00:00.000Z",
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
  };
}

function makeEngine(readModel: OrchestrationReadModel): OrchestrationEngineShape {
  return {
    getReadModel: () => Effect.succeed(readModel),
    readEvents: () => Stream.empty,
    dispatch: () => Effect.succeed({ sequence: 1 }),
    streamDomainEvents: Stream.empty,
  };
}

describe("ProjectHooks service", () => {
  it("prepends prompt hook output before dispatch", async () => {
    const runHookCommand = vi.fn(() =>
      Effect.succeed({
        stdout: "match one\nmatch two",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    );
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(Layer.succeed(OrchestrationEngineService, makeEngine(makeReadModel()))),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const command: ThreadTurnStartCommand = {
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-turn-start"),
      threadId: ThreadId.makeUnsafe("thread-1"),
      message: {
        messageId: MessageId.makeUnsafe("message-2"),
        role: "user",
        text: "Investigate this failure",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-03T00:00:00.000Z",
    };

    const next = await Effect.runPromise(service.prepareTurnStartCommand(command));
    expect(next.message.text).toBe("Context:\nmatch one\nmatch two\n\nInvestigate this failure");
    expect(runHookCommand).toHaveBeenCalledTimes(1);
  });

  it("deduplicates turn-completed hooks by turn id", async () => {
    const runHookCommand = vi.fn(() =>
      Effect.succeed({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    );
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(Layer.succeed(OrchestrationEngineService, makeEngine(makeReadModel()))),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }> = {
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-turn-completed"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: TurnId.makeUnsafe("turn-1"),
      createdAt: "2026-04-03T00:00:05.000Z",
      payload: {
        state: "completed",
      },
    };

    await Effect.runPromise(service.handleTurnCompleted(event));
    await Effect.runPromise(service.handleTurnCompleted(event));
    expect(runHookCommand).toHaveBeenCalledTimes(1);
  });
});
