import { CheckpointRef, ThreadId, TurnId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProjectionOperationalQuery,
  type ProjectionOperationalQueryShape,
  type ProjectionThreadCheckpointContext,
} from "../../orchestration/Services/ProjectionOperationalQuery.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointDiffQueryLive } from "./CheckpointDiffQuery.ts";
import { CheckpointStore, type CheckpointStoreShape } from "../Services/CheckpointStore.ts";
import { CheckpointDiffQuery } from "../Services/CheckpointDiffQuery.ts";

function makeThreadCheckpointContext(input: {
  readonly threadId: ThreadId;
  readonly workspaceCwd: string | null;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
}): ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    threadFound: true,
    workspaceCwd: input.workspaceCwd,
    checkpoints: [
      {
        turnId: TurnId.makeUnsafe("turn-1"),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function makeProjectionOperationalQuery(
  context: ProjectionThreadCheckpointContext,
): ProjectionOperationalQueryShape {
  const unused = () => Effect.die("unexpected ProjectionOperationalQuery call");
  return {
    getReadiness: unused,
    getCurrentState: unused,
    listProjects: unused,
    getProjectByWorkspace: unused,
    listProjectThreads: unused,
    listSessionThreads: unused,
    listThreadMessages: unused,
    listThreadActivities: unused,
    listThreadSessions: unused,
    listOrchestratorWakes: unused,
    getThreadCheckpointContext: () => Effect.succeed(context),
  };
}

describe("CheckpointDiffQueryLive", () => {
  it("computes diffs using canonical turn-0 checkpoint refs", async () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const hasCheckpointRefCalls: Array<CheckpointRef> = [];
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
      readonly pathspecs?: ReadonlyArray<string>;
    }> = [];

    const context = makeThreadCheckpointContext({
      threadId,
      workspaceCwd: "/tmp/workspace",
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: ({ checkpointRef }) =>
        Effect.sync(() => {
          hasCheckpointRefCalls.push(checkpointRef);
          return true;
        }),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, pathspecs }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({
            fromCheckpointRef,
            toCheckpointRef,
            cwd,
            ...(pathspecs ? { pathspecs } : {}),
          });
          return "diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionOperationalQuery, makeProjectionOperationalQuery(context)),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getTurnDiff({
          threadId,
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    const expectedFromRef = checkpointRefForThreadTurn(threadId, 0);
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef, toCheckpointRef]);
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
        pathspecs: undefined,
      },
    ]);
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "diff patch",
    });
  });

  it("fails when the thread is missing from the checkpoint context", async () => {
    const threadId = ThreadId.makeUnsafe("thread-missing");
    const context: ProjectionThreadCheckpointContext = {
      threadId,
      threadFound: false,
      workspaceCwd: null,
      checkpoints: [],
    };

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: () => Effect.succeed(""),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionOperationalQuery, makeProjectionOperationalQuery(context)),
      ),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const query = yield* CheckpointDiffQuery;
          return yield* query.getTurnDiff({
            threadId,
            fromTurnCount: 0,
            toTurnCount: 1,
          });
        }).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow("Thread 'thread-missing' not found.");
  });

  it("computes file diffs with a pathspec filter", async () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
    const diffCheckpointsCalls: Array<{
      readonly fromCheckpointRef: CheckpointRef;
      readonly toCheckpointRef: CheckpointRef;
      readonly cwd: string;
      readonly pathspecs?: ReadonlyArray<string>;
    }> = [];

    const context = makeThreadCheckpointContext({
      threadId,
      workspaceCwd: "/tmp/workspace",
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    });

    const checkpointStore: CheckpointStoreShape = {
      isGitRepository: () => Effect.succeed(true),
      captureCheckpoint: () => Effect.void,
      hasCheckpointRef: () => Effect.succeed(true),
      restoreCheckpoint: () => Effect.succeed(true),
      diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd, pathspecs }) =>
        Effect.sync(() => {
          diffCheckpointsCalls.push({
            fromCheckpointRef,
            toCheckpointRef,
            cwd,
            ...(pathspecs ? { pathspecs } : {}),
          });
          return "file diff patch";
        }),
      deleteCheckpointRefs: () => Effect.void,
    };

    const layer = CheckpointDiffQueryLive.pipe(
      Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
      Layer.provideMerge(
        Layer.succeed(ProjectionOperationalQuery, makeProjectionOperationalQuery(context)),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const query = yield* CheckpointDiffQuery;
        return yield* query.getFileDiff({
          threadId,
          path: "src/index.ts",
          fromTurnCount: 0,
          toTurnCount: 1,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: "/tmp/workspace",
        fromCheckpointRef: checkpointRefForThreadTurn(threadId, 0),
        toCheckpointRef,
        pathspecs: ["src/index.ts"],
      },
    ]);
    expect(result).toEqual({
      threadId,
      path: "src/index.ts",
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "file diff patch",
    });
  });
});
