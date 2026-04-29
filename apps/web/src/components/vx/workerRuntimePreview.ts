import workerRuntimeCatalog from "../../lib/workerRuntime/__fixtures__/catalog.json";
import apiServicesLedgerHardeningR1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/api-services-ledger-hardening-r1/context-plan.json";
import apiServicesLedgerHardeningR1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/api-services-ledger-hardening-r1/dispatch-contract.json";
import apiServicesLedgerHardeningR1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/api-services-ledger-hardening-r1/installed-packs.json";
import apiServicesLedgerHardeningR1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/api-services-ledger-hardening-r1/instruction-stack-audit.json";
import partymoreSlaveMobileRuntimeBookingFollowthroughA1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-slave-mobile-runtime-booking-followthrough-a1/context-plan.json";
import partymoreSlaveMobileRuntimeBookingFollowthroughA1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-slave-mobile-runtime-booking-followthrough-a1/dispatch-contract.json";
import partymoreSlaveMobileRuntimeBookingFollowthroughA1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-slave-mobile-runtime-booking-followthrough-a1/installed-packs.json";
import partymoreSlaveMobileRuntimeBookingFollowthroughA1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-slave-mobile-runtime-booking-followthrough-a1/instruction-stack-audit.json";
import partymoreVueOrderCreateAdminParityR2ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-vue-order-create-admin-parity-r2/context-plan.json";
import partymoreVueOrderCreateAdminParityR2DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-vue-order-create-admin-parity-r2/dispatch-contract.json";
import partymoreVueOrderCreateAdminParityR2InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-vue-order-create-admin-parity-r2/installed-packs.json";
import partymoreVueOrderCreateAdminParityR2InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/partymore-vue-order-create-admin-parity-r2/instruction-stack-audit.json";
import slaveSiteCrudFoundationVueI1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/slave-site-crud-foundation-vue-i1/context-plan.json";
import slaveSiteCrudFoundationVueI1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/slave-site-crud-foundation-vue-i1/dispatch-contract.json";
import slaveSiteCrudFoundationVueI1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/slave-site-crud-foundation-vue-i1/installed-packs.json";
import slaveSiteCrudFoundationVueI1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/slave-site-crud-foundation-vue-i1/instruction-stack-audit.json";
import storesManagedTargetAgentsC1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-c1/context-plan.json";
import storesManagedTargetAgentsC1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-c1/dispatch-contract.json";
import storesManagedTargetAgentsC1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-c1/installed-packs.json";
import storesManagedTargetAgentsC1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-c1/instruction-stack-audit.json";
import storesManagedTargetAgentsI1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-i1/context-plan.json";
import storesManagedTargetAgentsI1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-i1/dispatch-contract.json";
import storesManagedTargetAgentsI1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-i1/installed-packs.json";
import storesManagedTargetAgentsI1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-agents-i1/instruction-stack-audit.json";
import storesManagedTargetScriptsC1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-c1/context-plan.json";
import storesManagedTargetScriptsC1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-c1/dispatch-contract.json";
import storesManagedTargetScriptsC1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-c1/installed-packs.json";
import storesManagedTargetScriptsC1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-c1/instruction-stack-audit.json";
import storesManagedTargetScriptsI1ContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-i1/context-plan.json";
import storesManagedTargetScriptsI1DispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-i1/dispatch-contract.json";
import storesManagedTargetScriptsI1InstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-i1/installed-packs.json";
import storesManagedTargetScriptsI1InstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-i1/instruction-stack-audit.json";
import storesManagedTargetScriptsProbeContextPlan from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-probe/context-plan.json";
import storesManagedTargetScriptsProbeDispatchContract from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-probe/dispatch-contract.json";
import storesManagedTargetScriptsProbeInstalledPacks from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-probe/installed-packs.json";
import storesManagedTargetScriptsProbeInstructionStackAudit from "../../lib/workerRuntime/__fixtures__/snapshots/stores-managed-target-scripts-probe/instruction-stack-audit.json";

type WorkerRuntimeCatalogFixture = {
  auditStatus: string;
  fixtureId: string;
  packCount: number;
  sourceWorktree: string;
};

