import {
  CommandId,
  EventId,
  type BeforePromptProjectHook,
  type OrchestrationReadModel,
  type ProjectHook,
  type ProjectHookTurnState,
  type ProviderRuntimeEvent,
  type ThreadTurnStartCommand,
} from "@t3tools/contracts";
import {
  applyPromptHookOutput,
  projectHookMatchesContext,
  resolveProjectHookExecutionCwd,
  selectPromptHookOutput,
} from "@t3tools/shared/projectHooks";
import { resolveLoginShell } from "@t3tools/shared/shell";
import { Cache, Duration, Effect, Layer, Schema } from "effect";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { runProcess, type ProcessRunResult } from "../../processRunner.ts";
import { ProjectHooksService, type ProjectHooksShape } from "../Services/ProjectHooksService.ts";

const COMPLETED_HOOK_TTL = Duration.hours(12);
const COMPLETED_HOOK_CACHE_CAPACITY = 10_000;
const HOOK_OUTPUT_BUFFER_BYTES = 64 * 1024;
const HOOK_OUTPUT_TRUNCATED_MARKER = "\n[project hook output truncated]";

type RunHookCommand = (input: {
  hook: ProjectHook;
  cwd: string;
  stdin: string;
  env: NodeJS.ProcessEnv;
}) => Effect.Effect<ProcessRunResult, Error>;

