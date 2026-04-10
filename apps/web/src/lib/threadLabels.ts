export interface ThreadDisplayLabelEntry {
  key: string;
  rawLabel: string;
  displayLabel: string;
}

function trimLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeDisplayThreadLabel(label: string): string | null {
  const trimmed = trimLabel(label);
  if (trimmed === null) {
    return null;
  }

  if (trimmed.startsWith("provider:")) {
    return null;
  }

  if (trimmed.startsWith("model:")) {
    return trimLabel(trimmed.slice("model:".length));
  }

  return trimmed;
}

export function getDisplayThreadLabelEntries(
  labels: ReadonlyArray<string> | null | undefined,
  maxLabels = Number.POSITIVE_INFINITY,
): ThreadDisplayLabelEntry[] {
  const resolvedLabels: ThreadDisplayLabelEntry[] = [];
  const seenDisplayLabels = new Set<string>();

  for (const label of labels ?? []) {
    const rawLabel = trimLabel(label);
    if (rawLabel === null) {
      continue;
    }
    const displayLabel = normalizeDisplayThreadLabel(rawLabel);
    if (displayLabel === null || seenDisplayLabels.has(displayLabel)) {
      continue;
    }
    seenDisplayLabels.add(displayLabel);
    resolvedLabels.push({
      key: rawLabel,
      rawLabel,
      displayLabel,
    });
    if (resolvedLabels.length >= maxLabels) {
      break;
    }
  }

  return resolvedLabels;
}