type WorkerRuntimeContextPlanFixture = {
  allowedCapabilities?: readonly string[];
  closeoutAuthority?: string | null;
  conflicts?: readonly string[];
  contextMode?: string | null;
  forbiddenCapabilities?: readonly string[];
  repo?: string | null;
  selectedPacks?: readonly string[];
  taskClass?: string | null;
  validationProfile?: string | null;
  warnings?: readonly string[];
};

type WorkerRuntimeDispatchContractFixture = {
  allowedCapabilities?: readonly string[];
  closeoutAuthority?: string | null;
  conflicts?: readonly string[];
  contextMode?: string | null;
  forbiddenCapabilities?: readonly string[];
  repo?: string | null;
  selectedPacks?: readonly string[];
  taskClass?: string | null;
  validationProfile?: string | null;
  warnings?: readonly string[];
};

type WorkerRuntimeInstalledPackManifestFixture = {
  defaultContextModes?: readonly string[];
  description?: string | null;
  forbids?: readonly string[];
  grants?: readonly string[];
  mountMode?: string | null;
  name?: string | null;
  repo?: string | null;
  requires?: readonly string[];
  scope?: string | null;
  type?: string | null;
  version?: string | null;
};

type WorkerRuntimeInstalledPackFixture = {
  id: string;
  manifest?: WorkerRuntimeInstalledPackManifestFixture;
  slug: string;
};

type WorkerRuntimeInstalledPacksFixture = {
  closeoutAuthority?: string | null;
  contextMode?: string | null;
  packs: readonly WorkerRuntimeInstalledPackFixture[];
  repo?: string | null;
  taskClass?: string | null;
};

type WorkerRuntimeInstructionStackAuditFindingFixture = {
  code?: string | null;
  detail?: string | null;
  kind?: string | null;
  severity?: string | null;
};

type WorkerRuntimeInstructionStackAuditPackAuditFixture = {
  issues?: readonly unknown[];
  status?: string | null;
};

type WorkerRuntimeInstructionStackAuditFixture = {
  findings?: readonly WorkerRuntimeInstructionStackAuditFindingFixture[];
  packAudit?: WorkerRuntimeInstructionStackAuditPackAuditFixture;
  status?: string | null;
};

export type PreviewWorkerRuntimeAuditStatus = "clean" | "warning" | "error" | "missing";
export type PreviewWorkerRuntimeSourceFileStatus =
  | "loaded"
  | "missing"
  | "invalid-json"
  | "schema-error";

export type PreviewWorkerRuntimeFixtureId =
  | "api-services-ledger-hardening-r1"
  | "partymore-slave-mobile-runtime-booking-followthrough-a1"
  | "partymore-vue-order-create-admin-parity-r2"
  | "slave-site-crud-foundation-vue-i1"
  | "stores-managed-target-agents-c1"
  | "stores-managed-target-agents-i1"
  | "stores-managed-target-scripts-c1"
  | "stores-managed-target-scripts-i1"
  | "stores-managed-target-scripts-probe";

export type PreviewWorkerRuntimeSourceFile = {
  detail: string | null;
  fileName: string;
  status: PreviewWorkerRuntimeSourceFileStatus;
};

export type PreviewWorkerRuntimeAuditFinding = {
  code: string | null;
  detail: string | null;
  kind: string | null;
  severity: string | null;
};

export type PreviewWorkerRuntimePack = {
  defaultContextModes: readonly string[];
  description: string | null;
  forbids: readonly string[];
  grants: readonly string[];
  id: string;
  mountMode: string | null;
  name: string | null;
  repo: string | null;
  requires: readonly string[];
  scope: string | null;
  slug: string;
  type: string | null;
  version: string | null;
};

export type PreviewWorkerRuntimeSnapshot = {
  allowedCapabilities: readonly string[];
  auditFindings: readonly PreviewWorkerRuntimeAuditFinding[];
  auditStatus: PreviewWorkerRuntimeAuditStatus;
  closeoutAuthority: string | null;
  conflicts: readonly string[];
  contextMode: string | null;
  fixtureId: PreviewWorkerRuntimeFixtureId;
  forbiddenCapabilities: readonly string[];
  packAuditIssueCount: number;
  packAuditStatus: string | null;
  packCount: number;
  packs: readonly PreviewWorkerRuntimePack[];
  repo: string | null;
  selectedPacks: readonly string[];
  sourceFiles: {
    contextPlan: PreviewWorkerRuntimeSourceFile;
    dispatchContract: PreviewWorkerRuntimeSourceFile;
    installedPacks: PreviewWorkerRuntimeSourceFile;
    instructionStackAudit: PreviewWorkerRuntimeSourceFile;
  };
  sourceWorktree: string;
  taskClass: string | null;
  validationProfile: string | null;
  warnings: readonly string[];
};

