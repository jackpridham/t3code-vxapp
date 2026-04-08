import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";
import type { ChangesPanelContentMode } from "../uiStateStore";

export const CHANGES_WINDOW_TARGET_STORAGE_KEY = "t3code:changes-window-target:v1";

export const ChangesWindowTargetSchema = Schema.NullOr(
  Schema.Struct({
    threadId: Schema.String,
    path: Schema.NullOr(Schema.String),
    mode: Schema.Literals(["preview", "diff"]),
    revision: Schema.Number,
  }),
);

export type ChangesWindowTarget = typeof ChangesWindowTargetSchema.Type;

export const DEFAULT_CHANGES_WINDOW_TARGET: ChangesWindowTarget = null;

export function buildChangesWindowTarget(input: {
  threadId: string;
  path?: string | null | undefined;
  mode?: ChangesPanelContentMode | undefined;
  revision?: number | undefined;
}): NonNullable<ChangesWindowTarget> {
  return {
    threadId: input.threadId,
    path: input.path ?? null,
    mode: input.mode ?? "preview",
    revision: input.revision ?? Date.now(),
  };
}

export function useChangesWindowTarget() {
  return useLocalStorage(
    CHANGES_WINDOW_TARGET_STORAGE_KEY,
    DEFAULT_CHANGES_WINDOW_TARGET,
    ChangesWindowTargetSchema,
  );
}