class ProjectHookCommandError extends Schema.TaggedErrorClass<ProjectHookCommandError>()(
  "ProjectHookCommandError",
  {
    hookId: Schema.String,
    hookName: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Project hook "${this.hookName}" failed: ${this.detail}`;
  }
}

function resolveShellInvocation(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  return {
    command: resolveLoginShell(process.platform, process.env.SHELL) ?? "/bin/sh",
    args: ["-lc", command],
  };
}

function appendTruncationMarker(value: string, truncated: boolean | undefined): string {
  if (!truncated) {
    return value;
  }
  return `${value}${HOOK_OUTPUT_TRUNCATED_MARKER}`;
}

function logHookWarning(message: string, detail: Record<string, unknown>): void {
  console.warn(`[project-hooks] ${message}`, detail);
}

function makeHookEnv(input: {
  hook: ProjectHook;
  project: OrchestrationReadModel["projects"][number];
  thread: OrchestrationReadModel["threads"][number];
  provider: "codex" | "claudeAgent";
  messageId?: string;
  promptText?: string;
  turnId?: string;
  turnState?: ProjectHookTurnState;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_HOOK_ID: input.hook.id,
    T3CODE_HOOK_NAME: input.hook.name,
    T3CODE_HOOK_TRIGGER: input.hook.trigger,
    T3CODE_PROJECT_ID: input.project.id,
    T3CODE_PROJECT_ROOT: input.project.workspaceRoot,
    T3CODE_THREAD_ID: input.thread.id,
    T3CODE_THREAD_TITLE: input.thread.title,
    T3CODE_THREAD_PROVIDER: input.provider,
    T3CODE_THREAD_RUNTIME_MODE: input.thread.runtimeMode,
    T3CODE_THREAD_INTERACTION_MODE: input.thread.interactionMode,
  };

  if (input.thread.worktreePath) {
    env.T3CODE_THREAD_WORKTREE_PATH = input.thread.worktreePath;
  }
  if (input.messageId) {
    env.T3CODE_MESSAGE_ID = input.messageId;
  }
  if (input.turnId) {
    env.T3CODE_TURN_ID = input.turnId;
  }
  if (input.turnState) {
    env.T3CODE_TURN_STATE = input.turnState;
  }
  if (input.promptText && input.promptText.length <= 4_000) {
    env.T3CODE_PROMPT_TEXT = input.promptText;
  }

  return env;
}

function resolveProjectThreadContext(
  readModel: OrchestrationReadModel,
  threadId: string,
): {
  project: OrchestrationReadModel["projects"][number];
  thread: OrchestrationReadModel["threads"][number];
} | null {
  const thread = readModel.threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return null;
  }
  const project = readModel.projects.find(
    (entry) => entry.id === thread.projectId && entry.deletedAt === null,
  );
  if (!project) {
    return null;
  }
  return { project, thread };
}

function latestMessageText(
  thread: OrchestrationReadModel["threads"][number],
  role: "user" | "assistant",
): string | null {
  const messages = thread.messages.filter((message) => message.role === role);
  return messages.length > 0 ? (messages[messages.length - 1]?.text ?? null) : null;
}

function buildPromptHookContextJson(input: {
  hook: BeforePromptProjectHook;
  project: OrchestrationReadModel["projects"][number];
  thread: OrchestrationReadModel["threads"][number];
  provider: "codex" | "claudeAgent";
  command: ThreadTurnStartCommand;
  promptText: string;
}): string {
  return `${JSON.stringify(
    {
      hook: {
        id: input.hook.id,
        name: input.hook.name,
        trigger: input.hook.trigger,
      },
      project: {
        id: input.project.id,
        title: input.project.title,
        workspaceRoot: input.project.workspaceRoot,
      },
      thread: {
        id: input.thread.id,
        title: input.thread.title,
        runtimeMode: input.command.runtimeMode,
        interactionMode: input.command.interactionMode,
        provider: input.provider,
        branch: input.thread.branch,
        worktreePath: input.thread.worktreePath,
      },
      message: {
        id: input.command.message.messageId,
        text: input.promptText,
        attachments: input.command.message.attachments,
      },
      createdAt: input.command.createdAt,
    },
    null,
    2,
  )}\n`;
}

function buildTurnCompletedContextJson(input: {
  hook: ProjectHook;
  project: OrchestrationReadModel["projects"][number];
  thread: OrchestrationReadModel["threads"][number];
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
  turnState: ProjectHookTurnState;
}): string {
  return `${JSON.stringify(
    {
      hook: {
        id: input.hook.id,
        name: input.hook.name,
        trigger: input.hook.trigger,
      },
      project: {
        id: input.project.id,
        title: input.project.title,
        workspaceRoot: input.project.workspaceRoot,
      },
      thread: {
        id: input.thread.id,
        title: input.thread.title,
        runtimeMode: input.thread.runtimeMode,
        interactionMode: input.thread.interactionMode,
        provider: input.event.provider,
        branch: input.thread.branch,
        worktreePath: input.thread.worktreePath,
      },
      turn: {
        id: input.event.turnId,
        state: input.turnState,
        createdAt: input.event.createdAt,
        errorMessage: input.event.payload.errorMessage ?? null,
        stopReason: input.event.payload.stopReason ?? null,
      },
      latestUserMessage: latestMessageText(input.thread, "user"),
      latestAssistantMessage: latestMessageText(input.thread, "assistant"),
    },
    null,
    2,
  )}\n`;
}

function makeProjectHooks(options?: { runHookCommand?: RunHookCommand }) {
  return Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const completedHooks = yield* Cache.make<string, true>({
      capacity: COMPLETED_HOOK_CACHE_CAPACITY,
      timeToLive: COMPLETED_HOOK_TTL,
      lookup: () => Effect.succeed(true),
    });

    const runHookCommand: RunHookCommand =
      options?.runHookCommand ??
      ((input) =>
        Effect.tryPromise({
          try: () => {
            const invocation = resolveShellInvocation(input.hook.command);
            return runProcess(invocation.command, invocation.args, {
              cwd: input.cwd,
              env: input.env,
              stdin: input.stdin,
              timeoutMs: input.hook.timeoutMs,
              maxBufferBytes: HOOK_OUTPUT_BUFFER_BYTES,
              outputMode: "truncate",
            });
          },
          catch: (error) =>
            new ProjectHookCommandError({
              hookId: input.hook.id,
              hookName: input.hook.name,
              detail:
                error instanceof Error
                  ? error.message
                  : `Project hook "${input.hook.name}" failed to run.`,
            }),
        }));

    const appendHookFailureActivity = (input: {
      threadId: OrchestrationReadModel["threads"][number]["id"];
      hook: ProjectHook;
      detail: string;
      createdAt: string;
      turnId?: ProviderRuntimeEvent["turnId"];
    }) =>
      orchestrationEngine
        .dispatch({
          type: "thread.activity.append",
          commandId: CommandId.makeUnsafe(`project-hook-failure:${crypto.randomUUID()}`),
          threadId: input.threadId,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            tone: "error",
            kind: "project.hook.failed",
            summary: `Project hook "${input.hook.name}" failed`,
            payload: {
              hookId: input.hook.id,
              trigger: input.hook.trigger,
              detail: input.detail,
            },
            turnId: input.turnId ?? null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        })
        .pipe(Effect.ignoreCause({ log: true }));

    const hasHandledCompletedHook = (key: string) =>
      Cache.getOption(completedHooks, key).pipe(
        Effect.flatMap((existing) =>
          Cache.set(completedHooks, key, true).pipe(Effect.as(existing._tag === "Some")),
        ),
      );

    const prepareTurnStartCommand: ProjectHooksShape["prepareTurnStartCommand"] = (command) =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const context = resolveProjectThreadContext(readModel, command.threadId);
        if (!context) {
          return command;
        }

        const provider = command.modelSelection?.provider ?? context.thread.modelSelection.provider;
        const hooks = context.project.hooks.filter(
          (hook): hook is BeforePromptProjectHook =>
            hook.enabled && hook.trigger === "before-prompt",
        );
        if (hooks.length === 0) {
          return command;
        }

        let promptText = command.message.text;

        for (const hook of hooks) {
          if (
            !projectHookMatchesContext(hook, {
              provider,
              interactionMode: command.interactionMode,
              runtimeMode: command.runtimeMode,
            })
          ) {
            continue;
          }

          const cwd = resolveProjectHookExecutionCwd({
            executionTarget: hook.executionTarget,
            projectRoot: context.project.workspaceRoot,
            worktreePath: context.thread.worktreePath,
          });
          if (!cwd) {
            const error = new Error(`Project hook "${hook.name}" requires an active worktree.`);
            if (hook.onError === "continue") {
              yield* Effect.sync(() =>
                logHookWarning("prompt hook skipped without worktree", {
                  threadId: context.thread.id,
                  hookId: hook.id,
                  hookName: hook.name,
                }),
              );
              continue;
            }
            return yield* Effect.fail(error);
          }

          const stdin = buildPromptHookContextJson({
            hook,
            project: context.project,
            thread: context.thread,
            provider,
            command,
            promptText,
          });
          const env = makeHookEnv({
            hook,
            project: context.project,
            thread: context.thread,
            provider,
            messageId: command.message.messageId,
            promptText,
          });

          const result = yield* runHookCommand({
            hook,
            cwd,
            stdin,
            env,
          }).pipe(
            Effect.catch((error: Error) => {
              if (hook.onError === "continue") {
                return Effect.sync(() =>
                  logHookWarning("prompt hook failed but send will continue", {
                    threadId: context.thread.id,
                    hookId: hook.id,
                    hookName: hook.name,
                    detail: error.message,
                  }),
                ).pipe(Effect.as(null));
              }
              return Effect.fail(error);
            }),
          );
          if (result === null) {
            continue;
          }

          const output = selectPromptHookOutput({
            hook,
            stdout: appendTruncationMarker(result.stdout, result.stdoutTruncated),
            stderr: appendTruncationMarker(result.stderr, result.stderrTruncated),
          });
          promptText = applyPromptHookOutput({
            prompt: promptText,
            hook,
            output,
          });
        }

        return {
          ...command,
          message: {
            ...command.message,
            text: promptText,
          },
        };
      });

    const handleTurnCompleted: ProjectHooksShape["handleTurnCompleted"] = (event) =>
      Effect.gen(function* () {
        if (!event.turnId) {
          return;
        }

        const readModel = yield* orchestrationEngine.getReadModel();
        const context = resolveProjectThreadContext(readModel, event.threadId);
        if (!context) {
          return;
        }

        const turnState = event.payload.state;
        const hooks = context.project.hooks.filter(
          (hook) => hook.enabled && hook.trigger === "turn-completed",
        );

        for (const hook of hooks) {
          if (
            !projectHookMatchesContext(hook, {
              provider: event.provider,
              interactionMode: context.thread.interactionMode,
              runtimeMode: context.thread.runtimeMode,
              turnState,
            })
          ) {
            continue;
          }

          const dedupeKey = `${context.thread.id}:${event.turnId}:${hook.id}:${turnState}`;
          if (yield* hasHandledCompletedHook(dedupeKey)) {
            continue;
          }

          const cwd = resolveProjectHookExecutionCwd({
            executionTarget: hook.executionTarget,
            projectRoot: context.project.workspaceRoot,
            worktreePath: context.thread.worktreePath,
          });
          if (!cwd) {
            yield* appendHookFailureActivity({
              threadId: context.thread.id,
              hook,
              detail: `Hook "${hook.name}" requires an active worktree.`,
              createdAt: event.createdAt,
              turnId: event.turnId,
            });
            continue;
          }

          const stdin = buildTurnCompletedContextJson({
            hook,
            project: context.project,
            thread: context.thread,
            event,
            turnState,
          });
          const env = makeHookEnv({
            hook,
            project: context.project,
            thread: context.thread,
            provider: event.provider,
            turnId: event.turnId,
            turnState,
          });

          yield* runHookCommand({
            hook,
            cwd,
            stdin,
            env,
          }).pipe(
            Effect.catch((error: Error) =>
              Effect.sync(() =>
                logHookWarning("turn-completed hook failed", {
                  threadId: context.thread.id,
                  hookId: hook.id,
                  hookName: hook.name,
                  detail: error.message,
                }),
              ).pipe(
                Effect.flatMap(() =>
                  appendHookFailureActivity({
                    threadId: context.thread.id,
                    hook,
                    detail: error.message,
                    createdAt: event.createdAt,
                    turnId: event.turnId,
                  }),
                ),
              ),
            ),
          );
        }
      });

    return {
      prepareTurnStartCommand,
      handleTurnCompleted,
    } satisfies ProjectHooksShape;
  });
}

export const ProjectHooksLive = Layer.effect(ProjectHooksService, makeProjectHooks());
export const makeProjectHooksLive = makeProjectHooks;
