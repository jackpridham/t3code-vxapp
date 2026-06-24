import { type MessageId } from "@t3tools/contracts";
import { deriveTimelineEntries } from "../../session-logic";
import { computeMessageDurationStart } from "./MessagesTimeline.logic";

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineProposedPlan = Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"];

export type TimelineThinking = {
  id: string;
  createdAt: string;
  label: string;
  detail: string;
  thoughts: ReadonlyArray<string>;
  tone: "thinking";
  presentation: "thinking-bubble";
};

export type TimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: Extract<TimelineEntry, { kind: "work" }>["entry"][];
    }
  | {
      kind: "thinking";
      id: string;
      createdAt: string;
      thinking: TimelineThinking;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: TimelineMessage;
      durationStart: string;
      showCompletionDivider: boolean;
      canRevertAgentWork: boolean;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: TimelineProposedPlan;
    }
  | { kind: "working"; id: string; createdAt: string | null };

export function deriveTimelineRows(
  input: {
    timelineEntries: ReadonlyArray<TimelineEntry>;
    completionDividerBeforeEntryId: string | null;
    isWorking: boolean;
    activeTurnStartedAt: string | null;
    revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
  },
  previousRows: ReadonlyArray<TimelineRow> = [],
): TimelineRow[] {
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );
  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  const nextRows: TimelineRow[] = [];

  for (let index = 0; index < input.timelineEntries.length; index += 1) {
    const timelineEntry = input.timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work" && timelineEntry.entry.presentation === "thinking-bubble") {
      const nextRow: TimelineRow = {
        kind: "thinking",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        thinking: {
          id: timelineEntry.entry.id,
          createdAt: timelineEntry.entry.createdAt,
          label: timelineEntry.entry.label,
          detail: timelineEntry.entry.detail ?? "",
          thoughts: timelineEntry.entry.thoughts ?? [],
          tone: "thinking",
          presentation: "thinking-bubble",
        },
      };
      nextRows.push(reuseTimelineRow(previousById.get(nextRow.id), nextRow));
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < input.timelineEntries.length) {
        const nextEntry = input.timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        if (nextEntry.entry.presentation === "thinking-bubble") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }

      const nextRow: TimelineRow = {
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      };
      nextRows.push(reuseTimelineRow(previousById.get(nextRow.id), nextRow));
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      const nextRow: TimelineRow = {
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      };
      nextRows.push(reuseTimelineRow(previousById.get(nextRow.id), nextRow));
      continue;
    }

    const nextRow: TimelineRow = {
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === "assistant" &&
        input.completionDividerBeforeEntryId === timelineEntry.id,
      canRevertAgentWork:
        timelineEntry.message.role === "user" &&
        input.revertTurnCountByUserMessageId.has(timelineEntry.message.id),
    };
    nextRows.push(reuseTimelineRow(previousById.get(nextRow.id), nextRow));
  }

  if (input.isWorking) {
    const workingRow: TimelineRow = {
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    };
    nextRows.push(reuseTimelineRow(previousById.get(workingRow.id), workingRow));
  }

  return rowsEqualByReference(nextRows, previousRows) ? (previousRows as TimelineRow[]) : nextRows;
}

function reuseTimelineRow(previousRow: TimelineRow | undefined, nextRow: TimelineRow): TimelineRow {
  if (!previousRow || previousRow.kind !== nextRow.kind || previousRow.id !== nextRow.id) {
    return nextRow;
  }

  if (nextRow.kind === "message" && previousRow.kind === "message") {
    return previousRow.message === nextRow.message &&
      previousRow.durationStart === nextRow.durationStart &&
      previousRow.showCompletionDivider === nextRow.showCompletionDivider &&
      previousRow.canRevertAgentWork === nextRow.canRevertAgentWork
      ? previousRow
      : nextRow;
  }
  if (nextRow.kind === "proposed-plan" && previousRow.kind === "proposed-plan") {
    return previousRow.proposedPlan === nextRow.proposedPlan ? previousRow : nextRow;
  }
  if (nextRow.kind === "work" && previousRow.kind === "work") {
    return arrayEqualByReference(previousRow.groupedEntries, nextRow.groupedEntries)
      ? previousRow
      : nextRow;
  }
  if (nextRow.kind === "thinking" && previousRow.kind === "thinking") {
    return previousRow.thinking.thoughts === nextRow.thinking.thoughts &&
      previousRow.thinking.detail === nextRow.thinking.detail &&
      previousRow.thinking.label === nextRow.thinking.label
      ? previousRow
      : nextRow;
  }
  if (nextRow.kind === "working" && previousRow.kind === "working") {
    return previousRow.createdAt === nextRow.createdAt ? previousRow : nextRow;
  }

  return nextRow;
}

function rowsEqualByReference(
  nextRows: ReadonlyArray<TimelineRow>,
  previousRows: ReadonlyArray<TimelineRow>,
): boolean {
  if (nextRows.length !== previousRows.length) {
    return false;
  }
  for (let index = 0; index < nextRows.length; index += 1) {
    if (nextRows[index] !== previousRows[index]) {
      return false;
    }
  }
  return true;
}

function arrayEqualByReference<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