type PreviewRuntimeFixtureFiles = {
  contextPlan: WorkerRuntimeContextPlanFixture;
  dispatchContract: WorkerRuntimeDispatchContractFixture;
  installedPacks: WorkerRuntimeInstalledPacksFixture;
  instructionStackAudit: WorkerRuntimeInstructionStackAuditFixture;
};

const workerRuntimeCatalogFixtureById = new Map<string, WorkerRuntimeCatalogFixture>(
  workerRuntimeCatalog.fixtures.map((fixture) => [fixture.fixtureId, fixture]),
);

function getCatalogFixture(fixtureId: PreviewWorkerRuntimeFixtureId): WorkerRuntimeCatalogFixture {
  const fixture = workerRuntimeCatalogFixtureById.get(fixtureId);
  if (!fixture) {
    throw new Error(`Missing worker runtime catalog fixture: ${fixtureId}`);
  }
  return fixture;
}

function resolveAuditStatus(status: string): PreviewWorkerRuntimeAuditStatus {
  switch (status) {
    case "clean":
    case "warning":
    case "error":
    case "missing":
      return status;
    default:
      return "missing";
  }
}

function normalizeStringList(input: readonly string[] | undefined): readonly string[] {
  return input ?? [];
}

function normalizeNullableString(input: string | null | undefined): string | null {
  return input ?? null;
}

function preferStringList(
  primary: readonly string[] | undefined,
  fallback: readonly string[] | undefined,
): readonly string[] {
  const normalizedPrimary = normalizeStringList(primary);
  return normalizedPrimary.length > 0 ? normalizedPrimary : normalizeStringList(fallback);
}

function normalizeAuditFindings(
  findings: WorkerRuntimeInstructionStackAuditFixture["findings"] | undefined,
): readonly PreviewWorkerRuntimeAuditFinding[] {
  return (findings ?? []).map((finding) => ({
    code: typeof finding.code === "string" ? finding.code : null,
    detail: typeof finding.detail === "string" ? finding.detail : null,
    kind: typeof finding.kind === "string" ? finding.kind : null,
    severity: typeof finding.severity === "string" ? finding.severity : null,
  }));
}

function normalizePackAuditStatus(
  packAudit: WorkerRuntimeInstructionStackAuditFixture["packAudit"] | undefined,
): string | null {
  if (!packAudit || typeof packAudit !== "object" || !("status" in packAudit)) {
    return null;
  }
  return typeof packAudit.status === "string" ? packAudit.status : null;
}

function normalizePackAuditIssueCount(
  packAudit: WorkerRuntimeInstructionStackAuditFixture["packAudit"] | undefined,
): number {
  if (!packAudit || typeof packAudit !== "object" || !("issues" in packAudit)) {
    return 0;
  }
  return Array.isArray(packAudit.issues) ? packAudit.issues.length : 0;
}

function normalizePackSummary(
  pack: WorkerRuntimeInstalledPacksFixture["packs"][number],
): PreviewWorkerRuntimePack {
  const manifest = pack.manifest ?? {};
  return {
    defaultContextModes:
      "defaultContextModes" in manifest && Array.isArray(manifest.defaultContextModes)
        ? manifest.defaultContextModes.filter((value): value is string => typeof value === "string")
        : [],
    description: typeof manifest.description === "string" ? manifest.description : null,
    forbids:
      "forbids" in manifest && Array.isArray(manifest.forbids)
        ? manifest.forbids.filter((value): value is string => typeof value === "string")
        : [],
    grants:
      "grants" in manifest && Array.isArray(manifest.grants)
        ? manifest.grants.filter((value): value is string => typeof value === "string")
        : [],
    id: pack.id,
    mountMode: typeof manifest.mountMode === "string" ? manifest.mountMode : null,
    name: typeof manifest.name === "string" ? manifest.name : null,
    repo: typeof manifest.repo === "string" ? manifest.repo : null,
    requires:
      "requires" in manifest && Array.isArray(manifest.requires)
        ? manifest.requires.filter((value): value is string => typeof value === "string")
        : [],
    scope: typeof manifest.scope === "string" ? manifest.scope : null,
    slug: pack.slug,
    type: typeof manifest.type === "string" ? manifest.type : null,
    version: typeof manifest.version === "string" ? manifest.version : null,
  };
}

