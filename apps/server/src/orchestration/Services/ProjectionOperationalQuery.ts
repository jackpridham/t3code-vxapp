import type {
  OrchestrationCheckpointSummary,
  OrchestrationGetCurrentStateResult,
  OrchestrationGetProjectByIdInput,
  OrchestrationGetProjectByIdResult,
  OrchestrationGetProjectByWorkspaceInput,
  OrchestrationGetProjectByWorkspaceResult,
  OrchestrationGetReadinessResult,
  OrchestrationGetThreadByIdInput,
  OrchestrationGetThreadByIdResult,
  OrchestrationListOrchestratorWakesInput,
  OrchestrationListOrchestratorWakesResult,
  OrchestrationListProjectThreadsInput,
  OrchestrationListProjectThreadsResult,
  OrchestrationListSessionThreadsInput,
  OrchestrationListSessionThreadsResult,
  OrchestrationListThreadActivitiesInput,
  OrchestrationListThreadActivitiesResult,
  OrchestrationListThreadMessagesInput,
  OrchestrationListThreadMessagesResult,
  OrchestrationListThreadSessionsInput,
  OrchestrationListThreadSessionsResult,
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
  readonly getCurrentState: () => Effect.Effect<
    OrchestrationGetCurrentStateResult,
    ProjectionRepositoryError
  >;
  readonly listProjects: () => Effect.Effect<
    OrchestrationListProjectsResult,
    ProjectionRepositoryError
  >;
  readonly getProjectById: (
    input: OrchestrationGetProjectByIdInput,
  ) => Effect.Effect<OrchestrationGetProjectByIdResult, ProjectionRepositoryError>;
  readonly getProjectByWorkspace: (
    input: OrchestrationGetProjectByWorkspaceInput,
  ) => Effect.Effect<OrchestrationGetProjectByWorkspaceResult, ProjectionRepositoryError>;
  readonly listProjectThreads: (
    input: OrchestrationListProjectThreadsInput,
  ) => Effect.Effect<OrchestrationListProjectThreadsResult, ProjectionRepositoryError>;
  readonly getThreadById: (
    input: OrchestrationGetThreadByIdInput,
  ) => Effect.Effect<OrchestrationGetThreadByIdResult, ProjectionRepositoryError>;
  readonly listSessionThreads: (
    input: OrchestrationListSessionThreadsInput,
  ) => Effect.Effect<OrchestrationListSessionThreadsResult, ProjectionRepositoryError>;
  readonly listThreadMessages: (
    input: OrchestrationListThreadMessagesInput,
  ) => Effect.Effect<OrchestrationListThreadMessagesResult, ProjectionRepositoryError>;
  readonly listThreadActivities: (
    input: OrchestrationListThreadActivitiesInput,
  ) => Effect.Effect<OrchestrationListThreadActivitiesResult, ProjectionRepositoryError>;
  readonly listThreadSessions: (
    input: OrchestrationListThreadSessionsInput,
  ) => Effect.Effect<OrchestrationListThreadSessionsResult, ProjectionRepositoryError>;
  readonly listOrchestratorWakes: (
    input: OrchestrationListOrchestratorWakesInput,
  ) => Effect.Effect<OrchestrationListOrchestratorWakesResult, ProjectionRepositoryError>;
  readonly getThreadCheckpointContext: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<ProjectionThreadCheckpointContext, ProjectionRepositoryError>;
}

export class ProjectionOperationalQuery extends ServiceMap.Service<
  ProjectionOperationalQuery,
  ProjectionOperationalQueryShape
>()("t3/orchestration/Services/ProjectionOperationalQuery") {}
