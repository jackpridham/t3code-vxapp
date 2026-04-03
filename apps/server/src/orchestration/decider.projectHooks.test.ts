import { CommandId, EventId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

describe("decider project hooks", () => {
  it("emits empty hooks on project.create", async () => {
    const now = new Date().toISOString();
    const readModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-create-hooks"),
          projectId: asProjectId("project-hooks"),
          title: "Hooks",
          workspaceRoot: "/tmp/hooks",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect((event.payload as { hooks: unknown[] }).hooks).toEqual([]);
  });

  it("propagates hooks in project.meta.update payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-hooks"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-hooks"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-project-create-hooks"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-project-create-hooks"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-hooks"),
          title: "Hooks",
          workspaceRoot: "/tmp/hooks",
          defaultModelSelection: null,
          scripts: [],
          hooks: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const hooks = [
      {
        id: "search-context",
        name: "Search Context",
        trigger: "before-prompt" as const,
        enabled: true,
        command: "node search.js",
        executionTarget: "project-root-or-worktree" as const,
        timeoutMs: 15_000,
        selectors: {
          providers: [],
          interactionModes: [],
          runtimeModes: [],
          turnStates: [],
        },
        onError: "fail" as const,
        output: {
          capture: "stdout" as const,
          placement: "before" as const,
          prefix: "",
          suffix: "",
        },
      },
    ];

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-project-update-hooks"),
          projectId: asProjectId("project-hooks"),
          hooks,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.meta-updated");
    expect((event.payload as { hooks?: unknown[] }).hooks).toEqual(hooks);
  });
});
