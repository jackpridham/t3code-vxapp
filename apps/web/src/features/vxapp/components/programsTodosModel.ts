import type {
  ServerGetAgentsVxappControlPlaneSnapshotResult,
  ServerAgentsVxappProgramSnapshot,
  ServerAgentsVxappTodoSnapshot,
} from "@t3tools/contracts";
import type { Project, Thread } from "~/types";
import { readProgramScope, resolveProgramDisplay } from "./programDisplay";
export {
  readProgramCloseoutVerdict,
  readProgramScope,
  readProgramScopeSummary,
} from "./programDisplay";

type JsonRecord = Record<string, unknown>;

export type ExecutiveOption = {
  label: string;
  projectId: string;
  threadId: string;
};

export type OrchestratorOption = {
  label: string;
  threadId: string;
};

export type OwnerDisplayOption = {
  action: string | null;
  label: string;
  sortKey: string | null;
  tone: string | null;
  value: string;
};

export type ProgramLanePolicy = {
  allowedBranchPatterns: readonly string[];
  defaultBaseBranch: string;
  defaultEnvironment: string;
  ownerPayloadRequired: boolean;
  placeholders: { submittable: false };
  worktreePattern: string;
};

export type ProgramTodoGroup =
  | {
      currentTodoId: string | null;
      description: string | null;
      key: string;
      kind: "program";
      label: string;
      program: ServerAgentsVxappProgramSnapshot;
      programId: string;
      searchText: string;
      todos: readonly ServerAgentsVxappTodoSnapshot[];
    }
  | {
      currentTodoId: null;
      description: string;
      key: string;
      kind: "unassigned";
      label: string;
      program: null;
      programId: null;
      searchText: string;
      todos: readonly ServerAgentsVxappTodoSnapshot[];
    }
  | {
      currentTodoId: null;
      description: string;
      key: string;
      kind: "detached";
      label: string;
      program: null;
      programId: null;
      referencedProgramId: string;
      searchText: string;
      todos: readonly ServerAgentsVxappTodoSnapshot[];
    };

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }
  return value;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isObjectArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function baseProgramScopeTemplate(): JsonRecord {
  return {
    appTargets: [],
    authoritySource: "local_placeholder",
    declaredRepos: ["repo-name"],
    ownerPayloadRequired: true,
    placeholders: {
      submittable: false,
    },
    repoLaneContracts: [
      {
        allowedHeadBranchPatterns: [],
        allowedWorktreePatterns: [],
        baseBranch: "",
        repo: "repo-name",
        requireManagedWorktree: true,
        worktreeMode: "",
      },
    ],
    requireCleanPostFlight: false,
    requireDevelopmentDeploy: false,
    requireExternalE2E: false,
    requirePrPerRepo: true,
    requiredExternalE2ESuites: [],
    requiredLocalSuites: [],
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function toOwnerDisplayOption(value: unknown): OwnerDisplayOption | null {
  if (typeof value === "string") {
    return {
      action: null,
      label: value,
      sortKey: null,
      tone: null,
      value,
    };
  }

  const record = asObject(value);
  const resolvedValue =
    asString(record?.value) ??
    asString(record?.status) ??
    asString(record?.id) ??
    asString(record?.key);
  if (!resolvedValue) {
    return null;
  }
  const display = asObject(record?.display);
  return {
    action: asString(record?.action),
    label: asString(display?.label) ?? asString(record?.label) ?? resolvedValue,
    sortKey: asString(display?.sortKey) ?? asString(record?.sortKey),
    tone: asString(display?.tone) ?? asString(record?.tone),
    value: resolvedValue,
  };
}

function readProgramLanePolicyValue(value: unknown): ProgramLanePolicy | null {
  const record = asObject(value);
  const placeholders = asObject(record?.placeholders);
  const allowedBranchPatterns = asStringList(record?.allowedBranchPatterns);
  const defaultBaseBranch = asString(record?.defaultBaseBranch);
  const defaultEnvironment = asString(record?.defaultEnvironment);
  const worktreePattern = asString(record?.worktreePattern);
  if (
    !defaultBaseBranch ||
    !defaultEnvironment ||
    !worktreePattern ||
    allowedBranchPatterns.length === 0 ||
    placeholders?.submittable !== false ||
    record?.ownerPayloadRequired !== true
  ) {
    return null;
  }
  return {
    allowedBranchPatterns,
    defaultBaseBranch,
    defaultEnvironment,
    ownerPayloadRequired: true,
    placeholders: { submittable: false },
    worktreePattern,
  };
}

function readOwnerOptionArray(input: {
  keys: readonly string[];
  source: unknown;
}): OwnerDisplayOption[] {
  const record = asObject(input.source);
  if (!record) {
    return [];
  }

  for (const key of input.keys) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    const options = candidate.flatMap((entry) => {
      const option = toOwnerDisplayOption(entry);
      return option ? [option] : [];
    });
    if (options.length > 0) {
      return options.toSorted(
        (left, right) =>
          (left.sortKey ?? "").localeCompare(right.sortKey ?? "") ||
          left.label.localeCompare(right.label),
      );
    }
  }

  return [];
}

export function makeExecutiveKey(projectId: string, threadId: string): string {
  return `${projectId}::${threadId}`;
}

function toTitleCase(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function resolveRoleSessionName(input: {
  roleSession: { role: "cto" | "jasper"; sessionId: string | null } | null;
}): string | null {
  return input.roleSession ? toTitleCase(input.roleSession.role) : null;
}

export function resolveArchivedRoleSessionNameFromPathForDisplay(
  path: string | null | undefined,
): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/");
  const match = normalized.match(/\/role-sessions\/([^/]+)\/[^/]+\/workspace$/);
  return match?.[1] ? toTitleCase(match[1]) : null;
}

export function resolveExecutiveOptions(input: {
  programs: readonly ServerAgentsVxappProgramSnapshot[];
  projects: readonly Project[];
  threads: readonly Thread[];
}): ExecutiveOption[] {
  const projectById = new Map(input.projects.map((project) => [project.id, project]));
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread]));
  const byKey = new Map<string, ExecutiveOption>();

  for (const program of input.programs) {
    if (!program.executiveProjectId || !program.executiveThreadId) {
      continue;
    }
    const key = makeExecutiveKey(program.executiveProjectId, program.executiveThreadId);
    if (byKey.has(key)) {
      continue;
    }
    const project = projectById.get(program.executiveProjectId) ?? null;
    const thread = threadById.get(program.executiveThreadId) ?? null;
    byKey.set(key, {
      label: project?.name ?? thread?.title ?? program.executiveProjectId,
      projectId: program.executiveProjectId,
      threadId: program.executiveThreadId,
    });
  }

  return [...byKey.values()].toSorted((left, right) => left.label.localeCompare(right.label));
}

