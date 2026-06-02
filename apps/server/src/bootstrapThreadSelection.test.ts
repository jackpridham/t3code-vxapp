import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  STARTUP_AUTHORITY_DISAGREEMENT_HINT,
  resolveStartupBootstrapSelection,
  resolveStartupBootstrapSelectionDetail,
} from "./bootstrapThreadSelection";

describe("resolveStartupBootstrapSelection", () => {
  it("returns no startup selection without owner authority for a linked CTO project", () => {
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
    ).toBeNull();
  });

  it("returns no startup selection without owner authority for a linked orchestrator project", () => {
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
    ).toBeNull();
  });

  it("does not fall back to a global CTO project without owner authority", () => {
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
    ).toBeNull();
  });

  it("does not select the most recently updated global special project without owner authority", () => {
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
    ).toBeNull();
  });

  it("does not fall back from an archived current session root to another local thread", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const staleThread = ThreadId.makeUnsafe("a084b92c-e863-4373-a728-b86c51305163");
    const freshThread = ThreadId.makeUnsafe("thread-cto-fresh");

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
            currentSessionRootThreadId: staleThread,
            deletedAt: null,
            updatedAt: "2026-04-24T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: staleThread,
            projectId: projectCto,
            archivedAt: "2026-04-24T00:02:00.000Z",
            deletedAt: null,
          },
          {
            id: freshThread,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toBeNull();
  });

  it("returns no selection when the only project thread is archived", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const staleThread = ThreadId.makeUnsafe("a084b92c-e863-4373-a728-b86c51305163");

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
            currentSessionRootThreadId: staleThread,
            deletedAt: null,
            updatedAt: "2026-04-24T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: staleThread,
            projectId: projectCto,
            archivedAt: "2026-04-24T00:02:00.000Z",
            deletedAt: null,
          },
        ],
      }),
    ).toBeNull();
  });

  it("uses owner executive authority when local CTO current root is stale", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const localThread = ThreadId.makeUnsafe("thread-cto-local");
    const ownerThread = ThreadId.makeUnsafe("thread-cto-owner");

    expect(
      resolveStartupBootstrapSelectionDetail({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "executive",
        programs: [
          {
            status: "active",
            executiveThreadId: ownerThread,
            currentOrchestratorThreadId: null,
            updatedAt: "2026-06-02T00:03:00.000Z",
            completedAt: null,
            deletedAt: null,
          },
        ],
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-06-02T00:00:00.000Z",
          },
          {
            id: projectCto,
            kind: "executive",
            sidebarParentProjectId: projectApp,
            currentSessionRootThreadId: localThread,
            deletedAt: null,
            updatedAt: "2026-06-02T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: localThread,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
          {
            id: ownerThread,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      })?.selection,
    ).toEqual({
      projectId: projectCto,
      threadId: ownerThread,
      authoritySource: "agents-vxapp-owner",
      startupContract: "external-role-authority-snapshot",
      diagnostic: {
        activeOwnerThreadId: ownerThread,
        localBootstrapThreadId: localThread,
        authoritySource: "agents-vxapp-owner",
        startupContract: "external-role-authority-snapshot",
        hint: STARTUP_AUTHORITY_DISAGREEMENT_HINT,
      },
    });
  });

  it("uses owner executive authority before a local bootstrap project exists", () => {
    const missingProjectApp = ProjectId.makeUnsafe("project-app-missing");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const ownerThread = ThreadId.makeUnsafe("thread-cto-owner");

    expect(
      resolveStartupBootstrapSelectionDetail({
        bootstrapProjectId: missingProjectApp,
        startupThreadTarget: "executive",
        programs: [
          {
            status: "active",
            executiveThreadId: ownerThread,
            currentOrchestratorThreadId: null,
            updatedAt: "2026-06-02T00:03:00.000Z",
            completedAt: null,
            deletedAt: null,
          },
        ],
        projects: [
          {
            id: projectCto,
            kind: "executive",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: ownerThread,
            deletedAt: null,
            updatedAt: "2026-06-02T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: ownerThread,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      })?.selection,
    ).toEqual({
      projectId: projectCto,
      threadId: ownerThread,
      authoritySource: "agents-vxapp-owner",
      startupContract: "external-role-authority-snapshot",
    });
  });

  it("fails closed when strict owner thread authority is unavailable", () => {
    const projectApp = ProjectId.makeUnsafe("project-app");
    const projectCto = ProjectId.makeUnsafe("project-cto");
    const localThread = ThreadId.makeUnsafe("thread-cto-local");
    const ownerThread = ThreadId.makeUnsafe("thread-cto-owner");

    expect(
      resolveStartupBootstrapSelectionDetail({
        bootstrapProjectId: projectApp,
        startupThreadTarget: "executive",
        programs: [
          {
            status: "active",
            executiveThreadId: ownerThread,
            currentOrchestratorThreadId: null,
            updatedAt: "2026-06-02T00:03:00.000Z",
            completedAt: null,
            deletedAt: null,
          },
        ],
        projects: [
          {
            id: projectApp,
            kind: "project",
            sidebarParentProjectId: undefined,
            currentSessionRootThreadId: undefined,
            deletedAt: null,
            updatedAt: "2026-06-02T00:00:00.000Z",
          },
          {
            id: projectCto,
            kind: "executive",
            sidebarParentProjectId: projectApp,
            currentSessionRootThreadId: localThread,
            deletedAt: null,
            updatedAt: "2026-06-02T00:01:00.000Z",
          },
        ],
        threads: [
          {
            id: localThread,
            projectId: projectCto,
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    ).toBeNull();
  });
});
