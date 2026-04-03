import type {
  BeforePromptProjectHook,
  ProjectHook,
  ProjectHookExecutionTarget,
  ProjectHookOutputCapture,
  ProjectHookOutputPlacement,
  ProjectHookPromptErrorMode,
  ProjectHookTurnState,
  TurnCompletedProjectHook,
} from "@t3tools/contracts";

const MAX_PROJECT_HOOK_ID_LENGTH = 64;

function normalizeProjectHookId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "hook";
  }
  if (cleaned.length <= MAX_PROJECT_HOOK_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_PROJECT_HOOK_ID_LENGTH).replace(/-+$/g, "") || "hook";
}

export function nextProjectHookId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeProjectHookId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_PROJECT_HOOK_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_PROJECT_HOOK_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`.slice(0, MAX_PROJECT_HOOK_ID_LENGTH);
}

export type NewProjectHookInput =
  | Omit<BeforePromptProjectHook, "id">
  | Omit<TurnCompletedProjectHook, "id">;

export const PROJECT_HOOK_TRIGGER_LABELS = {
  "before-prompt": "Before Prompt",
  "turn-completed": "Turn Completed",
} as const satisfies Record<ProjectHook["trigger"], string>;

export const PROJECT_HOOK_EXECUTION_TARGET_LABELS = {
  "project-root": "Project Root",
  worktree: "Active Worktree",
  "project-root-or-worktree": "Worktree Or Project Root",
} as const satisfies Record<ProjectHookExecutionTarget, string>;

export const PROJECT_HOOK_OUTPUT_CAPTURE_LABELS = {
  none: "Ignore Output",
  stdout: "stdout",
  stderr: "stderr",
  combined: "stdout + stderr",
} as const satisfies Record<ProjectHookOutputCapture, string>;

export const PROJECT_HOOK_OUTPUT_PLACEMENT_LABELS = {
  ignore: "Do Not Modify Prompt",
  before: "Insert Before Prompt",
  after: "Insert After Prompt",
} as const satisfies Record<ProjectHookOutputPlacement, string>;

export const PROJECT_HOOK_ERROR_MODE_LABELS = {
  fail: "Fail Send",
  continue: "Continue Without Hook Output",
} as const satisfies Record<ProjectHookPromptErrorMode, string>;

export const PROJECT_HOOK_TURN_STATE_LABELS = {
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
} as const satisfies Record<ProjectHookTurnState, string>;

export function describeProjectHook(hook: ProjectHook): string {
  const providerLabel =
    hook.selectors.providers.length === 1
      ? hook.selectors.providers[0] === "codex"
        ? "Codex"
        : "Claude"
      : "Any provider";
  if (hook.trigger === "before-prompt") {
    return `${PROJECT_HOOK_TRIGGER_LABELS[hook.trigger]} · ${providerLabel} · ${PROJECT_HOOK_OUTPUT_PLACEMENT_LABELS[hook.output.placement]}`;
  }
  const turnState =
    hook.selectors.turnStates.length === 1 && hook.selectors.turnStates[0] !== undefined
      ? PROJECT_HOOK_TURN_STATE_LABELS[hook.selectors.turnStates[0]]
      : "Any outcome";
  return `${PROJECT_HOOK_TRIGGER_LABELS[hook.trigger]} · ${providerLabel} · ${turnState}`;
}