function loadedSourceFile(fileName: string): PreviewWorkerRuntimeSourceFile {
  return {
    detail: null,
    fileName,
    status: "loaded",
  };
}

function buildPreviewWorkerRuntimeSnapshot(
  fixtureId: PreviewWorkerRuntimeFixtureId,
  files: PreviewRuntimeFixtureFiles,
): PreviewWorkerRuntimeSnapshot {
  const catalogFixture = getCatalogFixture(fixtureId);
  const { contextPlan, dispatchContract, installedPacks, instructionStackAudit } = files;

  return {
    allowedCapabilities: preferStringList(
      dispatchContract.allowedCapabilities,
      contextPlan.allowedCapabilities,
    ),
    auditFindings: normalizeAuditFindings(instructionStackAudit.findings),
    auditStatus: resolveAuditStatus(
      typeof instructionStackAudit.status === "string"
        ? instructionStackAudit.status
        : catalogFixture.auditStatus,
    ),
    closeoutAuthority:
      normalizeNullableString(contextPlan.closeoutAuthority) ??
      normalizeNullableString(dispatchContract.closeoutAuthority) ??
      normalizeNullableString(installedPacks.closeoutAuthority),
    conflicts: preferStringList(contextPlan.conflicts, dispatchContract.conflicts),
    contextMode:
      normalizeNullableString(contextPlan.contextMode) ??
      normalizeNullableString(dispatchContract.contextMode) ??
      normalizeNullableString(installedPacks.contextMode),
    fixtureId,
    forbiddenCapabilities: preferStringList(
      dispatchContract.forbiddenCapabilities,
      contextPlan.forbiddenCapabilities,
    ),
    packAuditIssueCount: normalizePackAuditIssueCount(instructionStackAudit.packAudit),
    packAuditStatus: normalizePackAuditStatus(instructionStackAudit.packAudit),
    packCount: catalogFixture.packCount,
    packs: installedPacks.packs.map(normalizePackSummary),
    repo:
      normalizeNullableString(contextPlan.repo) ??
      normalizeNullableString(dispatchContract.repo) ??
      normalizeNullableString(installedPacks.repo),
    selectedPacks: preferStringList(dispatchContract.selectedPacks, contextPlan.selectedPacks),
    sourceFiles: {
      contextPlan: loadedSourceFile("context-plan.json"),
      dispatchContract: loadedSourceFile("dispatch-contract.json"),
      installedPacks: loadedSourceFile("installed-packs.json"),
      instructionStackAudit: loadedSourceFile("instruction-stack-audit.json"),
    },
    sourceWorktree: catalogFixture.sourceWorktree,
    taskClass:
      normalizeNullableString(contextPlan.taskClass) ??
      normalizeNullableString(dispatchContract.taskClass) ??
      normalizeNullableString(installedPacks.taskClass),
    validationProfile:
      normalizeNullableString(dispatchContract.validationProfile) ??
      normalizeNullableString(contextPlan.validationProfile),
    warnings: preferStringList(contextPlan.warnings, dispatchContract.warnings),
  };
}

