import { useEffect } from "react";
import type { Thread } from "../types";
import { APP_DISPLAY_NAME } from "../branding";

function normalizeTitlePart(part: string | null | undefined): string | null {
  if (typeof part !== "string") {
    return null;
  }

  const trimmed = part.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildAppDocumentTitle(input?: {
  parts?: readonly (string | null | undefined)[];
  attentionPrefix?: string | null | undefined;
}): string {
  const titleParts: string[] = [];
  const attentionPrefix = normalizeTitlePart(input?.attentionPrefix);
  if (attentionPrefix) {
    titleParts.push(attentionPrefix);
  }

  for (const part of input?.parts ?? []) {
    const normalized = normalizeTitlePart(part);
    if (normalized) {
      titleParts.push(normalized);
    }
  }

  titleParts.push(APP_DISPLAY_NAME);
  return titleParts.join(" · ");
}

export function resolveChatDocumentTitle(input: {
  thread: Pick<Thread, "title" | "spawnRole"> | null | undefined;
  projectName: string | undefined;
  attentionPrefix?: string | null | undefined;
}): string {
  const thread = input.thread;
  if (!thread) {
    return buildAppDocumentTitle({ attentionPrefix: input.attentionPrefix });
  }

  if (thread.spawnRole === "orchestrator") {
    return buildAppDocumentTitle({
      attentionPrefix: input.attentionPrefix,
      parts: [thread.title],
    });
  }

  return buildAppDocumentTitle({
    attentionPrefix: input.attentionPrefix,
    parts: [input.projectName, thread.title],
  });
}

export function resolveSettingsDocumentTitle(input?: {
  attentionPrefix?: string | null | undefined;
}): string {
  return buildAppDocumentTitle({
    attentionPrefix: input?.attentionPrefix,
    parts: ["Settings"],
  });
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.title = title;
    return () => {
      document.title = buildAppDocumentTitle();
    };
  }, [title]);
}
