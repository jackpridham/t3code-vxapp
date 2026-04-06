import type {
  OrchestrationGetProjectByWorkspaceInput,
  OrchestrationGetProjectByWorkspaceResult,
  OrchestrationGetReadinessResult,
  OrchestrationListProjectThreadsInput,
  OrchestrationListProjectThreadsResult,
  OrchestrationListProjectsResult,
} from "@t3tools/contracts";
import type { Effect } from "effect";
import { ServiceMap } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionOperationalQueryShape {
  readonly getReadiness: () => Effect.Effect<
    OrchestrationGetReadinessResult,
    ProjectionRepositoryError
  >;
  readonly listProjects: () => Effect.Effect<OrchestrationListProjectsResult, ProjectionRepositoryError>;
  readonly getProjectByWorkspace: (
    input: OrchestrationGetProjectByWorkspaceInput,
  ) => Effect.Effect<OrchestrationGetProjectByWorkspaceResult, ProjectionRepositoryError>;
  readonly listProjectThreads: (
    input: OrchestrationListProjectThreadsInput,
  ) => Effect.Effect<OrchestrationListProjectThreadsResult, ProjectionRepositoryError>;
}

export class ProjectionOperationalQuery extends ServiceMap.Service<
  ProjectionOperationalQuery,
  ProjectionOperationalQueryShape
>()("t3/orchestration/Services/ProjectionOperationalQuery") {}