export const PREVIEW_WORKER_RUNTIME_BY_FIXTURE_ID = {
  "api-services-ledger-hardening-r1": buildPreviewWorkerRuntimeSnapshot(
    "api-services-ledger-hardening-r1",
    {
      contextPlan: apiServicesLedgerHardeningR1ContextPlan,
      dispatchContract: apiServicesLedgerHardeningR1DispatchContract,
      installedPacks: apiServicesLedgerHardeningR1InstalledPacks,
      instructionStackAudit: apiServicesLedgerHardeningR1InstructionStackAudit,
    },
  ),
  "partymore-slave-mobile-runtime-booking-followthrough-a1": buildPreviewWorkerRuntimeSnapshot(
    "partymore-slave-mobile-runtime-booking-followthrough-a1",
    {
      contextPlan: partymoreSlaveMobileRuntimeBookingFollowthroughA1ContextPlan,
      dispatchContract: partymoreSlaveMobileRuntimeBookingFollowthroughA1DispatchContract,
      installedPacks: partymoreSlaveMobileRuntimeBookingFollowthroughA1InstalledPacks,
      instructionStackAudit: partymoreSlaveMobileRuntimeBookingFollowthroughA1InstructionStackAudit,
    },
  ),
  "partymore-vue-order-create-admin-parity-r2": buildPreviewWorkerRuntimeSnapshot(
    "partymore-vue-order-create-admin-parity-r2",
    {
      contextPlan: partymoreVueOrderCreateAdminParityR2ContextPlan,
      dispatchContract: partymoreVueOrderCreateAdminParityR2DispatchContract,
      installedPacks: partymoreVueOrderCreateAdminParityR2InstalledPacks,
      instructionStackAudit: partymoreVueOrderCreateAdminParityR2InstructionStackAudit,
    },
  ),
  "slave-site-crud-foundation-vue-i1": buildPreviewWorkerRuntimeSnapshot(
    "slave-site-crud-foundation-vue-i1",
    {
      contextPlan: slaveSiteCrudFoundationVueI1ContextPlan,
      dispatchContract: slaveSiteCrudFoundationVueI1DispatchContract,
      installedPacks: slaveSiteCrudFoundationVueI1InstalledPacks,
      instructionStackAudit: slaveSiteCrudFoundationVueI1InstructionStackAudit,
    },
  ),
  "stores-managed-target-agents-c1": buildPreviewWorkerRuntimeSnapshot(
    "stores-managed-target-agents-c1",
    {
      contextPlan: storesManagedTargetAgentsC1ContextPlan,
      dispatchContract: storesManagedTargetAgentsC1DispatchContract,
      installedPacks: storesManagedTargetAgentsC1InstalledPacks,
      instructionStackAudit: storesManagedTargetAgentsC1InstructionStackAudit,
    },
  ),
  "stores-managed-target-agents-i1": buildPreviewWorkerRuntimeSnapshot(
    "stores-managed-target-agents-i1",
    {
      contextPlan: storesManagedTargetAgentsI1ContextPlan,
      dispatchContract: storesManagedTargetAgentsI1DispatchContract,
      installedPacks: storesManagedTargetAgentsI1InstalledPacks,
      instructionStackAudit: storesManagedTargetAgentsI1InstructionStackAudit,
    },
  ),
  "stores-managed-target-scripts-c1": buildPreviewWorkerRuntimeSnapshot(
    "stores-managed-target-scripts-c1",
    {
      contextPlan: storesManagedTargetScriptsC1ContextPlan,
      dispatchContract: storesManagedTargetScriptsC1DispatchContract,
      installedPacks: storesManagedTargetScriptsC1InstalledPacks,
      instructionStackAudit: storesManagedTargetScriptsC1InstructionStackAudit,
    },
  ),
  "stores-managed-target-scripts-i1": buildPreviewWorkerRuntimeSnapshot(
    "stores-managed-target-scripts-i1",
    {
      contextPlan: storesManagedTargetScriptsI1ContextPlan,
      dispatchContract: storesManagedTargetScriptsI1DispatchContract,
      installedPacks: storesManagedTargetScriptsI1InstalledPacks,
      instructionStackAudit: storesManagedTargetScriptsI1InstructionStackAudit,
    },
  ),
  "stores-managed-target-scripts-probe": buildPreviewWorkerRuntimeSnapshot(
    "stores-managed-target-scripts-probe",
    {
      contextPlan: storesManagedTargetScriptsProbeContextPlan,
      dispatchContract: storesManagedTargetScriptsProbeDispatchContract,
      installedPacks: storesManagedTargetScriptsProbeInstalledPacks,
      instructionStackAudit: storesManagedTargetScriptsProbeInstructionStackAudit,
    },
  ),
} as const satisfies Record<PreviewWorkerRuntimeFixtureId, PreviewWorkerRuntimeSnapshot>;

export function resolvePreviewWorkerRuntimeSnapshot(
  fixtureId: PreviewWorkerRuntimeFixtureId | null | undefined,
): PreviewWorkerRuntimeSnapshot | null {
  if (!fixtureId) {
    return null;
  }
  return PREVIEW_WORKER_RUNTIME_BY_FIXTURE_ID[fixtureId];
}
