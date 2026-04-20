import { ClockIcon, LinkIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { buildArtifactDetailHref, ARTIFACTS_ROUTE } from "~/lib/artifactsRoute";
import {
  artifactRecordMeta,
  hasFreshArtifactPreload,
  readArtifactPreloadPayload,
  type ArtifactRecord,
} from "~/lib/artifactPreloadCache";
import {
  vortexAppArtifactsQueryOptions,
  vortexAppsListQueryOptions,
} from "~/lib/vortexAppsReactQuery";

interface ArtifactTargetPageProps {
  targetId: string;
}

interface ArtifactListResult {
  artifacts: ReadonlyArray<ArtifactRecord>;
}

function findProjectArtifacts(input: { targetId: string }): ArtifactListResult {
  const cachedPayload = useMemo(() => readArtifactPreloadPayload(input.targetId), [input.targetId]);
  const shouldFetchArtifacts = cachedPayload === null || !hasFreshArtifactPreload(input.targetId);

  const artifactsQuery = useQuery(
    vortexAppArtifactsQueryOptions({
      targetId: input.targetId,
      enabled: shouldFetchArtifacts,
      staleTime: 60_000,
    }),
  );

  const artifacts =
    (artifactsQuery.data?.artifacts as ReadonlyArray<ArtifactRecord> | undefined) ??
    cachedPayload?.artifacts ??
    [];

  return { artifacts };
}

function renderUpdatedAt(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ArtifactTargetPageContent({ targetId }: ArtifactTargetPageProps) {
  const appsQuery = useQuery(vortexAppsListQueryOptions());
  const targetProject = useMemo(
    () => appsQuery.data?.catalog.projects.find((project) => project.target_id === targetId),
    [appsQuery.data?.catalog.projects, targetId],
  );

  const { artifacts } = findProjectArtifacts({ targetId });
  const artifactItems = useMemo(() => {
    const list = [...artifacts];
    list.sort((left, right) => {
      const leftMeta = artifactRecordMeta(left);
      const rightMeta = artifactRecordMeta(right);
      return leftMeta.title.localeCompare(rightMeta.title, "en", { sensitivity: "base" });
    });
    return list;
  }, [artifacts]);

  if (appsQuery.isLoading && artifacts.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">Loading artifact catalog…</p>;
  }

  if (artifactItems.length === 0) {
    return (
      <main className="min-h-0 flex-1 bg-background p-4 text-foreground">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <header className="rounded-lg border border-border/70 bg-card/90 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Artifacts
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold">{targetProject?.display_name ?? targetId}</h1>
              <a
                href={ARTIFACTS_ROUTE}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                All apps
              </a>
            </div>
            {targetProject ? (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <LinkIcon className="inline size-3" />
                {targetProject.path}
              </p>
            ) : null}
          </header>
          <p className="rounded-lg border border-dashed border-border bg-card/75 p-4 text-sm text-muted-foreground">
            No artifacts found for this app yet.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 bg-background p-4 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="rounded-lg border border-border/70 bg-card/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Artifacts
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold">{targetProject?.display_name ?? targetId}</h1>
            <a
              href={ARTIFACTS_ROUTE}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              All apps
            </a>
          </div>
          {targetProject ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <LinkIcon className="size-3" />
              {targetProject.path}
            </p>
          ) : null}
        </header>

        <div className="overflow-hidden rounded-lg border border-border bg-card/80">
          <ul className="divide-y divide-border/80">
            {artifactItems.map((artifact) => {
              const metadata = artifactRecordMeta(artifact);

              return (
                <li
                  key={`${metadata.slug}-${metadata.path ?? metadata.title}`}
                  className="px-4 py-3"
                >
                  <a
                    href={buildArtifactDetailHref({ targetId, artifactTitle: metadata.slug })}
                    className="group flex flex-col gap-1"
                  >
                    <span className="text-sm font-medium text-foreground group-hover:underline">
                      {metadata.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {metadata.path ?? "No path"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/75">
                      <ClockIcon className="size-3" />
                      {metadata.createdAt ? renderUpdatedAt(metadata.createdAt) : "Unknown date"}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </main>
  );
}

export function ArtifactTargetPage({ targetId }: ArtifactTargetPageProps) {
  return <ArtifactTargetPageContent targetId={targetId} />;
}
