import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { TextGenerationShape } from "../Services/TextGeneration.ts";
import { routeTextGenerationProvider } from "./RoutingTextGeneration.ts";

function createTextGenerationShape(label: string): TextGenerationShape {
  return {
    generateCommitMessage: () => {
      throw new Error(`${label}:generateCommitMessage`);
    },
    generatePrContent: () => {
      throw new Error(`${label}:generatePrContent`);
    },
    generateBranchName: () => {
      throw new Error(`${label}:generateBranchName`);
    },
    generateThreadTitle: () => {
      throw new Error(`${label}:generateThreadTitle`);
    },
  };
}

describe("routeTextGenerationProvider", () => {
  const codex = createTextGenerationShape("codex");
  const claude = createTextGenerationShape("claude");
  const ollama = createTextGenerationShape("ollama");

  it("routes ollamaLocal requests to the Ollama implementation", () => {
    const resolved = routeTextGenerationProvider({
      provider: "ollamaLocal",
      codex,
      claude,
      ollama,
    });

    assert.equal(resolved, ollama);
  });

  it("falls back to Codex for undefined providers", () => {
    const resolved = routeTextGenerationProvider({
      provider: undefined,
      codex,
      claude,
      ollama,
    });

    assert.equal(resolved, codex);
  });
});
