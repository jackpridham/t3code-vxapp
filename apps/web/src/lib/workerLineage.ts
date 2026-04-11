import type { Project, Thread } from "../types";

export type WorkerLineageIssueSeverity = "error" | "warning" | "info";

export type WorkerLineageIssueKey =
  | "missing-orchestrator-project-id"
  | "missing-orchestrator-thread-id"
  | "missing-parent-thread-id"
  | "missing-workflow-id"
  | "unknown-orchestrator-project"
  | "unknown-orchestrator-thread"
  | "unknown-parent-thread";

export interface WorkerLineageIssue {
  key: WorkerLineageIssueKey;
  severity: WorkerLineageIssueSeverity;
  message: string;
}

export interface WorkerLineageIndicator {
  severity: WorkerLineageIssueSeverity;
  label: string;
  description: string;
  issues: WorkerLineageIssue[];
}

const ISSUE_SEVERITY_BY_KEY: Record<WorkerLineageIssueKey, WorkerLineageIssueSeverity> = {
  "missing-orchestrator-project-id": "error",
  "missing-orchestrator-thread-id": "error",
  "unknown-orchestrator-project": "error",
  "unknown-orchestrator-thread": "error",
  "missing-parent-thread-id": "warning",
  "unknown-parent-thread": "warning",
  "missing-workflow-id": "info",
};

const SEVERITY_RANK: Record<WorkerLineageIssueSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

const LABEL_BY_SEVERITY: Record<WorkerLineageIssueSeverity, string> = {
  error: "Worker ownership problem",
  warning: "Worker lineage warning",
  info: "Worker lineage note",
};

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildWorkerLineageIssue(key: WorkerLineageIssueKey, message: string): WorkerLineageIssue {
  return {
    key,
    severity: ISSUE_SEVERITY_BY_KEY[key],
    message,
  };
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
    issues.push(
      buildWorkerLineageIssue("missing-orchestrator-project-id", "Missing orchestratorProjectId."),
    );
  }
  if (!isNonEmptyString(input.thread.orchestratorThreadId)) {
    issues.push(
      buildWorkerLineageIssue("missing-orchestrator-thread-id", "Missing orchestratorThreadId."),
    );
  }
  if (!isNonEmptyString(input.thread.parentThreadId)) {
    issues.push(buildWorkerLineageIssue("missing-parent-thread-id", "Missing parentThreadId."));
  }
  if (!isNonEmptyString(input.thread.workflowId)) {
    issues.push(buildWorkerLineageIssue("missing-workflow-id", "Missing workflowId."));
  }

  if (
    isNonEmptyString(input.thread.orchestratorProjectId) &&
    input.projects &&
    !input.projects.some((project) => project.id === input.thread.orchestratorProjectId)
  ) {
    issues.push(
      buildWorkerLineageIssue(
        "unknown-orchestrator-project",
        `orchestratorProjectId '${input.thread.orchestratorProjectId}' does not resolve to a known project.`,
      ),
    );
  }

  if (
    isNonEmptyString(input.thread.orchestratorThreadId) &&
    input.threads &&
    !input.threads.some((thread) => thread.id === input.thread.orchestratorThreadId)
  ) {
    issues.push(
      buildWorkerLineageIssue(
        "unknown-orchestrator-thread",
        `orchestratorThreadId '${input.thread.orchestratorThreadId}' does not resolve to a known thread.`,
      ),
    );
  }

  if (
    isNonEmptyString(input.thread.parentThreadId) &&
    input.threads &&
    !input.threads.some((thread) => thread.id === input.thread.parentThreadId)
  ) {
    issues.push(
      buildWorkerLineageIssue(
        "unknown-parent-thread",
        `parentThreadId '${input.thread.parentThreadId}' does not resolve to a known thread.`,
      ),
    );
  }

  return issues;
}

export function getWorkerLineageIndicator(input: {
  thread: Pick<
    Thread,
    "spawnRole" | "orchestratorProjectId" | "orchestratorThreadId" | "parentThreadId" | "workflowId"
  >;
  threads?: readonly Pick<Thread, "id">[];
  projects?: readonly Pick<Project, "id">[];
}): WorkerLineageIndicator | null {
  const issues = getWorkerLineageIssues(input);
  if (issues.length === 0) {
    return null;
  }

  const severity = issues.reduce<WorkerLineageIssueSeverity>(
    (highest, issue) =>
      SEVERITY_RANK[issue.severity] > SEVERITY_RANK[highest] ? issue.severity : highest,
    "info",
  );
  const label = LABEL_BY_SEVERITY[severity];

  return {
    severity,
    label,
    description: `${label}: ${issues.map((issue) => issue.message).join(" ")}`,
    issues,
  };
}
