import { type KeybindingCommand, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";

const IDE_MODE_WHEN_AST = { type: "identifier", name: "ideMode" } as const;

export const IDE_SHORTCUT_FALLBACKS: ResolvedKeybindingsConfig = [
  {
    command: "ide.changes.focus",
    shortcut: {
      key: "c",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.explorer.toggle",
    shortcut: {
      key: "e",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.threads.focus",
    shortcut: {
      key: "t",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.manager.toggle",
    shortcut: {
      key: "m",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.chat.toggle",
    shortcut: {
      key: "b",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.markdownPreview.toggle",
    shortcut: {
      key: "v",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.diff.toggle",
    shortcut: {
      key: "d",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.chat.executive",
    shortcut: {
      key: "e",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
  {
    command: "ide.chat.orchestrator",
    shortcut: {
      key: "o",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: true,
      modKey: false,
    },
    whenAst: IDE_MODE_WHEN_AST,
  },
];

type ShortcutResolutionOptions = Parameters<typeof resolveShortcutCommand>[2];

function isIdeCommand(
  command: KeybindingCommand | null,
): command is Extract<KeybindingCommand, `ide.${string}`> {
  return command?.startsWith("ide.") ?? false;
}

export function resolveIdeShortcutCommand(
  event: Parameters<typeof resolveShortcutCommand>[0],
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutResolutionOptions,
): Extract<KeybindingCommand, `ide.${string}`> | null {
  const configuredCommand = resolveShortcutCommand(event, keybindings, options);
  if (configuredCommand !== null) {
    return isIdeCommand(configuredCommand) ? configuredCommand : null;
  }

  const fallbackCommand = resolveShortcutCommand(event, IDE_SHORTCUT_FALLBACKS, options);
  if (!isIdeCommand(fallbackCommand)) {
    return null;
  }

  return fallbackCommand;
}

export function ideShortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: Extract<KeybindingCommand, `ide.${string}`>,
  options?: Parameters<typeof shortcutLabelForCommand>[2],
): string | null {
  return (
    shortcutLabelForCommand(keybindings, command, options) ??
    shortcutLabelForCommand(IDE_SHORTCUT_FALLBACKS, command, options)
  );
}
