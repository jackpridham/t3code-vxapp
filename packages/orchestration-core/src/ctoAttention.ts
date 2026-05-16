import {
  type OrchestrationCtoAttentionItem,
  type OrchestrationProgramNotificationSeverity,
  type OrchestrationProgramNotificationState,
  ProgramNotificationId,
  ProgramId,
  type ProgramNotificationEvidence,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

export interface ProgramNotificationCtoAttentionInput {
  readonly notificationId: ProgramNotificationId | string;
  readonly programId: ProgramId | string;
  readonly executiveProjectId: ProjectId | string;
  readonly executiveThreadId: ThreadId | string;
  readonly orchestratorThreadId: ThreadId | string | null;
  readonly kind: string;
  readonly severity: OrchestrationProgramNotificationSeverity;
  readonly summary: string;
  readonly evidence: ProgramNotificationEvidence;
  readonly state: OrchestrationProgramNotificationState;
  readonly queuedAt: string;
  readonly deliveredAt: string | null;
  readonly consumedAt: string | null;
  readonly droppedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly correlationId?: string | null | undefined;
  readonly commandId?: string | null | undefined;
}

export function projectCtoAttentionFromProgramNotification(
  _input: ProgramNotificationCtoAttentionInput,
): OrchestrationCtoAttentionItem | null {
  return null;
}

export function acknowledgeCtoAttentionItem(
  item: OrchestrationCtoAttentionItem,
  acknowledgedAt: string,
  updatedAt: string,
): OrchestrationCtoAttentionItem {
  return {
    ...item,
    state: "acknowledged",
    acknowledgedAt,
    updatedAt,
  };
}

export function dropCtoAttentionItem(
  item: OrchestrationCtoAttentionItem,
  droppedAt: string,
  updatedAt: string,
): OrchestrationCtoAttentionItem {
  return {
    ...item,
    state: "dropped",
    droppedAt,
    updatedAt,
  };
}

export function upsertCtoAttentionItemByKey(
  items: ReadonlyArray<OrchestrationCtoAttentionItem>,
  nextItem: OrchestrationCtoAttentionItem,
): OrchestrationCtoAttentionItem[] {
  const existing = items.find((item) => item.attentionKey === nextItem.attentionKey);
  return existing
    ? items.map((item) => (item.attentionKey === nextItem.attentionKey ? nextItem : item))
    : [...items, nextItem];
}

export function updateCtoAttentionItemByNotificationId(
  items: ReadonlyArray<OrchestrationCtoAttentionItem>,
  notificationId: ProgramNotificationId | string,
  updater: (item: OrchestrationCtoAttentionItem) => OrchestrationCtoAttentionItem,
): OrchestrationCtoAttentionItem[] {
  const targetNotificationId = String(notificationId);
  return items.map((item) =>
    String(item.notificationId) === targetNotificationId ? updater(item) : item,
  );
}

function compareCtoAttentionItems(
  left: OrchestrationCtoAttentionItem,
  right: OrchestrationCtoAttentionItem,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.attentionKey.localeCompare(right.attentionKey)
  );
}

export function sortCtoAttentionItems(
  items: ReadonlyArray<OrchestrationCtoAttentionItem>,
): OrchestrationCtoAttentionItem[] {
  return [...items].toSorted(compareCtoAttentionItems);
}

export const OPERATIONAL_CTO_ATTENTION_TERMINAL_LIMIT = 25;

export function selectSnapshotCtoAttentionItems(
  items: ReadonlyArray<OrchestrationCtoAttentionItem>,
): OrchestrationCtoAttentionItem[] {
  return sortCtoAttentionItems(items);
}

export function selectOperationalCtoAttentionItems(
  items: ReadonlyArray<OrchestrationCtoAttentionItem>,
  terminalLimit: number = OPERATIONAL_CTO_ATTENTION_TERMINAL_LIMIT,
): OrchestrationCtoAttentionItem[] {
  const orderedItems = sortCtoAttentionItems(items);
  const requiredItems = orderedItems.filter((item) => item.state === "required");
  const terminalItems = orderedItems.filter((item) => item.state !== "required");
  return [...requiredItems, ...terminalItems.slice(0, terminalLimit)];
}
