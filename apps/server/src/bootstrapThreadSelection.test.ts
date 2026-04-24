import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { resolveStartupBootstrapSelection } from "./bootstrapThreadSelection";

describe("resolveStartupBootstrapSelection", () => {
  it("prefers the active CTO session root for the linked workspace project", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const threadCtoOlder = ThreadId.makeUnsafe("thread-cto-older");
    const threadCtoActive = ThreadId.makeUnsafe("thread-cto-active");

    expect(
      resolveStartupBootstrapSelection({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "executive",
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
          {
            id: projectCto,
            kind: "executive",
            sidebarParentProjectId: projectApp,
            currentSessionRootThreadId: threadCtoActive,
            deletedAt: null,
            updatedAt: "2026-04-24T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: threadCtoOlder,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
          {
            id: threadCtoActive,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toEqual({
      projectId: projectCto,
      threadId: threadCtoActive,
    });
  });

  it("resolves the active orchestrator session for the linked workspace project", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectOrchestrator = ProjectId.makeUnsafe("project-orchestrator");
    const threadOrchestratorOlder = ThreadId.makeUnsafe("thread-orchestrator-older");
    const threadOrchestratorActive = ThreadId.makeUnsafe("thread-orchestrator-active");

    expect(
      resolveStartupBootstrapSelection({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "orchestrator",
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
          {
            id: projectOrchestrator,
            kind: "orchestrator",
            sidebarParentProjectId: projectApp,
            currentSessionRootThreadId: threadOrchestratorActive,
            deletedAt: null,
            updatedAt: "2026-04-24T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: threadOrchestratorOlder,
            projectId: projectOrchestrator,
            archivedAt: null,
            deletedAt: null,
          },
          {
            id: threadOrchestratorActive,
            projectId: projectOrchestrator,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toEqual({
      projectId: projectOrchestrator,
      threadId: threadOrchestratorActive,
    });
  });

  it("falls back to the global CTO project when no workspace-linked CTO exists", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto-global");
    const threadCto = ThreadId.makeUnsafe("thread-cto-global");

    expect(
      resolveStartupBootstrapSelection({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "executive",
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
          {
            id: projectCto,
            kind: "executive",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:05:00.000Z",
          },
        ],
        threads: [
          {
            id: threadCto,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toEqual({
      projectId: projectCto,
      threadId: threadCto,
    });
  });

  it("prefers the most recently updated global special project when multiple exist", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const olderOrchestrator = ProjectId.makeUnsafe("project-orchestrator-old");
    const newerOrchestrator = ProjectId.makeUnsafe("project-orchestrator-new");
    const olderThread = ThreadId.makeUnsafe("thread-orchestrator-old");
    const newerThread = ThreadId.makeUnsafe("thread-orchestrator-new");

    expect(
      resolveStartupBootstrapSelection({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "orchestrator",
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:00:00.000Z",
          },
          {
            id: olderOrchestrator,
            kind: "orchestrator",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-04-24T00:01:00.000Z",
          },
          {
            id: newerOrchestrator,
            kind: "orchestrator",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: newerThread,
            deletedAt: null,
            updatedAt: "2026-04-24T00:02:00.000Z",
          },
        ],
        threads: [
          {
            id: olderThread,
            projectId: olderOrchestrator,
            archivedAt: null,
            deletedAt: null,
          },
          {
            id: newerThread,
            projectId: newerOrchestrator,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toEqual({
      projectId: newerOrchestrator,
      threadId: newerThread,
    });
  });
});
