import {
  CtoAttentionId,
  type OrchestrationCtoAttentionItem,
  type OrchestrationProgramNotificationSeverity,
  type OrchestrationProgramNotificationState,
  ProgramNotificationId,
  ProgramId,
  type ProgramNotificationEvidence,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  buildCtoAttentionKey,
  deriveCtoAttentionStateFromProgramNotificationState,
  extractCtoAttentionSource,
  isCtoActionableProgramNotificationKind,
  toCtoAttentionKind,
} from "@t3tools/shared/ctoAttention";

type CtoAttentionBase = Omit<OrchestrationCtoAttentionItem, "attentionId" | "kind" | "state">;

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
  input: ProgramNotificationCtoAttentionInput,
): OrchestrationCtoAttentionItem | null {
  const attentionKind = toCtoAttentionKind(input.kind);
  if (!attentionKind || !isCtoActionableProgramNotificationKind(attentionKind)) {
    return null;
  }

  const source = extractCtoAttentionSource(input.evidence, input.orchestratorThreadId);
  const correlationId = String(input.notificationId);
  const attentionKey = buildCtoAttentionKey({
    programId: input.programId,
    kind: attentionKind,
    sourceThreadId: source.sourceThreadId,
    sourceRole: source.sourceRole,
    evidence: input.evidence,
    correlationId,
    notificationId: input.notificationId,
  });
  const state = deriveCtoAttentionStateFromProgramNotificationState(input.state);
  const base: CtoAttentionBase = {
    attentionKey,
    notificationId: ProgramNotificationId.makeUnsafe(String(input.notificationId)),
    programId: ProgramId.makeUnsafe(String(input.programId)),
    executiveProjectId: ProjectId.makeUnsafe(String(input.executiveProjectId)),
    executiveThreadId: ThreadId.makeUnsafe(String(input.executiveThreadId)),
    sourceThreadId: source.sourceThreadId,
    sourceRole: source.sourceRole,
    severity: input.severity,
    summary: input.summary,
    evidence: input.evidence,
    queuedAt: input.queuedAt,
    acknowledgedAt: input.state === "consumed" ? input.consumedAt : null,
    resolvedAt: null,
    droppedAt: input.state === "dropped" ? input.droppedAt : null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };

  return {
    attentionId: CtoAttentionId.makeUnsafe(attentionKey),
    ...base,
    kind: attentionKind,
    state,
  };
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
