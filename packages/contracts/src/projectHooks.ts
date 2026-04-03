import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import type { ProviderInteractionMode, ProviderKind, RuntimeMode } from "./orchestration";

const ProjectHookProviderKind = Schema.Literals(["codex", "claudeAgent"]);
const ProjectHookInteractionMode = Schema.Literals(["default", "plan"]);
const ProjectHookRuntimeMode = Schema.Literals(["approval-required", "full-access"]);

export const ProjectHookId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
);
export type ProjectHookId = typeof ProjectHookId.Type;

export const ProjectHookName = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
export type ProjectHookName = typeof ProjectHookName.Type;

export const ProjectHookCommand = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));
export type ProjectHookCommand = typeof ProjectHookCommand.Type;

const ProjectHookTextEnvelope = Schema.String.check(Schema.isMaxLength(4_000));

export const ProjectHookTrigger = Schema.Literals(["before-prompt", "turn-completed"]);
export type ProjectHookTrigger = typeof ProjectHookTrigger.Type;

export const ProjectHookExecutionTarget = Schema.Literals([
  "project-root",
  "worktree",
  "project-root-or-worktree",
]);
export type ProjectHookExecutionTarget = typeof ProjectHookExecutionTarget.Type;

export const ProjectHookTurnState = Schema.Literals([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export type ProjectHookTurnState = typeof ProjectHookTurnState.Type;

export const ProjectHookPromptErrorMode = Schema.Literals(["fail", "continue"]);
export type ProjectHookPromptErrorMode = typeof ProjectHookPromptErrorMode.Type;

export const ProjectHookOutputCapture = Schema.Literals(["none", "stdout", "stderr", "combined"]);
export type ProjectHookOutputCapture = typeof ProjectHookOutputCapture.Type;

export const ProjectHookOutputPlacement = Schema.Literals(["ignore", "before", "after"]);
export type ProjectHookOutputPlacement = typeof ProjectHookOutputPlacement.Type;

export const DEFAULT_PROJECT_HOOK_TIMEOUT_MS = 15_000;

export const ProjectHookSelectors = Schema.Struct({
  providers: Schema.Array(ProjectHookProviderKind).pipe(Schema.withDecodingDefault(() => [])),
  interactionModes: Schema.Array(ProjectHookInteractionMode).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  runtimeModes: Schema.Array(ProjectHookRuntimeMode).pipe(Schema.withDecodingDefault(() => [])),
  turnStates: Schema.Array(ProjectHookTurnState).pipe(Schema.withDecodingDefault(() => [])),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type ProjectHookSelectors = {
  providers: ProviderKind[];
  interactionModes: ProviderInteractionMode[];
  runtimeModes: RuntimeMode[];
  turnStates: ProjectHookTurnState[];
};

const ProjectHookBase = Schema.Struct({
  id: ProjectHookId,
  name: ProjectHookName,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  command: ProjectHookCommand,
  executionTarget: ProjectHookExecutionTarget.pipe(
    Schema.withDecodingDefault(() => "project-root-or-worktree"),
  ),
  timeoutMs: NonNegativeInt.pipe(Schema.withDecodingDefault(() => DEFAULT_PROJECT_HOOK_TIMEOUT_MS)),
  selectors: ProjectHookSelectors,
});

export const ProjectHookPromptOutput = Schema.Struct({
  capture: ProjectHookOutputCapture.pipe(Schema.withDecodingDefault(() => "stdout")),
  placement: ProjectHookOutputPlacement.pipe(Schema.withDecodingDefault(() => "ignore")),
  prefix: ProjectHookTextEnvelope.pipe(Schema.withDecodingDefault(() => "")),
  suffix: ProjectHookTextEnvelope.pipe(Schema.withDecodingDefault(() => "")),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type ProjectHookPromptOutput = typeof ProjectHookPromptOutput.Type;

export const BeforePromptProjectHook = Schema.Struct({
  ...ProjectHookBase.fields,
  trigger: Schema.Literal("before-prompt"),
  onError: ProjectHookPromptErrorMode.pipe(Schema.withDecodingDefault(() => "fail")),
  output: ProjectHookPromptOutput,
});
export type BeforePromptProjectHook = typeof BeforePromptProjectHook.Type;

export const TurnCompletedProjectHook = Schema.Struct({
  ...ProjectHookBase.fields,
  trigger: Schema.Literal("turn-completed"),
});
export type TurnCompletedProjectHook = typeof TurnCompletedProjectHook.Type;

export const ProjectHook = Schema.Union([BeforePromptProjectHook, TurnCompletedProjectHook]);
export type ProjectHook = typeof ProjectHook.Type;

export const ProjectHooks = Schema.Array(ProjectHook).pipe(Schema.withDecodingDefault(() => []));
export type ProjectHooks = typeof ProjectHooks.Type;
