import type { ServerGetAgentRuntimeSnapshotResult } from "@t3tools/contracts";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "~/components/ui/badge";
import {
  RuntimeBadgeList,
  RuntimeSourceBadge,
  RuntimeValueCard,
} from "./RuntimeDetailsPanelPrimitives";

function formatGeneratedAge(value: string | null) {
  return value ? formatRelativeTimeLabel(value) : null;
}

export function AgentRuntimeDetailsPanel({
  snapshot,
}: {
  snapshot: ServerGetAgentRuntimeSnapshotResult;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {snapshot.sourceFiles.map((sourceFile) => (
          <RuntimeSourceBadge
            key={sourceFile.key}
            label={sourceFile.label}
            status={sourceFile.status}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RuntimeValueCard label="Repo" value={snapshot.summary.repo} />
        <RuntimeValueCard label="Role" value={snapshot.summary.role} />
        <RuntimeValueCard label="Profile" value={snapshot.summary.profile} />
        <RuntimeValueCard label="Generated" value={snapshot.summary.generatedAt} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <RuntimeValueCard label="Workspace" value={snapshot.workspaceRoot} />
        <RuntimeValueCard label="Runtime dir" value={snapshot.runtimeDir} />
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Resolution
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {snapshot.workspaceResolution.kind}
          </Badge>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
          {snapshot.workspaceResolution.detail ?? "No workspace resolution detail."}
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Source Files
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {snapshot.sourceFiles.length}
          </Badge>
        </div>
        <div className="mt-2 space-y-1.5">
          {snapshot.sourceFiles.map((sourceFile) => (
            <div
              key={sourceFile.key}
              className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <RuntimeSourceBadge label={sourceFile.label} status={sourceFile.status} />
                <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
                  {sourceFile.status}
                </Badge>
                <span className="truncate text-[11px] font-medium text-foreground/90">
                  {sourceFile.fileName}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-muted-foreground/70">
                {sourceFile.absolutePath}
              </p>
              {sourceFile.detail ? (
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
                  {sourceFile.detail}
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
            {snapshot.summary.selectedPacks.length}
          </Badge>
        </div>
        <RuntimeBadgeList emptyLabel="No packs selected." items={snapshot.summary.selectedPacks} />
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Installed Skills
          </p>
          <Badge className="h-5 border-0 bg-secondary px-1.5 text-[10px] font-medium text-foreground/80">
            {snapshot.summary.installedSkills.length}
          </Badge>
        </div>
        <RuntimeBadgeList
          emptyLabel="No runtime skills declared."
          items={snapshot.summary.installedSkills}
        />
      </div>

      <div className="rounded-lg border border-border/70 bg-secondary/15 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
            Role Runtime
          </p>
          {snapshot.summary.generatedAt ? (
            <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground/80">
              {formatGeneratedAge(snapshot.summary.generatedAt)}
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
          {snapshot.roleDetails?.selectionReason ?? "No profile selection rationale was recorded."}
        </p>
      </div>
    </>
  );
}
