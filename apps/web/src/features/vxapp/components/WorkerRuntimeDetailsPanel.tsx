import type {
  ServerGetWorkerRuntimeSnapshotResult,
  WorkerRuntimeFinding,
  WorkerRuntimeInstalledPack,
} from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import {
  RuntimeBadgeList,
  RuntimeSourceBadge,
  RuntimeValueCard,
} from "./RuntimeDetailsPanelPrimitives";

const WORKER_RUNTIME_SOURCE_FILE_META = {
  contextPlan: {
    fileName: "context-plan.json",
    label: "Context Plan",
  },
  dispatchContract: {
    fileName: "dispatch-contract.json",
    label: "Dispatch Contract",
  },
  installedPacks: {
    fileName: "installed-packs.json",
    label: "Installed Packs",
  },
} as const;

type WorkerRuntimeSourceFileKey = keyof typeof WORKER_RUNTIME_SOURCE_FILE_META;

function firstNonBlank(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function buildPackSummary(pack: WorkerRuntimeInstalledPack) {
  const manifest = pack.manifest as Record<string, unknown> | undefined;
  return {
    name: typeof manifest?.name === "string" ? manifest.name : null,
    scope: typeof manifest?.scope === "string" ? manifest.scope : null,
    repo: typeof manifest?.repo === "string" ? manifest.repo : null,
  };
}

function renderFindings(findings: readonly WorkerRuntimeFinding[], emptyLabel: string) {
  if (findings.length === 0) {
    return <p className="text-[11px] text-muted-foreground/70">{emptyLabel}</p>;
  }

  return findings.map((finding) => (
    <div
      key={[
        finding.code ?? "finding",
        finding.kind ?? "kind",
        finding.path ?? "path",
        finding.runtimeFile ?? "runtime-file",
        finding.detail ?? "detail",
      ].join(":")}
      className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {finding.severity ? (
          <Badge
            className={cn(
              "h-5 border-0 px-1.5 text-[10px] font-medium",
              finding.severity === "error"
                ? "bg-red-500/12 text-red-700 dark:text-red-300"
                : finding.severity === "warning"
                  ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {finding.severity}
          </Badge>
        ) : null}
        {finding.code ? (
          <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
            {finding.code}
          </Badge>
        ) : null}
        {finding.kind ? (
          <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
            {finding.kind}
          </Badge>
        ) : null}
        {finding.runtimeFile ? (
          <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
            {finding.runtimeFile}
          </Badge>
        ) : null}
      </div>
      {finding.detail ? (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
          {finding.detail}
        </p>
      ) : null}
      {finding.path ? (
        <p className="mt-1 break-all text-[10px] text-muted-foreground/60">{finding.path}</p>
      ) : null}
    </div>
  ));
}

export function WorkerRuntimeDetailsPanel({
  snapshot,
}: {
  snapshot: ServerGetWorkerRuntimeSnapshotResult;
}) {
  const sourceFiles = (
    Object.entries(snapshot.sourceFiles) as Array<
      [
        WorkerRuntimeSourceFileKey,
        ServerGetWorkerRuntimeSnapshotResult["sourceFiles"][WorkerRuntimeSourceFileKey],
      ]
    >
  ).map(([key, sourceFile]) => ({
    key,
    sourceFile,
    meta: WORKER_RUNTIME_SOURCE_FILE_META[key],
  }));

  const repo = firstNonBlank(
    snapshot.contextPlan?.repo,
    snapshot.dispatchContract?.repo,
    snapshot.installedPacks?.repo,
    snapshot.audit.repo,
  );
  const taskClass = firstNonBlank(
    snapshot.contextPlan?.taskClass,
    snapshot.dispatchContract?.taskClass,
    snapshot.audit.taskClass,
  );
  const contextMode = firstNonBlank(
    snapshot.contextPlan?.contextMode,
    snapshot.dispatchContract?.contextMode,
    snapshot.audit.contextMode,
  );
  const closeoutAuthority = firstNonBlank(
    snapshot.contextPlan?.closeoutAuthority,
    snapshot.dispatchContract?.closeoutAuthority,
    snapshot.audit.closeoutAuthority,
  );
  const validationProfile = firstNonBlank(
    snapshot.contextPlan?.validationProfile,
    snapshot.dispatchContract?.validationProfile,
  );
  const contextSelectedPacks = snapshot.contextPlan?.selectedPacks ?? [];
  const selectedPacks =
    contextSelectedPacks.length > 0
      ? contextSelectedPacks
      : (snapshot.dispatchContract?.selectedPacks ?? []);
  const contextAllowedCapabilities = snapshot.contextPlan?.allowedCapabilities ?? [];
  const contextForbiddenCapabilities = snapshot.contextPlan?.forbiddenCapabilities ?? [];
  const contextWarnings = snapshot.contextPlan?.warnings ?? [];
  const contextConflicts = snapshot.contextPlan?.conflicts ?? [];
  const allowedCapabilities =
    contextAllowedCapabilities.length > 0
      ? contextAllowedCapabilities
      : (snapshot.dispatchContract?.allowedCapabilities ?? []);
  const forbiddenCapabilities =
    contextForbiddenCapabilities.length > 0
      ? contextForbiddenCapabilities
      : (snapshot.dispatchContract?.forbiddenCapabilities ?? []);
  const warnings =
    contextWarnings.length > 0 ? contextWarnings : (snapshot.dispatchContract?.warnings ?? []);
  const conflicts =
    contextConflicts.length > 0 ? contextConflicts : (snapshot.dispatchContract?.conflicts ?? []);
  const packList = snapshot.installedPacks?.packs ?? [];
  const instructionStackFindings = snapshot.instructionStack.findings ?? [];
  const auditIssues = snapshot.audit.issues ?? [];
  const combinedFindings = [...snapshot.findings, ...instructionStackFindings];
  const combinedIssues = [...snapshot.issues, ...auditIssues];

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {sourceFiles.map(({ key, meta, sourceFile }) => (
          <RuntimeSourceBadge key={key} label={meta.label} status={sourceFile.status} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RuntimeValueCard label="Repo" value={repo} />
        <RuntimeValueCard label="Task" value={taskClass} />
        <RuntimeValueCard label="Context" value={contextMode} />
        <RuntimeValueCard label="Closeout" value={closeoutAuthority} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RuntimeValueCard label="Workspace" value={snapshot.workspace} />
        <RuntimeValueCard label="Runtime dir" value={snapshot.runtimeDir} />
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Source Files
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {sourceFiles.length}
          </Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {sourceFiles.map(({ key, meta, sourceFile }) => (
            <div
              key={key}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <RuntimeSourceBadge label={meta.label} status={sourceFile.status} />
                <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
                  {sourceFile.status}
                </Badge>
                <span className="truncate text-[11px] font-medium text-foreground/90">
                  {meta.fileName}
                </span>
              </div>
              {sourceFile.failureMessage ? (
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                  {sourceFile.failureMessage}
                </p>
              ) : null}
              {sourceFile.failureCode ? (
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  {sourceFile.failureCode}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Selected Packs
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {selectedPacks.length}
          </Badge>
        </div>
        <RuntimeBadgeList emptyLabel="No packs selected." items={selectedPacks} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RuntimeValueCard label="Validation" value={validationProfile} />
        <div className="rounded-lg border border-border/70 bg-secondary/20 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">Audit</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge className="h-5 border border-border/70 bg-background/70 px-1.5 text-[10px] font-medium">
              {snapshot.audit.status}
            </Badge>
            <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
              {snapshot.audit.packAuditStatus}
            </Badge>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Capabilities
          </p>
          <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
            {snapshot.workspaceResolution}
          </Badge>
        </div>
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
              Allowed
            </p>
            <RuntimeBadgeList
              emptyLabel="No explicit allowed capabilities."
              items={allowedCapabilities}
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
              Forbidden
            </p>
            <RuntimeBadgeList
              emptyLabel="No explicit forbidden capabilities."
              items={forbiddenCapabilities}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
              Warnings
            </p>
            <RuntimeBadgeList emptyLabel="No runtime warnings." items={warnings} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
              Conflicts
            </p>
            <RuntimeBadgeList emptyLabel="No declared conflicts." items={conflicts} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Pack Inventory
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {packList.length}
          </Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {packList.length > 0 ? (
            packList.map((pack) => {
              const summary = buildPackSummary(pack);
              return (
                <div
                  key={pack.id}
                  className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-foreground/90">
                      {summary.name ?? pack.slug}
                    </span>
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] text-muted-foreground/80"
                    >
                      {pack.id}
                    </Badge>
                    {summary.scope ? (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[9px] text-muted-foreground/80"
                      >
                        {summary.scope}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {summary.repo ?? "No repo"} · {pack.link}
                  </p>
                </div>
              );
            })
          ) : (
            <p className="text-[11px] text-muted-foreground/70">
              No installed packs were recorded.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Findings
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {combinedFindings.length}
          </Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {renderFindings(combinedFindings, "No runtime findings were recorded.")}
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">Issues</p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {combinedIssues.length}
          </Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {renderFindings(combinedIssues, "No runtime issues were recorded.")}
        </div>
      </div>
    </>
  );
}
