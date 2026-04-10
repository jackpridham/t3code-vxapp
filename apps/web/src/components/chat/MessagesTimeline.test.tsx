import { MessageId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../ui/button", () => ({
  Button: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("../ChatMarkdown", () => ({
  default: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("./ChangedFilesTree", () => ({
  ChangedFilesTree: () => null,
}));

vi.mock("./ProposedPlanCard", () => ({
  ProposedPlanCard: ({ planMarkdown }: { planMarkdown: string }) => planMarkdown,
}));

vi.mock("./MessageCopyButton", () => ({
  MessageCopyButton: () => null,
}));

vi.mock("./ExpandedImagePreview", () => ({
  buildExpandedImagePreview: () => null,
  ExpandedImagePreview: () => null,
}));

vi.mock("../timelineHeight", () => ({
  estimateTimelineMessageHeight: () => 48,
}));

vi.mock("~/lib/terminalContext", () => ({
  deriveDisplayedUserMessageState: (text: string) => ({
    visibleText: text,
    copyText: text,
    contextCount: 0,
    previewTitle: null,
    terminalContextEntries: [],
    contexts: [],
  }),
}));

vi.mock("~/lib/skillReferences", () => ({
  splitTextIntoSkillReferenceSegments: (text: string) => {
    const match = text.match(/@\/.+?\/([^/]+)\/SKILL\.md/);
    if (!match) {
      return [{ type: "text", text }];
    }
    const fullMatch = match[0];
    const start = match.index ?? 0;
    const skillName = match[1] ?? "skill";
    const segments: Array<Record<string, string>> = [];
    if (start > 0) {
      segments.push({ type: "text", text: text.slice(0, start) });
    }
    segments.push({
      type: "skill",
      skillName,
      skillMarkdownPath: fullMatch.slice(1),
    });
    if (start + fullMatch.length < text.length) {
      segments.push({ type: "text", text: text.slice(start + fullMatch.length) });
    }
    return segments;
  },
}));

vi.mock("./SkillIcon", () => ({
  SkillIcon: () => <span data-skill-icon="true" />,
}));

vi.mock("./TerminalContextInlineChip", () => ({
  TerminalContextInlineChip: ({ label }: { label: string }) => (
    <span>
      <span className="lucide-terminal" />
      {label}
    </span>
  ),
}));

vi.mock("./userMessageTerminalContexts", () => ({
  buildInlineTerminalContextText: (label: string) => label,
  formatInlineTerminalContextLabel: (label: string) => label,
  textContainsInlineTerminalContextLabels: (text: string) => text.includes("@terminal-"),
}));

vi.mock("~/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
  randomUUID: () => "00000000-0000-0000-0000-000000000000",
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isHydratingHistory={false}
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionDuration={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("yoo what&#x27;s ");
  });

  it("renders skill references as inline chips instead of absolute paths", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isHydratingHistory={false}
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-skill"),
              role: "user",
              text: "Use @/workspace/app/.claude/skills/find-skills/SKILL.md before continuing",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionDuration={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("find-skills");
    expect(markup).toContain("data-skill-icon");
    expect(markup).not.toContain(".claude/skills/find-skills/SKILL.md");
  });

  it("renders context compaction entries in the normal work log", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        isHydratingHistory={false}
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionDuration={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("renders a loading message while thread history is hydrating", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages={false}
        isHydratingHistory
        isWorking={false}
        activeTurnInProgress={false}
        activeTurnStartedAt={null}
        scrollContainer={null}
        timelineEntries={[]}
        completionDividerBeforeEntryId={null}
        completionDuration={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Loading conversation history");
    expect(markup).not.toContain("Send a message to start the conversation");
  });
});
