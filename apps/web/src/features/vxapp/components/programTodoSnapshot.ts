import type {
  ServerAgentsVxappTodoPlanLink,
  ServerAgentsVxappTodoSnapshot,
} from "@t3tools/contracts";

import { randomUUID } from "~/lib/utils";

export type EditableTodoPlanLinkDraft = {
  id: string;
  phase: string | null;
  planKey: string;
  repo: string;
  step: string | null;
};

const EMPTY_PLAN_LINKS: readonly ServerAgentsVxappTodoPlanLink[] = [];
const EMPTY_NOTES: readonly unknown[] = [];

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isTodoPlanLink(value: unknown): value is ServerAgentsVxappTodoPlanLink {
  const record = readRecord(value);
  if (!record) {
    return false;
  }

  return (
    typeof record.repo === "string" &&
    record.repo.length > 0 &&
    typeof record.planKey === "string" &&
    record.planKey.length > 0 &&
    (record.phase === undefined || record.phase === null || typeof record.phase === "string") &&
    (record.step === undefined || record.step === null || typeof record.step === "string") &&
    (record.linkedAt === undefined ||
      record.linkedAt === null ||
      typeof record.linkedAt === "string")
  );
}

export function readTodoPlanLinks(
  todo: Pick<ServerAgentsVxappTodoSnapshot, "planLinks"> | null | undefined | unknown,
): readonly ServerAgentsVxappTodoPlanLink[] {
  const planLinks = readRecord(todo)?.planLinks;
  if (!Array.isArray(planLinks)) {
    return EMPTY_PLAN_LINKS;
  }

  return planLinks.filter(isTodoPlanLink);
}

export function readTodoNotes(
  todo: Pick<ServerAgentsVxappTodoSnapshot, "notes"> | null | undefined | unknown,
): readonly unknown[] {
  const notes = readRecord(todo)?.notes;
  return Array.isArray(notes) ? notes : EMPTY_NOTES;
}

export function buildEditableTodoPlanLinkDrafts(
  todo: Pick<ServerAgentsVxappTodoSnapshot, "planLinks"> | null | undefined | unknown,
): EditableTodoPlanLinkDraft[] {
  return readTodoPlanLinks(todo).map((link) => ({
    id: randomUUID(),
    repo: link.repo,
    planKey: link.planKey,
    phase: link.phase ?? null,
    step: link.step ?? null,
  }));
}
