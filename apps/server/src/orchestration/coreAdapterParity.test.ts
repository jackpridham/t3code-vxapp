import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand as coreDecide } from "@t3tools/orchestration-core/decider";
import {
  OrchestrationCommandInvariantError as CoreInvariantError,
  OrchestrationProjectorDecodeError as CoreProjectorDecodeError,
  toProjectorDecodeError as coreToProjectorDecodeError,
} from "@t3tools/orchestration-core/errors";
import { createEmptyReadModel as coreCreateEmptyReadModel } from "@t3tools/orchestration-core/projector";
import { projectEvent as coreProjectEvent } from "@t3tools/orchestration-core/projector";

import { decideOrchestrationCommand as serverDecide } from "./decider.ts";
import {
  OrchestrationCommandInvariantError as ServerInvariantError,
  OrchestrationProjectorDecodeError as ServerProjectorDecodeError,
  toProjectorDecodeError as serverToProjectorDecodeError,
} from "./Errors.ts";
import { createEmptyReadModel as serverCreateEmptyReadModel } from "./projector.ts";
import { projectEvent as serverProjectEvent } from "./projector.ts";

describe("server orchestration core adapters", () => {
  it("keeps server decider/projector wrappers pointed at the standalone core", () => {
    expect(serverDecide).toBe(coreDecide);
    expect(serverCreateEmptyReadModel).toBe(coreCreateEmptyReadModel);
    expect(serverProjectEvent).toBe(coreProjectEvent);
  });

  it("keeps server error wrappers pointed at the standalone core", () => {
    expect(ServerInvariantError).toBe(CoreInvariantError);
    expect(ServerProjectorDecodeError).toBe(CoreProjectorDecodeError);
    expect(serverToProjectorDecodeError).toBe(coreToProjectorDecodeError);
  });
});
