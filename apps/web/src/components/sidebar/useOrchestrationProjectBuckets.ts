import type { GitResolveRepoIdentityResult, ProjectId } from "@t3tools/contracts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { gitResolveRepoIdentityQueryOptions } from "../../lib/gitReactQuery";
import {
  resolveConfiguredProjectBuckets,
  type OrchestrationModeConfiguredProjectBuckets,
} from "../../lib/orchestrationMode";
import type { Project } from "../../types";
import { resolveSidebarProjectKind } from "../Sidebar.logic";

type SidebarProjectBucketProject = Pick<
  Project,
  "id" | "name" | "cwd" | "kind" | "sidebarParentProjectId"
>;

type RepoIdentity = Pick<
  GitResolveRepoIdentityResult,
  "isRepo" | "commonGitDir" | "worktreeRoot" | "isMainWorktree"
>;

function createUngroupedProjectBuckets(
  projects: readonly Pick<Project, "id">[],
): OrchestrationModeConfiguredProjectBuckets {
  return {
    bucketProjectIdByProjectId: new Map(projects.map((project) => [project.id, project.id])),
    visibleProjectIds: new Set(projects.map((project) => project.id)),
  };
}

export function resolveOrchestrationSidebarProjectBuckets(input: {
  projects: readonly Pick<Project, "id" | "name" | "cwd" | "sidebarParentProjectId">[];
  repoIdentityByProjectId: ReadonlyMap<ProjectId, RepoIdentity | null | undefined>;
  groupingEnabled: boolean;
}): OrchestrationModeConfiguredProjectBuckets {
  if (!input.groupingEnabled) {
    return createUngroupedProjectBuckets(input.projects);
  }

  return resolveConfiguredProjectBuckets({
    projects: input.projects,
    repoIdentityByProjectId: input.repoIdentityByProjectId,
  });
}

export function useOrchestrationProjectBuckets(input: {
  projects: readonly SidebarProjectBucketProject[];
  orchestratorProjectCwds: ReadonlySet<string> | readonly string[];
  orchestrationModeEnabled: boolean;
  groupWorktreesWithParentProject: boolean;
}) {
  const regularSidebarProjects = useMemo(
    () =>
      input.projects.filter(
        (project) =>
          resolveSidebarProjectKind({
            project,
            orchestratorProjectCwds: input.orchestratorProjectCwds,
          }) === "project",
      ),
    [input.orchestratorProjectCwds, input.projects],
  );
  const groupingEnabled = input.orchestrationModeEnabled && input.groupWorktreesWithParentProject;
  const repoIdentityQueryProjectTargets = useMemo(
    () =>
      groupingEnabled
        ? regularSidebarProjects.map((project) => ({ cwd: project.cwd, projectId: project.id }))
        : [],
    [groupingEnabled, regularSidebarProjects],
  );
  const repoIdentityQueryCwds = useMemo(
    () => [...new Set(repoIdentityQueryProjectTargets.map((target) => target.cwd))],
    [repoIdentityQueryProjectTargets],
  );
  const projectRepoIdentityQueries = useQueries({
    queries: repoIdentityQueryCwds.map((cwd) => gitResolveRepoIdentityQueryOptions(cwd)),
  });
  const repoIdentityByProjectId = useMemo(() => {
    const identitiesByCwd = new Map<string, (typeof projectRepoIdentityQueries)[number]["data"]>();
    for (const [index, cwd] of repoIdentityQueryCwds.entries()) {
      const repoIdentity = projectRepoIdentityQueries[index]?.data;
      if (repoIdentity) {
        identitiesByCwd.set(cwd, repoIdentity);
      }
    }

    const identitiesByProjectId = new Map<
      ProjectId,
      (typeof projectRepoIdentityQueries)[number]["data"]
    >();
    for (const target of repoIdentityQueryProjectTargets) {
      const repoIdentity = identitiesByCwd.get(target.cwd);
      if (repoIdentity) {
        identitiesByProjectId.set(target.projectId, repoIdentity);
      }
    }
    return identitiesByProjectId;
  }, [projectRepoIdentityQueries, repoIdentityQueryCwds, repoIdentityQueryProjectTargets]);
  const bucketResolution = useMemo(
    () =>
      resolveOrchestrationSidebarProjectBuckets({
        projects: regularSidebarProjects,
        repoIdentityByProjectId,
        groupingEnabled,
      }),
    [groupingEnabled, regularSidebarProjects, repoIdentityByProjectId],
  );

  return {
    regularSidebarProjects,
    bucketProjectIdByProjectId: bucketResolution.bucketProjectIdByProjectId,
    visibleRegularProjectIds: bucketResolution.visibleProjectIds,
  };
}
