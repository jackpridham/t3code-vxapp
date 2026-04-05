import { describe, expect, it } from "vitest";

import {
  buildOrchestratorThreadLabels,
  normalizeOrchestratorDisplayName,
  normalizeOrchestratorLabel,
  reconcileOrchestratorThreadLabels,
  stripOrchestratorThreadLabels,
} from "./orchestrator";

describe("orchestrator helpers", () => {
  it("normalizes the display name by trimming and collapsing whitespace", () => {
    expect(normalizeOrchestratorDisplayName("  Jasper   Prime  ")).toBe("Jasper Prime");
    expect(normalizeOrchestratorDisplayName("   ")).toBeNull();
  });

  it("derives a lowercase label slug from the orchestrator name", () => {
    expect(normalizeOrchestratorLabel("Jasper Prime")).toBe("jasper-prime");
    expect(normalizeOrchestratorLabel("   ")).toBeNull();
  });

  it("builds the default orchestrator thread labels", () => {
    expect(buildOrchestratorThreadLabels("Jasper")).toEqual(["orchestrator", "jasper"]);
    expect(buildOrchestratorThreadLabels("")).toEqual(["orchestrator"]);
  });

  it("reconciles managed orchestrator labels while preserving custom labels", () => {
    expect(
      reconcileOrchestratorThreadLabels({
        existingLabels: ["orchestrator", "worker", "jasper", "worker", "triage"],
        orchestratorName: "Jasper Prime",
        previousOrchestratorName: "Jasper",
      }),
    ).toEqual(["orchestrator", "jasper-prime", "worker", "triage"]);
  });

  it("caps reconciled orchestrator labels to the thread label limit", () => {
    expect(
      reconcileOrchestratorThreadLabels({
        existingLabels: [
          "alpha",
          "beta",
          "gamma",
          "delta",
          "epsilon",
          "zeta",
          "eta",
          "theta",
          "iota",
          "kappa",
          "lambda",
          "mu",
          "nu",
          "xi",
          "omicron",
          "pi",
        ],
        orchestratorName: "Jasper",
      }),
    ).toEqual([
      "orchestrator",
      "jasper",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
      "lambda",
      "mu",
      "nu",
      "xi",
    ]);
  });

  it("strips managed orchestrator labels when a thread stops being orchestrator-owned", () => {
    expect(
      stripOrchestratorThreadLabels({
        existingLabels: ["orchestrator", "jasper", "worker", "triage"],
        orchestratorName: "Jasper",
      }),
    ).toEqual(["worker", "triage"]);
  });
});
