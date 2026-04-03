import type {
  BeforePromptProjectHook,
  ProjectHook,
  ProjectHookExecutionTarget,
  ProjectHookTurnState,
} from "@t3tools/contracts";

export function projectHookMatchesContext(
  hook: ProjectHook,
  context: {
    provider: "codex" | "claudeAgent";
    interactionMode: "default" | "plan";
    runtimeMode: "approval-required" | "full-access";
    turnState?: ProjectHookTurnState | undefined;
  },
): boolean {
  if (hook.selectors.providers.length > 0 && !hook.selectors.providers.includes(context.provider)) {
    return false;
  }
  if (
    hook.selectors.interactionModes.length > 0 &&
    !hook.selectors.interactionModes.includes(context.interactionMode)
  ) {
    return false;
  }
  if (
    hook.selectors.runtimeModes.length > 0 &&
    !hook.selectors.runtimeModes.includes(context.runtimeMode)
  ) {
    return false;
  }
  if (hook.selectors.turnStates.length === 0) {
    return true;
  }
  return context.turnState !== undefined && hook.selectors.turnStates.includes(context.turnState);
}

export function resolveProjectHookExecutionCwd(input: {
  executionTarget: ProjectHookExecutionTarget;
  projectRoot: string;
  worktreePath: string | null;
}): string | null {
  switch (input.executionTarget) {
    case "project-root":
      return input.projectRoot;
    case "worktree":
      return input.worktreePath;
    case "project-root-or-worktree":
      return input.worktreePath ?? input.projectRoot;
  }
}

export function selectPromptHookOutput(input: {
  hook: BeforePromptProjectHook;
  stdout: string;
  stderr: string;
}): string {
  switch (input.hook.output.capture) {
    case "none":
      return "";
    case "stderr":
      return input.stderr;
    case "combined":
      return [input.stdout, input.stderr].filter((value) => value.length > 0).join("\n");
    case "stdout":
    default:
      return input.stdout;
  }
}

export function applyPromptHookOutput(input: {
  prompt: string;
  hook: BeforePromptProjectHook;
  output: string;
}): string {
  if (input.hook.output.placement === "ignore") {
    return input.prompt;
  }

  const trimmedOutput = input.output.trim();
  if (trimmedOutput.length === 0) {
    return input.prompt;
  }

  const decorated = `${input.hook.output.prefix}${trimmedOutput}${input.hook.output.suffix}`;
  if (input.hook.output.placement === "before") {
    return [decorated, input.prompt].filter((value) => value.length > 0).join("\n\n");
  }
  return [input.prompt, decorated].filter((value) => value.length > 0).join("\n\n");
}
