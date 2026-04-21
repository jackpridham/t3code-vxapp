import type {
  OrchestrationProgramNotificationState,
  ProgramId,
  ProgramNotificationId,
  ThreadId,
} from "@t3tools/contracts";

export const CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS = [
  "decision_required",
  "blocked",
  "risk_escalated",
  "founder_update_required",
  "final_review_ready",
  "program_completed",
] as const;
export type CTOActionableProgramNotificationKind =
  (typeof CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS)[number];

export const CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS = [
  "worker_started",
  "worker_progress",
  "worker_completed",
  "routine_status",
  "test_retry",
  "implementation_progress",
  "status_update",
] as const;
export type CtoPassiveProgramNotificationKind =
  (typeof CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS)[number];

export const LEGACY_CTO_ACTIONABLE_NOTIFICATION_KIND_ALIASES = {
  closeout_ready: "final_review_ready",
} as const satisfies Readonly<Record<string, CTOActionableProgramNotificationKind>>;

export type CtoAttentionKind = CTOActionableProgramNotificationKind;
export type CtoAttentionState = "required" | "acknowledged" | "resolved" | "dropped";

const CTO_ACTIONABLE_KIND_SET = new Set<CTOActionableProgramNotificationKind>(
  CTO_ACTIONABLE_PROGRAM_NOTIFICATION_KINDS,
);
const CTO_PASSIVE_KIND_SET = new Set<CtoPassiveProgramNotificationKind>(
  CTO_PASSIVE_PROGRAM_NOTIFICATION_KINDS,
);

type StringRecord = Record<string, unknown>;

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is StringRecord {
  return typeof value === "object" && value !== null;
}

function readFirstString(value: unknown, keys: readonly string[]): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    const trimmed = trimToNull(typeof candidate === "string" ? candidate : null);
    if (trimmed !== null) {
      return trimmed;
    }
  }

  return null;
}

function readStableCorrelationToken(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  return readFirstString(value, ["correlationId", "commandId", "notificationId"]);
}

export function isCtoActionableProgramNotificationKind(
  kind: CTOActionableProgramNotificationKind | string | null | undefined,
): kind is CtoAttentionKind {
  return toCtoAttentionKind(kind) !== null;
}

export function toCtoAttentionKind(
  kind: CTOActionableProgramNotificationKind | string | null | undefined,
): CtoAttentionKind | null {
  const trimmed = trimToNull(kind);
  if (trimmed === null) {
    return null;
  }

  const alias = LEGACY_CTO_ACTIONABLE_NOTIFICATION_KIND_ALIASES[trimmed as "closeout_ready"];
  if (alias) {
    return alias;
  }

  if (CTO_ACTIONABLE_KIND_SET.has(trimmed as CTOActionableProgramNotificationKind)) {
    return trimmed as CtoAttentionKind;
  }

  return null;
}

export function isCtoPassiveProgramNotificationKind(
  kind: CtoPassiveProgramNotificationKind | string | null | undefined,
): boolean {
  const trimmed = trimToNull(kind);
  return trimmed !== null && CTO_PASSIVE_KIND_SET.has(trimmed as CtoPassiveProgramNotificationKind);
}

export function deriveCtoAttentionStateFromProgramNotificationState(
  state: OrchestrationProgramNotificationState,
): CtoAttentionState {
  switch (state) {
    case "pending":
    case "delivering":
    case "delivered":
      return "required";
    case "consumed":
      return "acknowledged";
    case "dropped":
      return "dropped";
  }
}

export interface CtoAttentionSource {
  readonly sourceThreadId: ThreadId | null;
  readonly sourceRole: string | null;
}

export function extractCtoAttentionSource(
  evidence: unknown,
  orchestratorThreadId: ThreadId | string | null | undefined,
): CtoAttentionSource {
  const sourceThreadId =
    readFirstString(evidence, [
      "sourceThreadId",
      "workerThreadId",
      "orchestratorThreadId",
      "threadId",
    ]) ?? trimToNull(orchestratorThreadId);
  const sourceRole =
    readFirstString(evidence, ["sourceRole", "role"]) ??
    (sourceThreadId !== null && trimToNull(orchestratorThreadId) === sourceThreadId
      ? "orchestrator"
      : (readFirstString(evidence, ["workerRole"]) ??
        (readFirstString(evidence, ["workerThreadId"]) !== null ? "worker" : null)));

  return {
    sourceThreadId: sourceThreadId as ThreadId | null,
    sourceRole,
  };
}

export interface BuildCtoAttentionKeyInput {
  readonly programId: ProgramId | string;
  readonly kind: CtoAttentionKind | string;
  readonly sourceThreadId?: ThreadId | string | null | undefined;
  readonly sourceRole?: string | null | undefined;
  readonly evidence?: unknown;
  readonly correlationId?: string | null | undefined;
  readonly commandId?: string | null | undefined;
  readonly notificationId?: ProgramNotificationId | string | null | undefined;
}

export function buildCtoAttentionKey(input: BuildCtoAttentionKeyInput): string {
  const kind = toCtoAttentionKind(input.kind) ?? trimToNull(input.kind) ?? "unknown";
  const sourceThreadId = trimToNull(input.sourceThreadId);
  const sourceRole = trimToNull(input.sourceRole);
  const correlationToken =
    readStableCorrelationToken(input.evidence) ??
    trimToNull(input.correlationId) ??
    trimToNull(input.commandId) ??
    trimToNull(input.notificationId) ??
    "unknown";

  return [
    `program:${trimToNull(input.programId) ?? "unknown"}`,
    `kind:${kind}`,
    sourceThreadId !== null ? `source-thread:${sourceThreadId}` : "source-thread:",
    sourceRole !== null ? `source-role:${sourceRole}` : "source-role:",
    `correlation:${correlationToken}`,
  ].join("|");
}
