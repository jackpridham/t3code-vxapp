import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  type ProjectHook,
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

function makeReadModel(options?: {
  hooks?: ProjectHook[];
  worktreePath?: string | null;
}): OrchestrationReadModel {
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
        hooks: options?.hooks ?? [beforePromptHook(), turnCompletedHook()],
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    orchestratorWakeItems: [],
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
        worktreePath: options?.worktreePath ?? null,
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

function beforePromptHook(
  overrides?: Partial<Extract<ProjectHook, { trigger: "before-prompt" }>>,
): Extract<ProjectHook, { trigger: "before-prompt" }> {
  return {
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
    ...overrides,
  };
}

function turnCompletedHook(
  overrides?: Partial<Extract<ProjectHook, { trigger: "turn-completed" }>>,
): Extract<ProjectHook, { trigger: "turn-completed" }> {
  return {
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
    ...overrides,
  };
}

function makeEngine(
  readModel: OrchestrationReadModel,
  dispatch = vi.fn(),
): OrchestrationEngineShape {
  return {
    getReadModel: () => Effect.succeed(readModel),
    readEvents: () => Stream.empty,
    dispatch: (command) => {
      dispatch(command);
      return Effect.succeed({ sequence: 1 });
    },
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

  it("continues without rewriting the prompt when a prompt hook fails in continue mode", async () => {
    const runHookCommand = vi.fn(() => Effect.fail(new Error("prompt hook exploded")));
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(
        Layer.succeed(
          OrchestrationEngineService,
          makeEngine(
            makeReadModel({
              hooks: [beforePromptHook({ onError: "continue" })],
            }),
          ),
        ),
      ),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const command: ThreadTurnStartCommand = {
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-turn-start-continue"),
      threadId: ThreadId.makeUnsafe("thread-1"),
      message: {
        messageId: MessageId.makeUnsafe("message-3"),
        role: "user",
        text: "Keep the original prompt",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-03T00:00:00.000Z",
    };

    const next = await Effect.runPromise(service.prepareTurnStartCommand(command));
    expect(next.message.text).toBe("Keep the original prompt");
    expect(runHookCommand).toHaveBeenCalledTimes(1);
  });

  it("skips a continue-mode prompt hook that requires a worktree when none is active", async () => {
    const runHookCommand = vi.fn();
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(
        Layer.succeed(
          OrchestrationEngineService,
          makeEngine(
            makeReadModel({
              hooks: [
                beforePromptHook({
                  executionTarget: "worktree",
                  onError: "continue",
                }),
              ],
              worktreePath: null,
            }),
          ),
        ),
      ),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const command: ThreadTurnStartCommand = {
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-turn-start-no-worktree"),
      threadId: ThreadId.makeUnsafe("thread-1"),
      message: {
        messageId: MessageId.makeUnsafe("message-4"),
        role: "user",
        text: "No worktree available",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-03T00:00:00.000Z",
    };

    const next = await Effect.runPromise(service.prepareTurnStartCommand(command));
    expect(next.message.text).toBe("No worktree available");
    expect(runHookCommand).not.toHaveBeenCalled();
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

  it("appends a thread activity when a completed hook requires a missing worktree", async () => {
    const dispatch = vi.fn();
    const runHookCommand = vi.fn();
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(
        Layer.succeed(
          OrchestrationEngineService,
          makeEngine(
            makeReadModel({
              hooks: [turnCompletedHook({ executionTarget: "worktree" })],
              worktreePath: null,
            }),
            dispatch,
          ),
        ),
      ),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }> = {
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-turn-completed-no-worktree"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: TurnId.makeUnsafe("turn-2"),
      createdAt: "2026-04-03T00:00:05.000Z",
      payload: {
        state: "completed",
      },
    };

    await Effect.runPromise(service.handleTurnCompleted(event));

    expect(runHookCommand).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.activity.append",
        threadId: ThreadId.makeUnsafe("thread-1"),
        activity: expect.objectContaining({
          kind: "project.hook.failed",
          payload: expect.objectContaining({
            hookId: "notify-done",
            detail: 'Hook "Notify Done" requires an active worktree.',
          }),
        }),
      }),
    );
  });

  it("appends a thread activity when a completed hook command fails", async () => {
    const dispatch = vi.fn();
    const runHookCommand = vi.fn(() => Effect.fail(new Error("notify hook failed")));
    const layer = Layer.effect(ProjectHooksService, makeProjectHooksLive({ runHookCommand })).pipe(
      Layer.provide(
        Layer.succeed(
          OrchestrationEngineService,
          makeEngine(makeReadModel({ hooks: [turnCompletedHook()] }), dispatch),
        ),
      ),
    );

    const runtime = ManagedRuntime.make(layer);
    const service = await runtime.runPromise(Effect.service(ProjectHooksService));
    const event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }> = {
      type: "turn.completed",
      eventId: EventId.makeUnsafe("evt-turn-completed-failure"),
      provider: "codex",
      threadId: ThreadId.makeUnsafe("thread-1"),
      turnId: TurnId.makeUnsafe("turn-3"),
      createdAt: "2026-04-03T00:00:05.000Z",
      payload: {
        state: "completed",
      },
    };

    await Effect.runPromise(service.handleTurnCompleted(event));

    expect(runHookCommand).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.activity.append",
        activity: expect.objectContaining({
          kind: "project.hook.failed",
          payload: expect.objectContaining({
            hookId: "notify-done",
            detail: "notify hook failed",
          }),
        }),
      }),
    );
  });
});
