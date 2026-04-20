import { ArchiveIcon, ClockIcon, LinkIcon, PinIcon, SearchIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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
  isFetching: boolean;
  isLoading: boolean;
}

type ArtifactSort = "recent" | "updated" | "created" | "pinned" | "title";

function useProjectArtifacts(input: {
  targetId: string;
  includeArchived: boolean;
}): ArtifactListResult {
  const cachedPayload = useMemo(() => readArtifactPreloadPayload(input.targetId), [input.targetId]);
  const shouldFetchArtifacts =
    input.includeArchived || cachedPayload === null || !hasFreshArtifactPreload(input.targetId);

  const artifactsQuery = useQuery(
    vortexAppArtifactsQueryOptions({
      targetId: input.targetId,
      includeArchived: input.includeArchived,
      enabled: shouldFetchArtifacts,
      staleTime: 60_000,
    }),
  );

  const artifacts =
    (artifactsQuery.data?.artifacts as ReadonlyArray<ArtifactRecord> | undefined) ??
    (input.includeArchived ? undefined : cachedPayload?.artifacts) ??
    [];

  return {
    artifacts,
    isFetching: artifactsQuery.isFetching,
    isLoading: artifacts.length === 0 && artifactsQuery.isLoading,
  };
}

function dateMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentArtifactMs(metadata: ReturnType<typeof artifactRecordMeta>): number {
  return Math.max(dateMs(metadata.updatedAt), dateMs(metadata.createdAt));
}

function artifactMatchesFilter(input: {
  artifact: ArtifactRecord;
  filterText: string;
  pinnedOnly: boolean;
  showArchived: boolean;
}): boolean {
  const metadata = artifactRecordMeta(input.artifact);

  if (!input.showArchived && metadata.archived) return false;
  if (input.pinnedOnly && !metadata.pinned) return false;

  const needle = input.filterText.trim().toLowerCase();
  if (!needle) return true;

  return [
    metadata.title,
    metadata.path,
    metadata.repo,
    metadata.kind,
    metadata.preview,
    metadata.createdAt,
    metadata.updatedAt,
  ]
    .filter((value): value is string => value != null && value.length > 0)
    .some((value) => value.toLowerCase().includes(needle));
}

function sortArtifacts(
  artifacts: ReadonlyArray<ArtifactRecord>,
  sort: ArtifactSort,
): ReadonlyArray<ArtifactRecord> {
  return artifacts.toSorted((left, right) => {
    const leftMeta = artifactRecordMeta(left);
    const rightMeta = artifactRecordMeta(right);

    if (sort === "title") {
      return leftMeta.title.localeCompare(rightMeta.title, "en", { sensitivity: "base" });
    }

    if (sort === "pinned") {
      if (leftMeta.pinned !== rightMeta.pinned) return leftMeta.pinned ? -1 : 1;
      return recentArtifactMs(rightMeta) - recentArtifactMs(leftMeta);
    }

    if (sort === "updated") {
      return (
        (dateMs(rightMeta.updatedAt) || dateMs(rightMeta.createdAt)) -
        (dateMs(leftMeta.updatedAt) || dateMs(leftMeta.createdAt))
      );
    }

    if (sort === "created") {
      return dateMs(rightMeta.createdAt) - dateMs(leftMeta.createdAt);
    }

    return recentArtifactMs(rightMeta) - recentArtifactMs(leftMeta);
  });
}

function renderDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderUpdatedAt(metadata: ReturnType<typeof artifactRecordMeta>): string {
  if (metadata.updatedAt) return `Updated ${renderDate(metadata.updatedAt)}`;
  if (metadata.createdAt) return `Created ${renderDate(metadata.createdAt)}`;
  return "Unknown date";
}

function useFilteredArtifacts(input: {
  artifacts: ReadonlyArray<ArtifactRecord>;
  filterText: string;
  pinnedOnly: boolean;
  showArchived: boolean;
  sort: ArtifactSort;
}): ReadonlyArray<ArtifactRecord> {
  return useMemo(
    () =>
      sortArtifacts(
        input.artifacts.filter((artifact) =>
          artifactMatchesFilter({
            artifact,
            filterText: input.filterText,
            pinnedOnly: input.pinnedOnly,
            showArchived: input.showArchived,
          }),
        ),
        input.sort,
      ),
    [input.artifacts, input.filterText, input.pinnedOnly, input.showArchived, input.sort],
  );
}

