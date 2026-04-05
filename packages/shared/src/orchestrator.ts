export function normalizeOrchestratorDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

const MAX_THREAD_LABEL_COUNT = 16;

export function normalizeOrchestratorLabel(value: string | null | undefined): string | null {
  const displayName = normalizeOrchestratorDisplayName(value);
  if (displayName === null) {
    return null;
  }

  const normalized = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

export function buildOrchestratorThreadLabels(value: string | null | undefined): readonly string[] {
  const orchestratorLabel = normalizeOrchestratorLabel(value);
  return orchestratorLabel === null ? ["orchestrator"] : ["orchestrator", orchestratorLabel];
}

function uniqueTrimmedLabels(
  labels: ReadonlyArray<string> | null | undefined,
): ReadonlyArray<string> {
  if (!labels) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function managedOrchestratorLabelSet(
  values: ReadonlyArray<string | null | undefined>,
): ReadonlySet<string> {
  const labels = new Set<string>(["orchestrator"]);
  for (const value of values) {
    const normalized = normalizeOrchestratorLabel(value);
    if (normalized !== null) {
      labels.add(normalized);
    }
  }
  return labels;
}

export function reconcileOrchestratorThreadLabels(input: {
  readonly existingLabels: ReadonlyArray<string> | null | undefined;
  readonly orchestratorName: string | null | undefined;
  readonly previousOrchestratorName?: string | null | undefined;
}): readonly string[] {
  const nextManagedLabels = buildOrchestratorThreadLabels(input.orchestratorName);
  const managedLabels = managedOrchestratorLabelSet([
    input.orchestratorName,
    input.previousOrchestratorName,
  ]);
  const preservedLabels = uniqueTrimmedLabels(input.existingLabels).filter(
    (label) => !managedLabels.has(label),
  );

  return [...nextManagedLabels, ...preservedLabels].slice(0, MAX_THREAD_LABEL_COUNT);
}

export function stripOrchestratorThreadLabels(input: {
  readonly existingLabels: ReadonlyArray<string> | null | undefined;
  readonly orchestratorName?: string | null | undefined;
  readonly previousOrchestratorName?: string | null | undefined;
}): readonly string[] {
  const managedLabels = managedOrchestratorLabelSet([
    input.orchestratorName,
    input.previousOrchestratorName,
  ]);

  return uniqueTrimmedLabels(input.existingLabels).filter((label) => !managedLabels.has(label));
}
