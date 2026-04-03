import { describe, expect, it } from "vitest";
import {
  applyPromptHookOutput,
  projectHookMatchesContext,
  resolveProjectHookExecutionCwd,
  selectPromptHookOutput,
} from "./projectHooks";

describe("projectHooks helpers", () => {
  const beforePromptHook = {
    id: "search-context",
    name: "Search Context",
    trigger: "before-prompt" as const,
    enabled: true,
    command: "node search.js",
    executionTarget: "project-root-or-worktree" as const,
    timeoutMs: 15_000,
    selectors: {
      providers: ["codex"] as const,
      interactionModes: [],
      runtimeModes: [],
      turnStates: [],
    },
    onError: "fail" as const,
    output: {
      capture: "stdout" as const,
      placement: "before" as const,
      prefix: "Context:\n",
      suffix: "\nEnd.",
    },
  };

  it("matches provider and turn-state selectors", () => {
    expect(
      projectHookMatchesContext(beforePromptHook, {
        provider: "codex",
        interactionMode: "default",
        runtimeMode: "full-access",
      }),
    ).toBe(true);

    expect(
      projectHookMatchesContext(
        {
          ...beforePromptHook,
          trigger: "turn-completed" as const,
          selectors: {
            ...beforePromptHook.selectors,
            turnStates: ["failed"],
          },
        },
        {
          provider: "codex",
          interactionMode: "default",
          runtimeMode: "full-access",
          turnState: "completed",
        },
      ),
    ).toBe(false);
  });

  it("resolves cwd from execution target", () => {
    expect(
      resolveProjectHookExecutionCwd({
        executionTarget: "project-root",
        projectRoot: "/repo",
        worktreePath: "/repo-worktree",
      }),
    ).toBe("/repo");

    expect(
      resolveProjectHookExecutionCwd({
        executionTarget: "worktree",
        projectRoot: "/repo",
        worktreePath: null,
      }),
    ).toBeNull();
  });

  it("selects and applies prompt hook output", () => {
    const output = selectPromptHookOutput({
      hook: beforePromptHook,
      stdout: "hit one\nhit two",
      stderr: "",
    });
    expect(output).toBe("hit one\nhit two");
    expect(
      applyPromptHookOutput({
        prompt: "Investigate the failure",
        hook: beforePromptHook,
        output,
      }),
    ).toBe("Context:\nhit one\nhit two\nEnd.\n\nInvestigate the failure");
  });
});
