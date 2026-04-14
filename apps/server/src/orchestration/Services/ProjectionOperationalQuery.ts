import type {
  OrchestrationCheckpointSummary,
  OrchestrationGetProjectByWorkspaceInput,
  OrchestrationGetProjectByWorkspaceResult,
  OrchestrationGetReadinessResult,
  OrchestrationListProjectThreadsInput,
  OrchestrationListProjectThreadsResult,
  OrchestrationListSessionThreadsInput,
  OrchestrationListSessionThreadsResult,
  OrchestrationListProjectsResult,
  ThreadId,
} from "@t3tools/contracts";
import type { Effect } from "effect";
import { ServiceMap } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionThreadCheckpointContext {
  readonly threadId: ThreadId;
  readonly threadFound: boolean;
  readonly workspaceCwd: string | null;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

export interface ProjectionOperationalQueryShape {
  readonly getReadiness: () => Effect.Effect<
    OrchestrationGetReadinessResult,
    ProjectionRepositoryError
  >;
  readonly listProjects: () => Effect.Effect<
    OrchestrationListProjectsResult,
    ProjectionRepositoryError
  >;
  readonly getProjectByWorkspace: (
    input: OrchestrationGetProjectByWorkspaceInput,
  ) => Effect.Effect<OrchestrationGetProjectByWorkspaceResult, ProjectionRepositoryError>;
  readonly listProjectThreads: (
    input: OrchestrationListProjectThreadsInput,
  ) => Effect.Effect<OrchestrationListProjectThreadsResult, ProjectionRepositoryError>;
  readonly listSessionThreads: (
    input: OrchestrationListSessionThreadsInput,
  ) => Effect.Effect<OrchestrationListSessionThreadsResult, ProjectionRepositoryError>;
  readonly getThreadCheckpointContext: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<ProjectionThreadCheckpointContext, ProjectionRepositoryError>;
}

export class ProjectionOperationalQuery extends ServiceMap.Service<
  ProjectionOperationalQuery,
  ProjectionOperationalQueryShape
>()("t3/orchestration/Services/ProjectionOperationalQuery") {}