export function resolveOrchestratorOptions(input: {
  programs: readonly ServerAgentsVxappProgramSnapshot[];
  threads: readonly Thread[];
  threadLinks?: readonly {
    threadId: Thread["id"];
    title: string | null;
    roleSession?: { role: "cto" | "jasper"; sessionId: string | null } | null;
    workspaceRoot: string | null;
    worktreePath: string | null;
    spawnRole: string | null;
  }[];
}): OrchestratorOption[] {
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread]));
  const byId = new Map<string, OrchestratorOption>();
  const candidateThreadIds = new Set(
    input.programs
      .map((program) => program.currentOrchestratorThreadId)
      .filter(
        (threadId): threadId is Thread["id"] => typeof threadId === "string" && threadId.length > 0,
      ),
  );

  for (const threadLink of input.threadLinks ?? []) {
    if (threadLink.spawnRole === "orchestrator" || candidateThreadIds.has(threadLink.threadId)) {
      const thread = threadById.get(threadLink.threadId) ?? null;
      const label =
        resolveRoleSessionName({ roleSession: threadLink.roleSession ?? null }) ??
        thread?.title ??
        threadLink.title ??
        threadLink.threadId;
      byId.set(threadLink.threadId, { label, threadId: threadLink.threadId });
    }
  }

  for (const threadId of candidateThreadIds) {
    if (byId.has(threadId)) {
      continue;
    }
    const thread = threadById.get(threadId) ?? null;
    byId.set(threadId, {
      label: thread?.title ?? threadId,
      threadId,
    });
  }

  return [...byId.values()].toSorted((left, right) => left.label.localeCompare(right.label));
}

export function resolveProgramExecutiveLabel(
  program: ServerAgentsVxappProgramSnapshot,
  executiveOptions: readonly ExecutiveOption[],
): string {
  if (!program.executiveProjectId || !program.executiveThreadId) {
    return "Unassigned Executive";
  }
  const option = executiveOptions.find(
    (entry) =>
      entry.projectId === program.executiveProjectId &&
      entry.threadId === program.executiveThreadId,
  );
  return option?.label ?? "Unassigned Executive";
}

