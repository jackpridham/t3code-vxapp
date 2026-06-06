import type {
  AgentRuntimeAgentKind,
  AgentsVxappSidebarAuthorityRuntimeTarget,
  AgentsVxappOwnerBoundaryError,
  AgentsVxappOwnerLoadStatus,
  ServerAgentsVxappCurrentTodoProjection,
  ServerAgentsVxappPagination,
  ServerAgentsVxappProgramSnapshot,
  ServerAgentsVxappSidebarAttentionItem,
  ServerAgentsVxappSidebarAuthorityProgramCard,
  ServerAgentsVxappSidebarProgramNotification,
  ServerAgentsVxappSidebarWake,
  ServerAgentsVxappSidebarWatchProjection,
  ServerAgentsVxappTodoSnapshot,
  ServerGetAgentRuntimeSnapshotResult,
  ServerGetAgentsVxappSidebarAuthoritySnapshotResult,
  ServerGetWorkerRuntimeSnapshotResult,
} from "@t3tools/contracts";
import { ProgramId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { Project, Thread } from "~/types";
import {
  resolvePreviewWorkerRuntimeSnapshot,
  type PreviewWorkerRuntimeFixtureId,
} from "./workerRuntimePreview";

const DEMO_TIMESTAMP = {
  now: "2026-06-05T10:45:00.000Z",
  recent: "2026-06-05T10:32:00.000Z",
  earlier: "2026-06-05T09:58:00.000Z",
  older: "2026-06-05T08:24:00.000Z",
  archived: "2026-06-04T19:12:00.000Z",
} as const;

function makeProject(input: Partial<Project> & Pick<Project, "cwd" | "id" | "name">): Project {
  return {
    currentSessionRootThreadId: null,
    defaultModelSelection: null,
    hooks: [],
    scripts: [],
    ...input,
  };
}

function makeThread(input: Partial<Thread> & Pick<Thread, "id" | "projectId" | "title">): Thread {
  const { id, projectId, title, ...rest } = input;
  return {
    activities: [],
    archivedAt: null,
    branch: null,
    codexThreadId: null,
    createdAt: DEMO_TIMESTAMP.older,
    error: null,
    hasActiveError: false,
    activeError: null,
    historicalError: null,
    errorPresentationSource: "none",
    id,
    interactionMode: "default",
    latestTurn: null,
    messages: [],
    modelSelection: { provider: "codex", model: "gpt-5.4" },
    persistedFileChanges: [],
    projectId,
    proposedPlans: [],
    runtimeMode: "full-access",
    session: null,
    title,
    turnDiffSummaries: [],
    updatedAt: DEMO_TIMESTAMP.recent,
    worktreePath: null,
    ...rest,
  } as Thread;
}

function makeProgram(
  input: Partial<ServerAgentsVxappProgramSnapshot> &
    Pick<ServerAgentsVxappProgramSnapshot, "id" | "status" | "title">,
): ServerAgentsVxappProgramSnapshot {
  const { id, status, title, ...rest } = input;
  return {
    baseStatus: status,
    closeout: null,
    completedAt: null,
    createdAt: DEMO_TIMESTAMP.older,
    currentOrchestratorThreadId: null,
    currentStatus: status,
    deletedAt: null,
    executiveProjectId: null,
    executiveThreadId: null,
    id,
    metadata: null,
    objective: null,
    updatedAt: DEMO_TIMESTAMP.recent,
    status,
    title,
    ...rest,
  };
}

function makeRuntimeTarget(input: {
  agentKind: AgentRuntimeAgentKind;
  availability?: "inspectable" | "degraded" | "unavailable";
  displayLabel?: string | null;
  reasonCode?:
    | "runtime_authority_missing"
    | "runtime_files_missing"
    | "runtime_payload_invalid"
    | null;
  threadId?: string | null;
  workspace?: string | null;
}): AgentsVxappSidebarAuthorityRuntimeTarget {
  return {
    kind: input.agentKind,
    agentKind: input.agentKind,
    threadId: input.threadId ? ThreadId.makeUnsafe(input.threadId) : null,
    workspace: input.workspace ?? null,
    availability: input.availability ?? "inspectable",
    reasonCode: input.reasonCode ?? null,
    displayLabel: input.displayLabel ?? null,
  };
}

function makeTodo(
  input: Partial<ServerAgentsVxappTodoSnapshot> &
    Pick<ServerAgentsVxappTodoSnapshot, "agent" | "title" | "todoId">,
): ServerAgentsVxappTodoSnapshot {
  const { agent, title, todoId, ...rest } = input;
  return {
    agent,
    createdAt: DEMO_TIMESTAMP.older,
    filePath: null,
    nextAction: null,
    notes: [],
    owner: null,
    planLinks: [],
    priority: "normal",
    programId: null,
    status: "ready",
    summary: null,
    title,
    todoId,
    updatedAt: DEMO_TIMESTAMP.recent,
    ...rest,
  };
}

function makeNotification(
  input: Partial<ServerAgentsVxappSidebarProgramNotification> &
    Pick<
      ServerAgentsVxappSidebarProgramNotification,
      "kind" | "notificationId" | "programId" | "severity" | "summary"
    >,
): ServerAgentsVxappSidebarProgramNotification {
  const { kind, notificationId, programId, severity, summary, ...rest } = input;
  return {
    consumeReason: null,
    consumedAt: null,
    createdAt: DEMO_TIMESTAMP.older,
    deliveredAt: null,
    dropReason: null,
    droppedAt: null,
    evidence: null,
    executiveProjectId: null,
    executiveThreadId: null,
    kind,
    notificationId,
    orchestratorThreadId: null,
    programId,
    queuedAt: DEMO_TIMESTAMP.recent,
    severity,
    state: "pending",
    summary,
    updatedAt: DEMO_TIMESTAMP.recent,
    ...rest,
  };
}

function makeAttention(
  input: Partial<ServerAgentsVxappSidebarAttentionItem> &
    Pick<
      ServerAgentsVxappSidebarAttentionItem,
      "attentionId" | "kind" | "programId" | "severity" | "summary"
    >,
): ServerAgentsVxappSidebarAttentionItem {
  const { attentionId, kind, programId, severity, summary, ...rest } = input;
  return {
    acknowledgedAt: null,
    attentionId,
    attentionKey: null,
    createdAt: DEMO_TIMESTAMP.older,
    droppedAt: null,
    evidence: null,
    executiveProjectId: null,
    executiveThreadId: null,
    kind,
    notificationId: null,
    programId,
    queuedAt: DEMO_TIMESTAMP.recent,
    resolvedAt: null,
    severity,
    sourceRole: null,
    sourceThreadId: null,
    state: "required",
    summary,
    updatedAt: DEMO_TIMESTAMP.recent,
    ...rest,
  };
}

function makeWake(
  input: Partial<ServerAgentsVxappSidebarWake> &
    Pick<ServerAgentsVxappSidebarWake, "orchestratorThreadId" | "state" | "wakeId">,
): ServerAgentsVxappSidebarWake {
  const { orchestratorThreadId, state, wakeId, ...rest } = input;
  return {
    createdAt: DEMO_TIMESTAMP.recent,
    orchestratorThreadId,
    payload: null,
    programId: null,
    reason: null,
    settledAt: null,
    state,
    updatedAt: DEMO_TIMESTAMP.recent,
    wakeId,
    ...rest,
  };
}

function makeAgentRuntimeSnapshot(input: {
  agentKind: AgentRuntimeAgentKind;
  generatedAt?: string | null;
  installedSkills?: readonly string[];
  packCount?: number;
  profile?: string | null;
  repo?: string | null;
  role?: string | null;
  selectedPacks?: readonly string[];
  skillCount?: number;
  threadId: string;
  workspaceRoot?: string | null;
}): ServerGetAgentRuntimeSnapshotResult {
  return {
    agentKind: input.agentKind,
    availability: "inspectable",
    reasonCode: null,
    roleDetails: {
      selectionReason: `Demo ${input.agentKind} runtime profile selected for sidebar preview.`,
    },
    runtimeDir: input.workspaceRoot ? `${input.workspaceRoot}/.agents/runtime` : "/demo/runtime",
    runtimeKind: "agent-contract",
    sourceFiles: [
      {
        absolutePath: "/demo/runtime/profile.json",
        detail: null,
        fileName: "profile.json",
        key: "profile",
        label: "Profile",
        status: "loaded",
      },
      {
        absolutePath: "/demo/runtime/selection.json",
        detail: null,
        fileName: "selection.json",
        key: "selection",
        label: "Selection",
        status: "loaded",
      },
    ],
    summary: {
      closeoutAuthority: "code_tests",
      contextMode: "isolated",
      generatedAt: input.generatedAt ?? DEMO_TIMESTAMP.now,
      installedSkills: [...(input.installedSkills ?? ["owner-backed-sidebar", "runtime-preview"])],
      packCount: input.packCount ?? 4,
      profile: input.profile ?? "standard",
      repo: input.repo ?? "t3code-vxapp",
      role: input.role ?? input.agentKind,
      selectedPacks: [...(input.selectedPacks ?? ["000-safety-kernel", "001-t3-worker-basics"])],
      skillCount: input.skillCount ?? 2,
      taskClass: "implementation",
    },
    threadId: ThreadId.makeUnsafe(input.threadId),
    workerDetails: null,
    workspaceResolution: {
      detail: "Demo runtime snapshot pinned to the sidebar fixture.",
      kind: "demo-fixture",
    },
    workspaceRoot: input.workspaceRoot ?? "/demo/workspace",
  };
}

function makeWorkerRuntimeSnapshot(input: {
  fixtureId: PreviewWorkerRuntimeFixtureId;
  threadId: string;
  workspace: string;
}): ServerGetWorkerRuntimeSnapshotResult {
  const fixture = resolvePreviewWorkerRuntimeSnapshot(input.fixtureId);
  if (!fixture) {
    throw new Error(`Missing demo worker runtime fixture: ${input.fixtureId}`);
  }
  return {
    agentKind: "worker",
    audit: {
      agentsSkillsDir: `${input.workspace}/.agents/skills`,
      closeoutAuthority: fixture.closeoutAuthority ?? "code_tests",
      contextMode: fixture.contextMode ?? "isolated",
      instructionStackStatus: fixture.auditStatus,
      issues: fixture.auditFindings.map((finding) => ({
        code: finding.code,
        detail: finding.detail,
        evidence: undefined,
        kind: finding.kind,
        path: null,
        runtimeFile: "instruction-stack-audit.json",
        severity: finding.severity,
        slug: null,
        sourceCode: null,
      })),
      packAuditStatus: fixture.packAuditStatus ?? fixture.auditStatus,
      repo: fixture.repo ?? "demo-repo",
      runtimeDir: `${input.workspace}/.agents/runtime`,
      schema_version: "1.0.0",
      skillsDir: `${input.workspace}/.claude/skills`,
      status: fixture.auditStatus,
      taskClass: fixture.taskClass ?? "implementation",
      workspace: input.workspace,
    },
    availability: "inspectable",
    contextPlan: {
      agentsSkillsDir: `${input.workspace}/.agents/skills`,
      allowedCapabilities: [...fixture.allowedCapabilities],
      closeoutAuthority: fixture.closeoutAuthority ?? "code_tests",
      conflicts: [...fixture.conflicts],
      contextMode: fixture.contextMode ?? "isolated",
      forbiddenCapabilities: [...fixture.forbiddenCapabilities],
      generatedSkillsPath: null,
      legacyGlobalSkills: false,
      localVx: {},
      modelPolicy: {},
      modelPolicyPath: null,
      repo: fixture.repo ?? "demo-repo",
      repoClaude: null,
      repoPackRoot: null,
      runtimeDir: `${input.workspace}/.agents/runtime`,
      runtimeProfilePath: null,
      schema_version: "1.0.0",
      selectedPacks: [...fixture.selectedPacks],
      skillsDir: `${input.workspace}/.claude/skills`,
      taskClass: fixture.taskClass ?? "implementation",
      validationProfile: fixture.validationProfile,
      warnings: [...fixture.warnings],
      workspace: input.workspace,
      worktreePath: input.workspace,
    },
    dispatchContract: {
      allowedCapabilities: [...fixture.allowedCapabilities],
      closeoutAuthority: fixture.closeoutAuthority ?? "code_tests",
      conflicts: [...fixture.conflicts],
      contextMode: fixture.contextMode ?? "isolated",
      forbiddenCapabilities: [...fixture.forbiddenCapabilities],
      repo: fixture.repo ?? "demo-repo",
      runtimeFiles: {},
      schema_version: "1.0.0",
      selectedPacks: [...fixture.selectedPacks],
      taskClass: fixture.taskClass ?? "implementation",
      validationProfile: fixture.validationProfile,
      warnings: [...fixture.warnings],
      workspace: input.workspace,
    },
    findings: fixture.auditFindings.map((finding) => ({
      code: finding.code,
      detail: finding.detail,
      evidence: undefined,
      kind: finding.kind,
      path: null,
      runtimeFile: null,
      severity: finding.severity,
      slug: null,
      sourceCode: null,
    })),
    instructionStack: {
      closeoutAuthority: fixture.closeoutAuthority ?? "",
      contextMode: fixture.contextMode ?? "",
      findings: fixture.auditFindings.map((finding) => ({
        code: finding.code,
        detail: finding.detail,
        evidence: undefined,
        kind: finding.kind,
        path: null,
        runtimeFile: null,
        severity: finding.severity,
        slug: null,
        sourceCode: null,
      })),
      packAudit: {
        issues: Array.from({ length: fixture.packAuditIssueCount }, () => ({})),
        status: fixture.packAuditStatus,
      },
      repo: fixture.repo ?? "demo-repo",
      schema_version: "1.0.0",
      status: fixture.auditStatus,
      taskClass: fixture.taskClass ?? "",
      workspace: input.workspace,
    },
    installedPacks: {
      agentsSkillsDir: `${input.workspace}/.agents/skills`,
      closeoutAuthority: fixture.closeoutAuthority ?? "code_tests",
      contextMode: fixture.contextMode ?? "isolated",
      packs: fixture.packs.map((pack) => ({
        id: pack.id,
        link: `${input.workspace}/.agents/runtime/packs/${pack.slug}`,
        manifest: {
          defaultContextModes: pack.defaultContextModes,
          description: pack.description,
          forbids: pack.forbids,
          grants: pack.grants,
          mountMode: pack.mountMode,
          name: pack.name,
          repo: pack.repo,
          requires: pack.requires,
          scope: pack.scope,
          type: pack.type,
          version: pack.version,
        },
        slug: pack.slug,
      })),
      repo: fixture.repo ?? "demo-repo",
      runtimeDir: `${input.workspace}/.agents/runtime`,
      schema_version: "1.0.0",
      skillsDir: `${input.workspace}/.claude/skills`,
      taskClass: fixture.taskClass ?? "implementation",
      workspace: input.workspace,
    },
    issues: [],
    reasonCode: null,
    runtimeDir: `${input.workspace}/.agents/runtime`,
    runtimeKind: "worker-contract",
    runtimeRoot: `${input.workspace}/.agents`,
    sourceFiles: {
      contextPlan: {
        failureCode: null,
        failureMessage: null,
        status: fixture.sourceFiles.contextPlan.status,
      },
      dispatchContract: {
        failureCode: null,
        failureMessage: null,
        status: fixture.sourceFiles.dispatchContract.status,
      },
      installedPacks: {
        failureCode: null,
        failureMessage: null,
        status: fixture.sourceFiles.installedPacks.status,
      },
    },
    stateRoot: input.workspace,
    threadId: ThreadId.makeUnsafe(input.threadId),
    workspace: input.workspace,
    workspaceResolution: "thread-worktree",
  };
}

const PROJECTS: Project[] = [
  makeProject({
    cwd: "/demo/executive/foundry",
    id: ProjectId.makeUnsafe("demo-project-exec-foundry"),
    name: "Foundry Executive",
  }),
  makeProject({
    cwd: "/demo/executive/expansion",
    id: ProjectId.makeUnsafe("demo-project-exec-expansion"),
    name: "Expansion Executive",
  }),
  makeProject({
    cwd: "/demo/repos/payments-api",
    id: ProjectId.makeUnsafe("demo-project-payments-api"),
    name: "payments-api",
  }),
  makeProject({
    cwd: "/demo/repos/web-app",
    id: ProjectId.makeUnsafe("demo-project-web-app"),
    name: "web-app",
  }),
  makeProject({
    cwd: "/demo/repos/mobile-app",
    id: ProjectId.makeUnsafe("demo-project-mobile-app"),
    name: "mobile-app",
  }),
  makeProject({
    cwd: "/demo/repos/scripts",
    id: ProjectId.makeUnsafe("demo-project-scripts"),
    name: "scripts",
  }),
];

const THREADS: Thread[] = [
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: DEMO_TIMESTAMP.now,
      startedAt: DEMO_TIMESTAMP.now,
      state: "running",
      turnId: "demo-turn-exec-foundry" as any,
    } as any,
    projectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    title: "CTO / Foundry",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-exec-expansion"),
    projectId: ProjectId.makeUnsafe("demo-project-exec-expansion"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "ready",
      updatedAt: DEMO_TIMESTAMP.recent,
    } as any,
    title: "CTO / Expansion",
    updatedAt: DEMO_TIMESTAMP.recent,
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-orch-payments"),
    programId: "demo-program-checkout-hardening",
    projectId: ProjectId.makeUnsafe("demo-project-payments-api"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    spawnRole: "orchestrator",
    title: "orchestrator/jasper Checkout risk hardening",
    updatedAt: DEMO_TIMESTAMP.now,
    worktreePath: "/demo/worktrees/orch-payments",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-worker-auth"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: DEMO_TIMESTAMP.recent,
      startedAt: DEMO_TIMESTAMP.recent,
      state: "running",
      turnId: "demo-turn-worker-auth" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-payments",
    programId: "demo-program-checkout-hardening",
    projectId: ProjectId.makeUnsafe("demo-project-payments-api"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "running",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    spawnRole: "worker",
    title: "worker/ket Repair OAuth callback regression",
    updatedAt: DEMO_TIMESTAMP.now,
    worktreePath: "/demo/worktrees/worker-auth",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-worker-audit"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: DEMO_TIMESTAMP.recent,
      startedAt: null,
      state: "queued",
      turnId: "demo-turn-worker-audit" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-payments",
    programId: "demo-program-checkout-hardening",
    projectId: ProjectId.makeUnsafe("demo-project-scripts"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "queued",
      provider: "codex",
      status: "connecting",
      updatedAt: DEMO_TIMESTAMP.recent,
    } as any,
    spawnRole: "worker",
    title: "worker/jono Verify deploy audit coverage",
    updatedAt: DEMO_TIMESTAMP.recent,
    worktreePath: "/demo/worktrees/worker-audit",
  }),
  makeThread({
    activeError: "Owner runtime files are missing for the generated worktree bundle.",
    error: "Owner runtime files are missing for the generated worktree bundle.",
    hasActiveError: true,
    historicalError: "Owner runtime files are missing for the generated worktree bundle.",
    id: ThreadId.makeUnsafe("demo-thread-worker-payments-tests"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: DEMO_TIMESTAMP.recent,
      requestedAt: DEMO_TIMESTAMP.earlier,
      startedAt: DEMO_TIMESTAMP.earlier,
      state: "interrupted",
      turnId: "demo-turn-worker-tests" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-payments",
    programId: "demo-program-checkout-hardening",
    projectId: ProjectId.makeUnsafe("demo-project-payments-api"),
    spawnRole: "worker",
    title: "worker/ava Stabilize checkout tests",
    updatedAt: DEMO_TIMESTAMP.recent,
    worktreePath: "/demo/worktrees/worker-payments-tests",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-orch-dashboard"),
    programId: "demo-program-revenue-dashboard",
    projectId: ProjectId.makeUnsafe("demo-project-web-app"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "ready",
      updatedAt: DEMO_TIMESTAMP.recent,
    } as any,
    spawnRole: "orchestrator",
    title: "orchestrator/ket Revenue dashboard polish",
    updatedAt: DEMO_TIMESTAMP.recent,
    worktreePath: "/demo/worktrees/orch-dashboard",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-worker-charts"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: DEMO_TIMESTAMP.recent,
      requestedAt: DEMO_TIMESTAMP.earlier,
      startedAt: DEMO_TIMESTAMP.earlier,
      state: "completed",
      turnId: "demo-turn-worker-charts" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-dashboard",
    programId: "demo-program-revenue-dashboard",
    projectId: ProjectId.makeUnsafe("demo-project-web-app"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "ready",
      updatedAt: DEMO_TIMESTAMP.recent,
    } as any,
    spawnRole: "worker",
    title: "worker/max Rebuild chart annotations",
    updatedAt: DEMO_TIMESTAMP.recent,
    worktreePath: "/demo/worktrees/worker-charts",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-worker-copy"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: DEMO_TIMESTAMP.recent,
      startedAt: DEMO_TIMESTAMP.recent,
      state: "running",
      turnId: "demo-turn-worker-copy" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-dashboard",
    programId: "demo-program-revenue-dashboard",
    projectId: ProjectId.makeUnsafe("demo-project-web-app"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "running",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    spawnRole: "worker",
    title: "worker/ivy Tighten executive summary copy",
    updatedAt: DEMO_TIMESTAMP.now,
    worktreePath: "/demo/worktrees/worker-copy",
  }),
  makeThread({
    archivedAt: DEMO_TIMESTAMP.archived,
    id: ThreadId.makeUnsafe("demo-thread-orch-mobile-archive"),
    programId: "demo-program-mobile-followthrough",
    projectId: ProjectId.makeUnsafe("demo-project-mobile-app"),
    spawnRole: "orchestrator",
    title: "orchestrator/jasper Booking followthrough push",
    updatedAt: DEMO_TIMESTAMP.archived,
    worktreePath: "/demo/worktrees/orch-mobile-archive",
  }),
  makeThread({
    archivedAt: DEMO_TIMESTAMP.archived,
    id: ThreadId.makeUnsafe("demo-thread-worker-mobile-fixes"),
    orchestratorThreadId: "demo-thread-orch-mobile-archive",
    programId: "demo-program-mobile-followthrough",
    projectId: ProjectId.makeUnsafe("demo-project-mobile-app"),
    spawnRole: "worker",
    title: "worker/sam Finalize iOS booking fixes",
    updatedAt: DEMO_TIMESTAMP.archived,
    worktreePath: "/demo/worktrees/worker-mobile-fixes",
  }),
  makeThread({
    archivedAt: DEMO_TIMESTAMP.archived,
    id: ThreadId.makeUnsafe("demo-thread-worker-mobile-qa"),
    orchestratorThreadId: "demo-thread-orch-mobile-archive",
    programId: "demo-program-mobile-followthrough",
    projectId: ProjectId.makeUnsafe("demo-project-mobile-app"),
    spawnRole: "worker",
    title: "worker/lee Record final regression pass",
    updatedAt: DEMO_TIMESTAMP.archived,
    worktreePath: "/demo/worktrees/worker-mobile-qa",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-orch-ledger"),
    programId: "demo-program-ledger-release",
    projectId: ProjectId.makeUnsafe("demo-project-payments-api"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "attached",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    spawnRole: "orchestrator",
    title: "orchestrator/ava Ledger release train",
    updatedAt: DEMO_TIMESTAMP.now,
    worktreePath: "/demo/worktrees/orch-ledger",
  }),
  makeThread({
    id: ThreadId.makeUnsafe("demo-thread-worker-ledger-review"),
    latestTurn: {
      assistantMessageId: null,
      completedAt: null,
      requestedAt: DEMO_TIMESTAMP.now,
      startedAt: DEMO_TIMESTAMP.now,
      state: "running",
      turnId: "demo-turn-worker-ledger-review" as any,
    } as any,
    orchestratorThreadId: "demo-thread-orch-ledger",
    programId: "demo-program-ledger-release",
    projectId: ProjectId.makeUnsafe("demo-project-payments-api"),
    session: {
      createdAt: DEMO_TIMESTAMP.older,
      orchestrationStatus: "running",
      provider: "codex",
      status: "running",
      updatedAt: DEMO_TIMESTAMP.now,
    } as any,
    spawnRole: "worker",
    title: "worker/rae Audit ledger closeout package",
    updatedAt: DEMO_TIMESTAMP.now,
    worktreePath: "/demo/worktrees/worker-ledger-review",
  }),
];

const PROGRAMS: ServerAgentsVxappProgramSnapshot[] = [
  makeProgram({
    closeout: {
      closeout: { lastVerdict: "needs_attention" },
      scope: {
        declaredRepos: ["payments-api", "scripts"],
        repoLaneContracts: [{ repo: "payments-api" }, { repo: "scripts" }],
      },
      summary: {
        missingItems: ["full regression rerun", "final executive signoff"],
      },
    },
    currentOrchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-payments"),
    currentStatus: "worker_execution",
    executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
    executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
    id: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
    metadata: {
      display: {
        heading: "Checkout Hardening",
        label: "In flight",
        sortKey: "001",
        summary: "Hardening checkout auth, deploy audits, and flaky test coverage.",
        tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-0",
      },
    },
    objective: "Stabilize checkout risk controls before the release candidate cut.",
    status: "active",
    title: "Checkout hardening",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
  makeProgram({
    closeout: {
      closeout: { lastVerdict: "ready" },
      scope: {
        declaredRepos: ["web-app"],
        repoLaneContracts: [{ repo: "web-app" }],
      },
    },
    currentOrchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-dashboard"),
    currentStatus: "founder_review_ready",
    executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
    executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
    id: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
    metadata: {
      display: {
        heading: "Revenue Dashboard",
        label: "Founder review ready",
        sortKey: "002",
        summary: "Charts are rebuilt and copy polish is landing behind a preview flag.",
        tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-0",
      },
    },
    objective: "Polish the executive dashboard for founder walkthrough.",
    status: "active",
    title: "Revenue dashboard polish",
    updatedAt: DEMO_TIMESTAMP.recent,
  }),
  makeProgram({
    closeout: {
      closeout: { lastVerdict: "ready" },
      scope: {
        declaredRepos: ["mobile-app"],
        repoLaneContracts: [{ repo: "mobile-app" }],
      },
    },
    currentOrchestratorThreadId: null,
    currentStatus: "waiting_followthrough",
    executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-expansion"),
    executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-expansion"),
    id: ProgramId.makeUnsafe("demo-program-mobile-followthrough"),
    metadata: {
      display: {
        heading: "Mobile Booking Followthrough",
        label: "Awaiting relaunch",
        sortKey: "003",
        summary: "Active lane is closed, but the archived followthrough remains visible below.",
        tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-0",
      },
    },
    objective: "Hold the mobile fixes ready for the relaunch window.",
    status: "active",
    title: "Mobile booking followthrough",
    updatedAt: DEMO_TIMESTAMP.older,
  }),
  makeProgram({
    closeout: {
      closeout: { lastVerdict: "needs_attention" },
      scope: {
        declaredRepos: ["payments-api"],
        repoLaneContracts: [{ repo: "payments-api" }],
      },
    },
    currentOrchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-ledger"),
    currentStatus: "release_train",
    executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-expansion"),
    executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-expansion"),
    id: ProgramId.makeUnsafe("demo-program-ledger-release"),
    metadata: {
      display: {
        heading: "Ledger Release Train",
        label: "High focus",
        sortKey: "004",
        summary: "Audit-heavy release lane with watch classification and closeout pressure.",
        tone: "bg-red-500/12 text-red-700 dark:text-red-300 border-0",
      },
    },
    objective: "Prepare the ledger services release train and closeout package.",
    status: "blocked",
    title: "Ledger release train",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
];

const TODOS: ServerAgentsVxappTodoSnapshot[] = [
  makeTodo({
    agent: "ket",
    nextAction: "Replay the OAuth callback path against the release config.",
    notes: ["Auth redirect still diverges in the release environment."],
    planLinks: [
      {
        linkedAt: DEMO_TIMESTAMP.recent,
        phase: "Phase 2",
        planKey: "PLAN_checkout-risk-hardening",
        repo: "payments-api",
        step: "Replay auth flow",
      },
    ],
    priority: "high",
    programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
    status: "in_progress",
    summary: "Trace the release redirect mismatch and produce the fix patch.",
    title: "Repair OAuth callback regression",
    todoId: "todo-checkout-auth",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
  makeTodo({
    agent: "jono",
    nextAction: "Confirm the deploy audit contract against the latest worker runtime bundle.",
    priority: "normal",
    programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
    status: "ready",
    summary: "Audit deploy readiness and callback wake semantics.",
    title: "Verify deploy audit coverage",
    todoId: "todo-checkout-audit",
  }),
  makeTodo({
    agent: "ava",
    nextAction: "Re-run interrupted coverage suites after the auth patch lands.",
    priority: "high",
    programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
    status: "blocked",
    summary: "Regression suite is interrupted on flaky checkout tests.",
    title: "Stabilize checkout tests",
    todoId: "todo-checkout-tests",
  }),
  makeTodo({
    agent: "ivy",
    nextAction: "Finalize KPI summary language and attach before/after screenshots.",
    priority: "normal",
    programId: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
    status: "in_progress",
    summary: "Polish the executive summary panel copy for founder review.",
    title: "Tighten executive summary copy",
    todoId: "todo-dashboard-copy",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
  makeTodo({
    agent: "sam",
    nextAction: "Keep archived notes ready for the relaunch lane handoff.",
    priority: "normal",
    programId: ProgramId.makeUnsafe("demo-program-mobile-followthrough"),
    status: "done",
    summary: "Historical record for the completed mobile remediation lane.",
    title: "Finalize iOS booking fixes",
    todoId: "todo-mobile-fixes",
    updatedAt: DEMO_TIMESTAMP.archived,
  }),
  makeTodo({
    agent: "rae",
    nextAction: "Assemble the audit bundle and open the final review checklist.",
    priority: "high",
    programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
    status: "in_progress",
    summary: "Closeout package needs audit evidence and release gating updates.",
    title: "Audit ledger closeout package",
    todoId: "todo-ledger-audit",
    updatedAt: DEMO_TIMESTAMP.now,
  }),
];

const CURRENT_TODOS: ServerAgentsVxappCurrentTodoProjection[] = [
  {
    agent: "ket",
    ambiguity: null,
    createdAt: DEMO_TIMESTAMP.older,
    programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
    todoId: "todo-checkout-auth",
    updatedAt: DEMO_TIMESTAMP.now,
  },
  {
    agent: "ivy",
    ambiguity: null,
    createdAt: DEMO_TIMESTAMP.older,
    programId: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
    todoId: "todo-dashboard-copy",
    updatedAt: DEMO_TIMESTAMP.now,
  },
  {
    agent: "rae",
    ambiguity: null,
    createdAt: DEMO_TIMESTAMP.older,
    programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
    todoId: "todo-ledger-audit",
    updatedAt: DEMO_TIMESTAMP.now,
  },
];

const WATCH_PROJECTIONS: Record<string, ServerAgentsVxappSidebarWatchProjection> = {
  "demo-program-revenue-dashboard": {
    classification: "watch:founder-review",
    enabled: true,
    lastEvaluatedAt: DEMO_TIMESTAMP.recent,
    metadata: null,
    programId: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
    reason: "Founder review is scheduled after final copy lands.",
    signature: "watch:founder-review",
    suppression: null,
    updatedAt: DEMO_TIMESTAMP.recent,
  },
  "demo-program-ledger-release": {
    classification: "watch:risk-escalated",
    enabled: true,
    lastEvaluatedAt: DEMO_TIMESTAMP.now,
    metadata: null,
    programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
    reason: "Audit and closeout gating are both unresolved.",
    signature: "watch:risk-escalated",
    suppression: null,
    updatedAt: DEMO_TIMESTAMP.now,
  },
};

const NOTIFICATIONS: Record<string, ServerAgentsVxappSidebarProgramNotification[]> = {
  "demo-program-checkout-hardening": [
    makeNotification({
      executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
      executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
      kind: "worker_progress",
      notificationId: "notification-checkout-progress",
      orchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-payments"),
      programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
      severity: "info",
      summary: "Auth remediation worker is still running against the release callback path.",
    }),
  ],
  "demo-program-revenue-dashboard": [
    makeNotification({
      executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
      executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
      kind: "milestone_completed",
      notificationId: "notification-dashboard-milestone",
      orchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-dashboard"),
      programId: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
      severity: "success",
      summary: "Dashboard layout milestone completed; founder review lane is open.",
      state: "delivering",
    }),
  ],
  "demo-program-ledger-release": [
    makeNotification({
      executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-expansion"),
      executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-expansion"),
      kind: "risk_escalated",
      notificationId: "notification-ledger-risk",
      orchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-ledger"),
      programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
      queuedAt: DEMO_TIMESTAMP.now,
      severity: "warning",
      summary: "Ledger release train needs executive review before final closeout.",
    }),
  ],
};

const ATTENTION_ITEMS: Record<string, ServerAgentsVxappSidebarAttentionItem[]> = {
  "demo-program-checkout-hardening": [
    makeAttention({
      attentionId: "attention-checkout-tests",
      executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-foundry"),
      executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-foundry"),
      kind: "blocked",
      programId: ProgramId.makeUnsafe("demo-program-checkout-hardening"),
      severity: "warning",
      sourceRole: "worker",
      sourceThreadId: ThreadId.makeUnsafe("demo-thread-worker-payments-tests"),
      summary: "Interrupted test stabilization lane still needs a rerun.",
    }),
  ],
  "demo-program-ledger-release": [
    makeAttention({
      attentionId: "attention-ledger-review",
      executiveProjectId: ProjectId.makeUnsafe("demo-project-exec-expansion"),
      executiveThreadId: ThreadId.makeUnsafe("demo-thread-exec-expansion"),
      kind: "final_review_ready",
      programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
      queuedAt: DEMO_TIMESTAMP.now,
      severity: "critical",
      sourceRole: "orchestrator",
      sourceThreadId: ThreadId.makeUnsafe("demo-thread-orch-ledger"),
      summary: "Closeout package is waiting on executive approval.",
    }),
  ],
};

const WAKES: Record<string, ServerAgentsVxappSidebarWake[]> = {
  "demo-program-revenue-dashboard": [
    makeWake({
      orchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-dashboard"),
      payload: { workerThreadId: "demo-thread-worker-copy" },
      programId: ProgramId.makeUnsafe("demo-program-revenue-dashboard"),
      state: "pending",
      wakeId: "wake-dashboard-copy",
    }),
  ],
  "demo-program-ledger-release": [
    makeWake({
      orchestratorThreadId: ThreadId.makeUnsafe("demo-thread-orch-ledger"),
      payload: { workerThreadId: "demo-thread-worker-ledger-review" },
      programId: ProgramId.makeUnsafe("demo-program-ledger-release"),
      state: "delivering",
      wakeId: "wake-ledger-review",
    }),
  ],
};

function buildProgramCard(
  program: ServerAgentsVxappProgramSnapshot,
): ServerAgentsVxappSidebarAuthorityProgramCard {
  const todos = TODOS.filter((todo) => todo.programId === program.id);
  const currentTodo = CURRENT_TODOS.find((todo) => todo.programId === program.id);
  const workerTargetsByProgramId: Record<string, AgentsVxappSidebarAuthorityRuntimeTarget[]> = {
    "demo-program-checkout-hardening": [
      makeRuntimeTarget({
        agentKind: "worker",
        displayLabel: "payments-api",
        threadId: "demo-thread-worker-auth",
        workspace: "/demo/worktrees/worker-auth",
      }),
      makeRuntimeTarget({
        agentKind: "worker",
        displayLabel: "scripts",
        threadId: "demo-thread-worker-audit",
        workspace: "/demo/worktrees/worker-audit",
      }),
      makeRuntimeTarget({
        agentKind: "worker",
        availability: "unavailable",
        displayLabel: "payments-api",
        reasonCode: "runtime_files_missing",
        threadId: "demo-thread-worker-payments-tests",
        workspace: "/demo/worktrees/worker-payments-tests",
      }),
    ],
    "demo-program-revenue-dashboard": [
      makeRuntimeTarget({
        agentKind: "worker",
        displayLabel: "web-app",
        threadId: "demo-thread-worker-charts",
        workspace: "/demo/worktrees/worker-charts",
      }),
      makeRuntimeTarget({
        agentKind: "worker",
        availability: "degraded",
        displayLabel: "web-app",
        reasonCode: "runtime_payload_invalid",
        threadId: "demo-thread-worker-copy",
        workspace: "/demo/worktrees/worker-copy",
      }),
    ],
    "demo-program-ledger-release": [
      makeRuntimeTarget({
        agentKind: "worker",
        displayLabel: "payments-api",
        threadId: "demo-thread-worker-ledger-review",
        workspace: "/demo/worktrees/worker-ledger-review",
      }),
    ],
  };

  return {
    activeAllocations: [],
    attentionItems: ATTENTION_ITEMS[program.id] ?? [],
    currentTodo: currentTodo
      ? (todos.find((todo) => todo.todoId === currentTodo.todoId) ?? null)
      : null,
    display:
      (
        program.metadata as {
          display?: ServerAgentsVxappSidebarAuthorityProgramCard["display"];
        } | null
      )?.display ?? null,
    executive:
      program.executiveThreadId === null
        ? null
        : makeRuntimeTarget({
            agentKind: "executive",
            availability:
              program.executiveThreadId === "demo-thread-exec-expansion"
                ? "degraded"
                : "inspectable",
            displayLabel:
              program.executiveThreadId === "demo-thread-exec-expansion"
                ? "Expansion Executive"
                : "Foundry Executive",
            reasonCode:
              program.executiveThreadId === "demo-thread-exec-expansion"
                ? "runtime_authority_missing"
                : null,
            threadId: program.executiveThreadId,
            workspace:
              program.executiveThreadId === "demo-thread-exec-expansion"
                ? "/demo/executive/expansion"
                : "/demo/executive/foundry",
          }),
    notifications: NOTIFICATIONS[program.id] ?? [],
    openWakes: WAKES[program.id] ?? [],
    orchestrator:
      program.currentOrchestratorThreadId === null
        ? null
        : makeRuntimeTarget({
            agentKind: "orchestrator",
            displayLabel: program.title,
            threadId: program.currentOrchestratorThreadId,
            workspace: `/demo/worktrees/${program.currentOrchestratorThreadId}`,
          }),
    ownerDiagnostics: [],
    program,
    watchProjection: WATCH_PROJECTIONS[program.id] ?? null,
    workers: workerTargetsByProgramId[program.id] ?? [],
  };
}

const PROGRAM_CARDS = PROGRAMS.map(buildProgramCard);

const AUTHORITY_SNAPSHOT: ServerGetAgentsVxappSidebarAuthoritySnapshotResult = {
  currentTodos: CURRENT_TODOS,
  hints: [],
  ownerDiagnostics: [],
  pagination: {
    hasMore: false,
    limit: 20,
    page: 1,
    total: PROGRAMS.length,
  } satisfies ServerAgentsVxappPagination,
  programs: PROGRAM_CARDS,
  todos: TODOS,
};

const AGENT_RUNTIME_SNAPSHOTS = new Map<string, ServerGetAgentRuntimeSnapshotResult>([
  [
    "executive:demo-thread-exec-foundry",
    makeAgentRuntimeSnapshot({
      agentKind: "executive",
      generatedAt: DEMO_TIMESTAMP.now,
      profile: "executive-ops",
      role: "cto",
      threadId: "demo-thread-exec-foundry",
      workspaceRoot: "/demo/executive/foundry",
    }),
  ],
  [
    "orchestrator:demo-thread-orch-payments",
    makeAgentRuntimeSnapshot({
      agentKind: "orchestrator",
      generatedAt: DEMO_TIMESTAMP.now,
      packCount: 6,
      profile: "payments-hardening",
      role: "jasper",
      selectedPacks: ["000-safety-kernel", "110-api-plan-execution", "118-api-blocker-reporting"],
      threadId: "demo-thread-orch-payments",
      workspaceRoot: "/demo/worktrees/orch-payments",
    }),
  ],
  [
    "orchestrator:demo-thread-orch-dashboard",
    makeAgentRuntimeSnapshot({
      agentKind: "orchestrator",
      generatedAt: DEMO_TIMESTAMP.recent,
      packCount: 5,
      profile: "founder-review",
      role: "ket",
      selectedPacks: ["000-safety-kernel", "110-vue-plan-execution"],
      threadId: "demo-thread-orch-dashboard",
      workspaceRoot: "/demo/worktrees/orch-dashboard",
    }),
  ],
  [
    "orchestrator:demo-thread-orch-ledger",
    makeAgentRuntimeSnapshot({
      agentKind: "orchestrator",
      generatedAt: DEMO_TIMESTAMP.now,
      packCount: 7,
      profile: "release-train",
      role: "ava",
      selectedPacks: ["000-safety-kernel", "141-api-commit-closeout", "130-api-review"],
      skillCount: 3,
      threadId: "demo-thread-orch-ledger",
      workspaceRoot: "/demo/worktrees/orch-ledger",
    }),
  ],
]);

const WORKER_RUNTIME_SNAPSHOTS = new Map<string, ServerGetWorkerRuntimeSnapshotResult>([
  [
    "demo-thread-worker-auth",
    makeWorkerRuntimeSnapshot({
      fixtureId: "api-services-ledger-hardening-r1",
      threadId: "demo-thread-worker-auth",
      workspace: "/demo/worktrees/worker-auth",
    }),
  ],
  [
    "demo-thread-worker-audit",
    makeWorkerRuntimeSnapshot({
      fixtureId: "stores-managed-target-scripts-c1",
      threadId: "demo-thread-worker-audit",
      workspace: "/demo/worktrees/worker-audit",
    }),
  ],
  [
    "demo-thread-worker-charts",
    makeWorkerRuntimeSnapshot({
      fixtureId: "partymore-vue-order-create-admin-parity-r2",
      threadId: "demo-thread-worker-charts",
      workspace: "/demo/worktrees/worker-charts",
    }),
  ],
  [
    "demo-thread-worker-ledger-review",
    makeWorkerRuntimeSnapshot({
      fixtureId: "stores-managed-target-agents-c1",
      threadId: "demo-thread-worker-ledger-review",
      workspace: "/demo/worktrees/worker-ledger-review",
    }),
  ],
]);

export const ORCHESTRATION_SIDEBAR_DEMO_STATE = {
  authorityError: null as AgentsVxappOwnerBoundaryError | null,
  authoritySnapshot: AUTHORITY_SNAPSHOT,
  authorityStatus: "ready" as AgentsVxappOwnerLoadStatus,
  getAgentRuntimeSnapshot: (agentKind: AgentRuntimeAgentKind, threadId: string | null) =>
    threadId ? (AGENT_RUNTIME_SNAPSHOTS.get(`${agentKind}:${threadId}`) ?? null) : null,
  getWorkerRuntimeSnapshot: (threadId: string | null) =>
    threadId ? (WORKER_RUNTIME_SNAPSHOTS.get(threadId) ?? null) : null,
  isReadOnly: true,
  projects: PROJECTS,
  refreshSidebarAuthority: async () => undefined,
  threadLastVisitedAtById: {
    "demo-thread-exec-foundry": DEMO_TIMESTAMP.now,
    "demo-thread-worker-auth": DEMO_TIMESTAMP.now,
    "demo-thread-worker-copy": DEMO_TIMESTAMP.recent,
    "demo-thread-worker-ledger-review": DEMO_TIMESTAMP.now,
  } as Record<string, string>,
  threads: THREADS,
} as const;
