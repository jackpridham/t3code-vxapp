import Migration0019 from "../../persistence/Migrations/019_ProjectionProjectHooks.ts";
import Migration0020 from "../../persistence/Migrations/020_ProjectionProjectKind.ts";
import Migration0021 from "../../persistence/Migrations/021_ProjectionThreadLabels.ts";
import Migration0022 from "../../persistence/Migrations/022_ProjectionThreadLineage.ts";
import Migration0023 from "../../persistence/Migrations/023_ProjectionOrchestratorWakes.ts";
import Migration0024 from "../../persistence/Migrations/024_ProjectionProjectCurrentSessionRoot.ts";
import Migration0025 from "../../persistence/Migrations/025_ProjectionProjectSidebarParent.ts";
import Migration0026 from "../../persistence/Migrations/026_ReconcileCompletedWakeTurnStatus.ts";
import Migration0027 from "../../persistence/Migrations/027_ProjectionPrograms.ts";
import Migration0028 from "../../persistence/Migrations/028_ProjectionSnapshotQueryIndexes.ts";
import Migration0029 from "../../persistence/Migrations/029_ProjectionProgramNotifications.ts";
import Migration0030 from "../../persistence/Migrations/030_RuntimeTtlCache.ts";
import Migration0031 from "../../persistence/Migrations/031_ProjectionCtoAttention.ts";

export const vxappMigrationEntries = [
  [19, "ProjectionProjectHooks", Migration0019],
  [20, "ProjectionProjectKind", Migration0020],
  [21, "ProjectionThreadLabels", Migration0021],
  [22, "ProjectionThreadLineage", Migration0022],
  [23, "ProjectionOrchestratorWakes", Migration0023],
  [24, "ProjectionProjectCurrentSessionRoot", Migration0024],
  [25, "ProjectionProjectSidebarParent", Migration0025],
  [26, "ReconcileCompletedWakeTurnStatus", Migration0026],
  [27, "ProjectionPrograms", Migration0027],
  [28, "ProjectionSnapshotQueryIndexes", Migration0028],
  [29, "ProjectionProgramNotifications", Migration0029],
  [30, "RuntimeTtlCache", Migration0030],
  [31, "ProjectionCtoAttention", Migration0031],
] as const;