export function resolveProgramOrchestratorLabel(
  program: ServerAgentsVxappProgramSnapshot,
  orchestratorOptions: readonly OrchestratorOption[],
): string {
  if (!program.currentOrchestratorThreadId) {
    return "No orchestrator";
  }
  const option = orchestratorOptions.find(
    (entry) => entry.threadId === program.currentOrchestratorThreadId,
  );
  return option?.label ?? program.currentOrchestratorThreadId;
}

export function canonicalizeProgramScope(scope: JsonRecord | null | undefined): string {
  return JSON.stringify(sortJsonValue(scope ?? {}));
}

export function validateProgramScope(scope: JsonRecord): string[] {
  const declaredRepos = asStringList(scope.declaredRepos);
  const repoLaneContracts = isObjectArray(scope.repoLaneContracts);
  const appTargets = asStringList(scope.appTargets);
  const requiredLocalSuites = isObjectArray(scope.requiredLocalSuites);
  const requiredExternalE2ESuites = isObjectArray(scope.requiredExternalE2ESuites);

  const contractRepos = repoLaneContracts
    .map((contract) => (typeof contract.repo === "string" ? contract.repo.trim() : ""))
    .filter((repo) => repo.length > 0);
  const allowedExternalTargets = new Set([...declaredRepos, ...appTargets]);

  const hasInvalidLaneContract = repoLaneContracts.some((contract) => {
    const repo = typeof contract.repo === "string" ? contract.repo.trim() : "";
    const baseBranch = typeof contract.baseBranch === "string" ? contract.baseBranch.trim() : "";
    const headPatterns = asStringList(contract.allowedHeadBranchPatterns);
    const worktreeMode =
      typeof contract.worktreeMode === "string" ? contract.worktreeMode.trim() : "";
    return (
      repo.length === 0 ||
      baseBranch.length === 0 ||
      headPatterns.length === 0 ||
      worktreeMode.length === 0 ||
      typeof contract.requireManagedWorktree !== "boolean"
    );
  });

  const hasInvalidLocalSuite = requiredLocalSuites.some((suite) => {
    const repo = typeof suite.repo === "string" ? suite.repo.trim() : "";
    const suiteId = typeof suite.suite === "string" ? suite.suite.trim() : "";
    return repo.length === 0 || suiteId.length === 0 || !declaredRepos.includes(repo);
  });

  const hasInvalidExternalSuite = requiredExternalE2ESuites.some((suite) => {
    const target = typeof suite.target === "string" ? suite.target.trim() : "";
    const suiteId = typeof suite.suite === "string" ? suite.suite.trim() : "";
    return target.length === 0 || suiteId.length === 0 || !allowedExternalTargets.has(target);
  });

  const errors: string[] = [];
  if (
    asObject(scope.placeholders)?.submittable === false ||
    scope.authoritySource === "local_placeholder"
  ) {
    errors.push("Local placeholder Program scope cannot be submitted.");
  }
  if (declaredRepos.length === 0) {
    errors.push("At least one declared repo is required.");
  }
  if (hasDuplicates(declaredRepos)) {
    errors.push("Declared repos must be unique.");
  }
  if (hasDuplicates(appTargets)) {
    errors.push("App targets must be unique.");
  }
  if (
    contractRepos.length !== declaredRepos.length ||
    hasDuplicates(contractRepos) ||
    hasInvalidLaneContract ||
    declaredRepos.some((repo) => !contractRepos.includes(repo)) ||
    contractRepos.some((repo) => !declaredRepos.includes(repo))
  ) {
    errors.push("Every declared repo must have exactly one valid lane contract.");
  }
  if (hasInvalidLocalSuite || hasInvalidExternalSuite) {
    errors.push("Scope suite bindings are invalid.");
  }
  return errors;
}

export function resolveProgramLanePolicy(
  snapshot: ServerGetAgentsVxappControlPlaneSnapshotResult | null | undefined,
): ProgramLanePolicy | null {
  const source = asObject(snapshot);
  return readProgramLanePolicyValue(
    source?.programLanePolicy ?? asObject(source?.options)?.programLanePolicy,
  );
}