function ArtifactListControls(props: {
  filterText: string;
  pinnedOnly: boolean;
  showArchived: boolean;
  sort: ArtifactSort;
  totalCount: number;
  visibleCount: number;
  isFetching: boolean;
  onFilterTextChange: (value: string) => void;
  onPinnedOnlyChange: (value: boolean) => void;
  onShowArchivedChange: (value: boolean) => void;
  onSortChange: (value: ArtifactSort) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/80 bg-card/95 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Filter artifacts</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-8 w-full rounded-md border border-input bg-background py-1 pl-8 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            placeholder="Filter by title, path, kind, or preview"
            value={props.filterText}
            onChange={(event) => props.onFilterTextChange(event.currentTarget.value)}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Sort</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            value={props.sort}
            onChange={(event) => props.onSortChange(event.currentTarget.value as ArtifactSort)}
          >
            <option value="recent">Most recent</option>
            <option value="updated">Recently updated</option>
            <option value="created">Newest created</option>
            <option value="pinned">Pinned first</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={props.pinnedOnly}
            onChange={(event) => props.onPinnedOnlyChange(event.currentTarget.checked)}
          />
          Pinned only
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={props.showArchived}
            onChange={(event) => props.onShowArchivedChange(event.currentTarget.checked)}
          />
          Show archived
        </label>
        <span className="ml-auto">
          {props.isFetching
            ? "Refreshing..."
            : `Showing ${props.visibleCount} of ${props.totalCount}`}
        </span>
      </div>
    </div>
  );
}

function ArtifactTargetHeader(props: { targetName: string; targetPath: string | null }) {
  return (
    <header className="shrink-0 rounded-lg border border-border/70 bg-card/90 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Artifacts
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-lg font-semibold">{props.targetName}</h1>
        <a
          href={ARTIFACTS_ROUTE}
          className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
        >
          All apps
        </a>
      </div>
      {props.targetPath ? (
        <p className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <LinkIcon className="size-3 shrink-0" />
          <span className="truncate">{props.targetPath}</span>
        </p>
      ) : null}
    </header>
  );
}

function ArtifactTargetPageContent({ targetId }: ArtifactTargetPageProps) {
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<ArtifactSort>("recent");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const appsQuery = useQuery(vortexAppsListQueryOptions());
  const targetProject = useMemo(
    () => appsQuery.data?.catalog.projects.find((project) => project.target_id === targetId),
    [appsQuery.data?.catalog.projects, targetId],
  );

  const { artifacts, isFetching, isLoading } = useProjectArtifacts({
    targetId,
    includeArchived: showArchived,
  });
  const artifactItems = useFilteredArtifacts({
    artifacts,
    filterText,
    pinnedOnly,
    showArchived,
    sort,
  });
  const targetName = targetProject?.display_name ?? targetId;
  const targetPath = targetProject?.path ?? null;

  if ((appsQuery.isLoading || isLoading) && artifacts.length === 0) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background p-4 text-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <ArtifactTargetHeader targetName={targetName} targetPath={targetPath} />
          <p className="text-sm text-muted-foreground">Loading artifact catalog...</p>
        </div>
      </main>
    );
  }

  if (artifacts.length === 0) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background p-4 text-foreground">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4">
          <ArtifactTargetHeader targetName={targetName} targetPath={targetPath} />
          <p className="rounded-lg border border-dashed border-border bg-card/75 p-4 text-sm text-muted-foreground">
            No artifacts found for this app yet.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background p-4 text-foreground">
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4">
        <ArtifactTargetHeader targetName={targetName} targetPath={targetPath} />

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/80">
          <ArtifactListControls
            filterText={filterText}
            pinnedOnly={pinnedOnly}
            showArchived={showArchived}
            sort={sort}
            totalCount={artifacts.length}
            visibleCount={artifactItems.length}
            isFetching={isFetching}
            onFilterTextChange={setFilterText}
            onPinnedOnlyChange={setPinnedOnly}
            onShowArchivedChange={setShowArchived}
            onSortChange={setSort}
          />

          {artifactItems.length === 0 ? (
            <div className="overflow-y-auto p-4 text-sm text-muted-foreground">
              No artifacts match the current filters.
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/80 overflow-y-auto">
              {artifactItems.map((artifact) => {
                const metadata = artifactRecordMeta(artifact);

                return (
                  <li
                    key={`${metadata.slug}-${metadata.path ?? metadata.title}`}
                    className="px-4 py-3"
                  >
                    <a
                      href={buildArtifactDetailHref({ targetId, artifactTitle: metadata.slug })}
                      className="group flex min-w-0 flex-col gap-1"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {metadata.pinned ? (
                          <PinIcon
                            aria-label="Pinned"
                            className="size-3.5 shrink-0 text-foreground"
                          />
                        ) : null}
                        <span className="min-w-0 truncate text-sm font-medium text-foreground group-hover:underline">
                          {metadata.title}
                        </span>
                        {metadata.archived ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            <ArchiveIcon className="size-3" />
                            Archived
                          </span>
                        ) : null}
                        {metadata.kind ? (
                          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {metadata.kind}
                          </span>
                        ) : null}
                      </span>
                      {metadata.preview ? (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {metadata.preview}
                        </span>
                      ) : null}
                      <span className="truncate text-xs text-muted-foreground/80">
                        {metadata.path ?? "No path"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/75">
                        <ClockIcon className="size-3" />
                        {renderUpdatedAt(metadata)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export function ArtifactTargetPage({ targetId }: ArtifactTargetPageProps) {
  return <ArtifactTargetPageContent targetId={targetId} />;
}
