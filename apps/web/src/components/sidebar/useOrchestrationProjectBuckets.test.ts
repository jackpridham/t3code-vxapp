import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { Project } from "../../types";
import { resolveOrchestrationSidebarProjectBuckets } from "./useOrchestrationProjectBuckets";

function makeProject(input: {
  id: ProjectId;
  name: string;
  cwd: string;
  sidebarParentProjectId?: ProjectId | null;
}): Pick<Project, "id" | "name" | "cwd" | "sidebarParentProjectId"> {
  return {
    id: input.id,
    name: input.name,
    cwd: input.cwd,
    sidebarParentProjectId: input.sidebarParentProjectId,
  };
}

describe("resolveOrchestrationSidebarProjectBuckets", () => {
  it("keeps every project visible when worktree grouping is disabled", () => {
    const parentProject = makeProject({
      id: ProjectId.makeUnsafe("project-vue"),
      name: "vue-vxapp",
      cwd: "/repos/vue-vxapp",
    });
    const childProject = makeProject({
      id: ProjectId.makeUnsafe("project-vue-lane"),
      name: "r27-vue-ai-first-spa-phase1",
      cwd: "/worktrees/r27-vue-ai-first-spa-phase1",
      sidebarParentProjectId: parentProject.id,
    });

    const result = resolveOrchestrationSidebarProjectBuckets({
      projects: [parentProject, childProject],
      repoIdentityByProjectId: new Map(),
      groupingEnabled: false,
    });

    expect(result.bucketProjectIdByProjectId.get(parentProject.id)).toBe(parentProject.id);
    expect(result.bucketProjectIdByProjectId.get(childProject.id)).toBe(childProject.id);
    expect(result.visibleProjectIds.has(parentProject.id)).toBe(true);
    expect(result.visibleProjectIds.has(childProject.id)).toBe(true);
  });

  it("uses configured and inferred project buckets when worktree grouping is enabled", () => {
    const parentProject = makeProject({
      id: ProjectId.makeUnsafe("project-vue"),
      name: "vue-vxapp",
      cwd: "/repos/vue-vxapp",
    });
    const childProject = makeProject({
      id: ProjectId.makeUnsafe("project-vue-lane"),
      name: "r27-vue-ai-first-spa-phase1",
      cwd: "/worktrees/r27-vue-ai-first-spa-phase1",
    });

    const result = resolveOrchestrationSidebarProjectBuckets({
      projects: [parentProject, childProject],
      repoIdentityByProjectId: new Map(),
      groupingEnabled: true,
    });

    expect(result.bucketProjectIdByProjectId.get(childProject.id)).toBe(parentProject.id);
    expect(result.visibleProjectIds.has(parentProject.id)).toBe(true);
    expect(result.visibleProjectIds.has(childProject.id)).toBe(false);
  });
});