export function chooseCreateProgramScopeTemplate(
  programs: readonly ServerAgentsVxappProgramSnapshot[],
): {
  scope: JsonRecord;
  sourceProgramId: string | null;
  sourceProgramTitle: string | null;
  usedFallback: boolean;
} {
  for (const program of programs) {
    const scope = readProgramScope(program);
    if (!scope) {
      continue;
    }
    if (validateProgramScope(scope).length === 0) {
      return {
        scope,
        sourceProgramId: program.id,
        sourceProgramTitle: program.title,
        usedFallback: false,
      };
    }
  }
  return {
    scope: baseProgramScopeTemplate(),
    sourceProgramId: null,
    sourceProgramTitle: null,
    usedFallback: true,
  };
}

export function resolveProgramLifecycleOptions(
  snapshot: ServerGetAgentsVxappControlPlaneSnapshotResult | null | undefined,
): OwnerDisplayOption[] {
  return readOwnerOptionArray({
    keys: ["programLifecycleOptions", "lifecycleOptions"],
    source: asObject(snapshot)?.options ?? snapshot,
  });
}

export function resolveTodoStatusOptions(
  snapshot: ServerGetAgentsVxappControlPlaneSnapshotResult | null | undefined,
): OwnerDisplayOption[] {
  return readOwnerOptionArray({
    keys: ["todoStatusOptions", "statusOptions"],
    source: asObject(snapshot)?.options ?? snapshot,
  });
}

export function resolveTodoPriorityOptions(
  snapshot: ServerGetAgentsVxappControlPlaneSnapshotResult | null | undefined,
): OwnerDisplayOption[] {
  return readOwnerOptionArray({
    keys: ["todoPriorityOptions", "priorityOptions"],
    source: asObject(snapshot)?.options ?? snapshot,
  });
}

export function buildProgramTodoGroups(input: {
  currentTodoByProgramId: ReadonlyMap<string, string>;
  programs: readonly ServerAgentsVxappProgramSnapshot[];
  todos: readonly ServerAgentsVxappTodoSnapshot[];
}): ProgramTodoGroup[] {
  const todosByProgramId = new Map<string, ServerAgentsVxappTodoSnapshot[]>();
  const unassignedTodos: ServerAgentsVxappTodoSnapshot[] = [];

  for (const todo of input.todos) {
    if (!todo.programId) {
      unassignedTodos.push(todo);
      continue;
    }
    const current = todosByProgramId.get(todo.programId) ?? [];
    current.push(todo);
    todosByProgramId.set(todo.programId, current);
  }

  const groups: ProgramTodoGroup[] = input.programs.map((program) => {
    const todos = todosByProgramId.get(program.id) ?? [];
    todosByProgramId.delete(program.id);
    const display = resolveProgramDisplay(program);
    return {
      currentTodoId: input.currentTodoByProgramId.get(program.id) ?? null,
      description: display.summary,
      key: `program:${program.id}`,
      kind: "program",
      label: display.heading,
      program,
      programId: program.id,
      searchText: [
        display.heading,
        display.label ?? "",
        display.summary ?? "",
        ...todos.flatMap((todo) => [
          todo.title,
          todo.summary ?? "",
          todo.nextAction ?? "",
          todo.todoId,
        ]),
      ]
        .join(" ")
        .toLowerCase(),
      todos,
    };
  });

  if (unassignedTodos.length > 0) {
    groups.push({
      currentTodoId: null,
      description: "TODOs not currently assigned to a Program.",
      key: "todos:unassigned",
      kind: "unassigned",
      label: "Unassigned TODOs",
      program: null,
      programId: null,
      searchText: [
        "unassigned todos",
        ...unassignedTodos.flatMap((todo) => [
          todo.title,
          todo.summary ?? "",
          todo.nextAction ?? "",
          todo.todoId,
        ]),
      ]
        .join(" ")
        .toLowerCase(),
      todos: unassignedTodos,
    });
  }

  for (const [referencedProgramId, todos] of [...todosByProgramId.entries()].toSorted(
    ([left], [right]) => left.localeCompare(right),
  )) {
    groups.push({
      currentTodoId: null,
      description: "TODOs still reference a Program id that is not in the current Program list.",
      key: `todos:detached:${referencedProgramId}`,
      kind: "detached",
      label: `Missing Program ${referencedProgramId.slice(0, 8)}`,
      program: null,
      programId: null,
      referencedProgramId,
      searchText: [
        referencedProgramId,
        "missing program",
        ...todos.flatMap((todo) => [
          todo.title,
          todo.summary ?? "",
          todo.nextAction ?? "",
          todo.todoId,
        ]),
      ]
        .join(" ")
        .toLowerCase(),
      todos,
    });
  }

  return groups;
}
