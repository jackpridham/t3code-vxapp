import type { Project, Thread } from "../types";

export interface WorkerLineageIssue {
  key:
    | "missing-orchestrator-project-id"
    | "missing-orchestrator-thread-id"
    | "missing-parent-thread-id"
    | "missing-workflow-id"
    | "unknown-orchestrator-project"
    | "unknown-orchestrator-thread"
    | "unknown-parent-thread";
  message: string;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getWorkerLineageIssues(input: {
  thread: Pick<
    Thread,
    "spawnRole" | "orchestratorProjectId" | "orchestratorThreadId" | "parentThreadId" | "workflowId"
  >;
  threads?: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}): WorkerLineageIssue[] {
  if (input.thread.spawnRole !== "worker") {
    return [];
  }

  const issues: WorkerLineageIssue[] = [];

  if (!isNonEmptyString(input.thread.orchestratorProjectId)) {
    issues.push({
      key: "missing-orchestrator-project-id",
      message: "Missing orchestratorProjectId.",
    });
  }
  if (!isNonEmptyString(input.thread.orchestratorThreadId)) {
    issues.push({
      key: "missing-orchestrator-thread-id",
      message: "Missing orchestratorThreadId.",
    });
  }
  if (!isNonEmptyString(input.thread.parentThreadId)) {
    issues.push({
      key: "missing-parent-thread-id",
      message: "Missing parentThreadId.",
    });
  }
  if (!isNonEmptyString(input.thread.workflowId)) {
    issues.push({
      key: "missing-workflow-id",
      message: "Missing workflowId.",
    });
  }

  if (
    isNonEmptyString(input.thread.orchestratorProjectId) &&
    input.projects &&
    !input.projects.some((project) => project.id === input.thread.orchestratorProjectId)
  ) {
    issues.push({
      key: "unknown-orchestrator-project",
      message: `orchestratorProjectId '${input.thread.orchestratorProjectId}' does not resolve to a known project.`,
    });
  }

  if (
    isNonEmptyString(input.thread.orchestratorThreadId) &&
    input.threads &&
    !input.threads.some((thread) => thread.id === input.thread.orchestratorThreadId)
  ) {
    issues.push({
      key: "unknown-orchestrator-thread",
      message: `orchestratorThreadId '${input.thread.orchestratorThreadId}' does not resolve to a known thread.`,
    });
  }

  if (
    isNonEmptyString(input.thread.parentThreadId) &&
    input.threads &&
    !input.threads.some((thread) => thread.id === input.thread.parentThreadId)
  ) {
    issues.push({
      key: "unknown-parent-thread",
      message: `parentThreadId '${input.thread.parentThreadId}' does not resolve to a known thread.`,
    });
  }

  return issues;
}

export function getWorkerLineageWarningDescription(input: {
  thread: Pick<
    Thread,
    "spawnRole" | "orchestratorProjectId" | "orchestratorThreadId" | "parentThreadId" | "workflowId"
  >;
  threads?: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}): string | null {
  const issues = getWorkerLineageIssues(input);
  if (issues.length === 0) {
    return null;
  }

  return `Worker lineage warning: ${issues.map((issue) => issue.message).join(" ")}`;
}
