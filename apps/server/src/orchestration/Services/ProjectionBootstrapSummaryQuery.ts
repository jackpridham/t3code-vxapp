import type { OrchestrationReadModel } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface ProjectionBootstrapSummaryQueryShape {
  readonly getBootstrapSummary: () => Effect.Effect<
    OrchestrationReadModel,
    ProjectionRepositoryError
  >;
}

export class ProjectionBootstrapSummaryQuery extends ServiceMap.Service<
  ProjectionBootstrapSummaryQuery,
  ProjectionBootstrapSummaryQueryShape
>()("t3/orchestration/Services/ProjectionBootstrapSummaryQuery") {}
