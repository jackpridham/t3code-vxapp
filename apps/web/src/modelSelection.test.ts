import { describe, expect, it } from "vitest";
import type { ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { getCustomModelOptionsByProvider, resolveAppModelSelection } from "./modelSelection";

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "ollamaLocal",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "unknown", type: "local", label: "Local Ollama" },
    checkedAt: "2026-06-07T00:00:00.000Z",
    message: "Connected.",
    models: [
      {
        slug: "qwen3:8b",
        name: "Qwen3 8B",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
        agentSupport: {
          status: "verified",
          message: "Verified for Codex tool-enabled Ollama sessions in T3 on 2026-06-07.",
        },
      },
      {
        slug: "qwen2.5-coder:14b",
        name: "qwen2.5-coder:14b",
        isCustom: true,
        capabilities: null,
        agentSupport: {
          status: "unsupported",
          message: "Failed live Codex tool-call verification on 2026-06-07. Use qwen3:8b instead.",
        },
      },
      {
        slug: "deepseek-coder-v2:16b",
        name: "deepseek-coder-v2:16b",
        isCustom: true,
        capabilities: null,
        agentSupport: {
          status: "unsupported",
          message:
            "The live Ollama runtime reported that this model does not support tools on 2026-06-07. Use qwen3:8b instead.",
        },
      },
    ],
  },
];

describe("modelSelection agentTurn surface", () => {
  it("falls back to the verified Ollama model for unsupported agent-turn selections", () => {
    expect(
      resolveAppModelSelection(
        "ollamaLocal",
        DEFAULT_UNIFIED_SETTINGS,
        TEST_PROVIDERS,
        "qwen2.5-coder:14b",
        "agentTurn",
      ),
    ).toBe("qwen3:8b");
  });

  it("preserves broader Ollama selection outside agent turns", () => {
    expect(
      resolveAppModelSelection(
        "ollamaLocal",
        DEFAULT_UNIFIED_SETTINGS,
        TEST_PROVIDERS,
        "qwen2.5-coder:14b",
      ),
    ).toBe("qwen2.5-coder:14b");
  });

  it("only exposes verified Ollama models in the chat agent picker surface", () => {
    const options = getCustomModelOptionsByProvider(
      DEFAULT_UNIFIED_SETTINGS,
      TEST_PROVIDERS,
      "ollamaLocal",
      "qwen2.5-coder:14b",
      "agentTurn",
    );

    expect(options.ollamaLocal.map((option) => option.slug)).toEqual(["qwen3:8b"]);
  });
});
