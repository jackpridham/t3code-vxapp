import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveTimelineEntries } from "../../session-logic";
import { deriveTimelineRows } from "./MessagesTimeline.rows";

describe("deriveTimelineRows", () => {
  it("reuses unchanged rows when only the active assistant chunk changes", () => {
    const userMessage = {
      id: MessageId.makeUnsafe("user-1"),
      role: "user" as const,
      text: "Investigate the regression",
      createdAt: "2026-06-08T00:00:01.000Z",
      streaming: false,
    };
    const assistantMessage = {
      id: MessageId.makeUnsafe("assistant-1"),
      role: "assistant" as const,
      text: "Starting",
      createdAt: "2026-06-08T00:00:02.000Z",
      streaming: true,
    };
    const workEntry = {
      id: "work-1",
      createdAt: "2026-06-08T00:00:01.500Z",
      label: "Read file",
      tone: "tool" as const,
    };
    const initialEntries = deriveTimelineEntries([userMessage, assistantMessage], [], [workEntry]);
    const initialRows = deriveTimelineRows({
      timelineEntries: initialEntries,
      completionDividerBeforeEntryId: null,
      isWorking: true,
      activeTurnStartedAt: "2026-06-08T00:00:02.000Z",
      revertTurnCountByUserMessageId: new Map(),
    });

    const nextEntries = deriveTimelineEntries(
      [
        userMessage,
        {
          ...assistantMessage,
          text: "Starting to inspect the render path",
        },
      ],
      [],
      [workEntry],
      initialEntries,
    );
    const nextRows = deriveTimelineRows(
      {
        timelineEntries: nextEntries,
        completionDividerBeforeEntryId: null,
        isWorking: true,
        activeTurnStartedAt: "2026-06-08T00:00:02.000Z",
        revertTurnCountByUserMessageId: new Map(),
      },
      initialRows,
    );

    expect(nextRows[0]).toBe(initialRows[0]);
    expect(nextRows[1]).toBe(initialRows[1]);
    expect(nextRows[2]).not.toBe(initialRows[2]);
    expect(nextRows[3]).toBe(initialRows[3]);
  });

  it("reuses user rows when revert availability is unchanged", () => {
    const timelineEntries = deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe("user-1"),
          role: "user",
          text: "Ship it",
          createdAt: "2026-06-08T00:00:01.000Z",
          streaming: false,
        },
      ],
      [],
      [],
    );
    const firstRows = deriveTimelineRows({
      timelineEntries,
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      revertTurnCountByUserMessageId: new Map([[MessageId.makeUnsafe("user-1"), 2]]),
    });
    const secondRows = deriveTimelineRows(
      {
        timelineEntries,
        completionDividerBeforeEntryId: null,
        isWorking: false,
        activeTurnStartedAt: null,
        revertTurnCountByUserMessageId: new Map([[MessageId.makeUnsafe("user-1"), 2]]),
      },
      firstRows,
    );

    expect(secondRows[0]).toBe(firstRows[0]);
  });
});
