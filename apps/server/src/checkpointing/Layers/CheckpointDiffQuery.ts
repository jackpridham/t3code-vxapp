import {
  OrchestrationGetFileDiffResult,
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFileDiffInput,
  type OrchestrationGetFileDiffResult as OrchestrationGetFileDiffResultType,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { ProjectionOperationalQuery } from "../../orchestration/Services/ProjectionOperationalQuery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);
const isFileDiffResult = Schema.is(OrchestrationGetFileDiffResult);

const make = Effect.gen(function* () {
  const projectionOperationalQuery = yield* ProjectionOperationalQuery;
  const checkpointStore = yield* CheckpointStore;

  const resolveDiffContext = (input: {
    readonly threadId: OrchestrationGetTurnDiffResultType["threadId"];
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
    readonly operation: string;
  }) =>
    Effect.gen(function* () {
      const context = yield* projectionOperationalQuery.getThreadCheckpointContext({
        threadId: input.threadId,
      });
      if (!context.threadFound) {
        return yield* new CheckpointInvariantError({
          operation: input.operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = context.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const workspaceCwd = context.workspaceCwd;
      if (!workspaceCwd) {
        return yield* new CheckpointInvariantError({
          operation: input.operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : context.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = context.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      const [fromExists, toExists] = yield* Effect.all(
        [
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: fromCheckpointRef,
          }),
          checkpointStore.hasCheckpointRef({
            cwd: workspaceCwd,
            checkpointRef: toCheckpointRef,
          }),
        ],
        { concurrency: "unbounded" },
      );

      if (!fromExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      if (!toExists) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      return {
        workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
      };
    });

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const { workspaceCwd, fromCheckpointRef, toCheckpointRef } = yield* resolveDiffContext({
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        operation,
      });

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    });

  const getFileDiff: CheckpointDiffQueryShape["getFileDiff"] = (
    input: OrchestrationGetFileDiffInput,
  ) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getFileDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetFileDiffResultType = {
          threadId: input.threadId,
          path: input.path,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isFileDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed file diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const { workspaceCwd, fromCheckpointRef, toCheckpointRef } = yield* resolveDiffContext({
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        operation,
      });

      const diff = yield* checkpointStore.diffCheckpoints({
        cwd: workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
        pathspecs: [input.path],
      });

      const fileDiff: OrchestrationGetFileDiffResultType = {
        threadId: input.threadId,
        path: input.path,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      };
      if (!isFileDiffResult(fileDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed file diff result does not satisfy contract schema.",
        });
      }

      return fileDiff;
    });

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFileDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
