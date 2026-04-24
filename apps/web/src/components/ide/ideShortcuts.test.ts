import { assert, describe, it } from "vitest";
import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { resolveIdeShortcutCommand, ideShortcutLabelForCommand } from "./ideShortcuts";

function event(
  overrides: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
) {
  return {
    key: "e",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

describe("resolveIdeShortcutCommand", () => {
  it("falls back to the IDE explorer shortcut when server bindings are stale", () => {
    assert.strictEqual(
      resolveIdeShortcutCommand(event({ ctrlKey: true, shiftKey: true }), EMPTY_KEYBINDINGS, {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "ide.explorer.toggle",
    );
  });

  it("falls back to the IDE chat shortcut when server bindings are stale", () => {
    assert.strictEqual(
      resolveIdeShortcutCommand(
        event({ key: "b", ctrlKey: true, altKey: true }),
        EMPTY_KEYBINDINGS,
        {
          platform: "Linux",
          context: { ideMode: true },
        },
      ),
      "ide.chat.toggle",
    );
  });

  it("falls back to the IDE manager shortcut when server bindings are stale", () => {
    assert.strictEqual(
      resolveIdeShortcutCommand(
        event({ key: "m", ctrlKey: true, altKey: true }),
        EMPTY_KEYBINDINGS,
        {
          platform: "Linux",
          context: { ideMode: true },
        },
      ),
      "ide.manager.toggle",
    );
  });

  it("falls back to the IDE executive drawer shortcut when server bindings are stale", () => {
    assert.strictEqual(
      resolveIdeShortcutCommand(event({ ctrlKey: true, altKey: true }), EMPTY_KEYBINDINGS, {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "ide.chat.executive",
    );
  });

  it("falls back to the IDE orchestrator drawer shortcut when server bindings are stale", () => {
    assert.strictEqual(
      resolveIdeShortcutCommand(
        event({ key: "o", ctrlKey: true, altKey: true }),
        EMPTY_KEYBINDINGS,
        {
          platform: "Linux",
          context: { ideMode: true },
        },
      ),
      "ide.chat.orchestrator",
    );
  });

  it("does not activate outside IDE mode", () => {
    assert.isNull(
      resolveIdeShortcutCommand(event({ ctrlKey: true, shiftKey: true }), EMPTY_KEYBINDINGS, {
        platform: "Linux",
        context: { ideMode: false },
      }),
    );
  });
});

describe("ideShortcutLabelForCommand", () => {
  it("uses fallback labels when configured bindings are missing", () => {
    assert.strictEqual(
      ideShortcutLabelForCommand(EMPTY_KEYBINDINGS, "ide.explorer.toggle", {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "Ctrl+Shift+E",
    );
    assert.strictEqual(
      ideShortcutLabelForCommand(EMPTY_KEYBINDINGS, "ide.chat.toggle", {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "Ctrl+Alt+B",
    );
    assert.strictEqual(
      ideShortcutLabelForCommand(EMPTY_KEYBINDINGS, "ide.manager.toggle", {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "Ctrl+Alt+M",
    );
    assert.strictEqual(
      ideShortcutLabelForCommand(EMPTY_KEYBINDINGS, "ide.chat.executive", {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "Ctrl+Alt+E",
    );
    assert.strictEqual(
      ideShortcutLabelForCommand(EMPTY_KEYBINDINGS, "ide.chat.orchestrator", {
        platform: "Linux",
        context: { ideMode: true },
      }),
      "Ctrl+Alt+O",
    );
  });
});
