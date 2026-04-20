import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  LinkIcon,
  ListIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  PinIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import {
  artifactRecordMeta,
  findArtifactBySlug,
  refreshArtifactPreloadCache,
  readArtifactPreloadPayload,
  type ArtifactRecord,
} from "~/lib/artifactPreloadCache";
import { buildArtifactsTargetHref } from "~/lib/artifactsRoute";
import { readWorkspaceFileContent } from "~/lib/workspaceFileContent";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  buildMarkdownHeadingTree,
  extractMarkdownHeadings,
  markdownHeadingIds,
  type MarkdownHeadingNode,
} from "~/lib/markdownHeadings";
import {
  vortexAppArtifactsQueryOptions,
  vortexAppsListQueryOptions,
} from "~/lib/vortexAppsReactQuery";
import { ScrollArea } from "../ui/scroll-area";

interface ArtifactDetailPageProps {
  targetId: string;
  artifactTitle: string;
}

function useArtifactCatalogForDetail(input: { targetId: string; artifactTitle: string }): {
  artifacts: ReadonlyArray<ArtifactRecord>;
  catalogFetchedAt: string | null;
  isFetching: boolean;
  isLoading: boolean;
} {
  const cachedPayload = useMemo(() => readArtifactPreloadPayload(input.targetId), [input.targetId]);
  const cachedArtifacts = useMemo(() => cachedPayload?.artifacts ?? [], [cachedPayload]);
  const cachedArtifact = useMemo(
    () => findArtifactBySlug({ artifacts: cachedArtifacts, artifactTitle: input.artifactTitle }),
    [cachedArtifacts, input.artifactTitle],
  );

  const artifactsQuery = useQuery({
    ...vortexAppArtifactsQueryOptions({
      targetId: input.targetId,
      includeArchived: cachedArtifact === null,
      staleTime: 0,
    }),
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!artifactsQuery.data) return;
    refreshArtifactPreloadCache({ target_id: input.targetId }, artifactsQuery.data);
  }, [artifactsQuery.data, input.targetId]);

  const artifacts =
    (artifactsQuery.data?.artifacts as ReadonlyArray<ArtifactRecord> | undefined) ??
    cachedPayload?.artifacts ??
    [];

  return {
    artifacts,
    catalogFetchedAt: artifactsQuery.data?.fetched_at ?? cachedPayload?.fetched_at ?? null,
    isFetching: artifactsQuery.isFetching,
    isLoading: artifacts.length === 0 && artifactsQuery.isLoading,
  };
}

function normalizeLocalPath(input: string): string {
  return input.replace(/\\/g, "/");
}

function toAbsoluteArtifactPath(params: {
  artifactPath: string;
  fallbackRootPath: string | null;
}): string | null {
  const candidate = normalizeLocalPath(params.artifactPath).trim();
  if (!candidate) return null;

  if (/^[A-Za-z]:\//.test(candidate) || candidate.startsWith("/")) {
    return candidate;
  }

  if (!params.fallbackRootPath) {
    return candidate;
  }

  return `${normalizeLocalPath(params.fallbackRootPath).replace(/\/+$/, "")}/${candidate.replace(/^\/+/, "")}`;
}

function renderDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderRelativeRefreshLabel(value: string | null): string {
  if (!value) return "Not refreshed yet";
  return formatRelativeTimeLabel(value);
}

function renderRefreshCopy(label: string, value: string | null): string {
  if (!value) return `${label} not refreshed yet`;
  return `${label} refreshed ${renderRelativeRefreshLabel(value)}`;
}

function dataUpdatedAtIso(dataUpdatedAt: number): string | null {
  if (!Number.isFinite(dataUpdatedAt) || dataUpdatedAt <= 0) return null;
  return new Date(dataUpdatedAt).toISOString();
}

function ArtifactMetaField(props: { label: string; value: string | null }) {
  if (!props.value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/65">
        {props.label}
      </dt>
      <dd className="mt-0.5 truncate text-xs text-foreground/85" title={props.value}>
        {props.value}
      </dd>
    </div>
  );
}

function ArtifactMarkdownHeadingsNav({
  nodes,
  onNavigate,
}: {
  nodes: readonly MarkdownHeadingNode[];
  onNavigate: (headingId: string) => void;
}) {
  const renderNode = useCallback(
    (node: MarkdownHeadingNode, depth: number) => {
      const leftPadding = 8 + depth * 13;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => onNavigate(node.id)}
            title={node.text}
          >
            {hasChildren ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150" />
            ) : (
              <span aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="truncate text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
              {node.text}
            </span>
          </button>
          {hasChildren ? (
            <div className="space-y-0.5">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    },
    [onNavigate],
  );

  if (nodes.length === 0) {
    return (
      <p className="px-2 py-2 text-[11px] text-muted-foreground">No markdown headings found.</p>
    );
  }

  return <div className="space-y-0.5">{nodes.map((node) => renderNode(node, 0))}</div>;
}

function ArtifactDetailPageContent({ targetId, artifactTitle }: ArtifactDetailPageProps) {
  const navigate = useNavigate();
  const backHref = buildArtifactsTargetHref({ targetId });
  const appsQuery = useQuery(vortexAppsListQueryOptions());
  const {
    artifacts,
    catalogFetchedAt,
    isFetching: isCatalogFetching,
    isLoading: isArtifactListLoading,
  } = useArtifactCatalogForDetail({
    targetId,
    artifactTitle,
  });
  const targetProject = useMemo(
    () => appsQuery.data?.catalog.projects.find((project) => project.target_id === targetId),
    [appsQuery.data?.catalog.projects, targetId],
  );

  const artifact = useMemo(
    () => findArtifactBySlug({ artifacts, artifactTitle }),
    [artifactTitle, artifacts],
  );
  const metadata = useMemo(() => (artifact ? artifactRecordMeta(artifact) : null), [artifact]);

  const absoluteArtifactPath = useMemo(() => {
    if (!metadata?.path) return null;
    return toAbsoluteArtifactPath({
      artifactPath: metadata.path,
      fallbackRootPath: targetProject?.path ?? null,
    });
  }, [metadata?.path, targetProject?.path]);

  const fileContent = useQuery({
    queryKey: ["artifacts", "detail", targetId, absoluteArtifactPath ?? "unknown"],
    queryFn: async () => {
      if (!absoluteArtifactPath) throw new Error("Artifact path is missing.");
      return readWorkspaceFileContent({
        worktreePath: targetProject?.path ?? null,
        absolutePath: absoluteArtifactPath,
      });
    },
    enabled: absoluteArtifactPath != null && artifact != null,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const contentRefreshedAt = dataUpdatedAtIso(fileContent.dataUpdatedAt);
  const isRefreshing = isCatalogFetching || fileContent.isFetching;
  const [headingNavOpen, setHeadingNavOpen] = useState(false);
  const markdownHeadings = useMemo(
    () => extractMarkdownHeadings(fileContent.data ?? ""),
    [fileContent.data],
  );
  const headingTree = useMemo(() => buildMarkdownHeadingTree(markdownHeadings), [markdownHeadings]);
  const headingIds = useMemo(() => markdownHeadingIds(markdownHeadings), [markdownHeadings]);

  const scrollToHeading = useCallback((headingId: string) => {
    const heading = document.getElementById(headingId);
    if (heading) {
      heading.tabIndex = -1;
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      heading.focus();
    }
  }, []);

  if (isArtifactListLoading) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background p-4 text-foreground">
        <p className="text-sm text-muted-foreground">Loading artifact metadata...</p>
      </main>
    );
  }

  if (!artifact || !metadata) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            Back to app artifacts
          </a>
          <h1 className="text-lg font-semibold">Artifact not found</h1>
          <p className="rounded-lg border border-dashed border-border bg-card/75 p-4 text-sm text-muted-foreground">
            This artifact could not be resolved for this target. Open the artifact app and choose
            one from the list.
          </p>
        </section>
      </main>
    );
  }

  if (fileContent.isLoading) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            Back to app artifacts
          </a>
          <h1 className="text-xl font-semibold">{metadata.title}</h1>
          <p className="text-sm text-muted-foreground">Refreshing artifact content...</p>
        </section>
      </main>
    );
  }

  if (fileContent.error) {
    return (
      <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            Back to app artifacts
          </a>
          <h1 className="text-xl font-semibold">{metadata.title}</h1>
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive">
            {fileContent.error instanceof Error
              ? fileContent.error.message
              : "Unable to load artifact content."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <article className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
        <a
          className="text-xs text-muted-foreground hover:text-foreground"
          href={backHref}
          onClick={(event) => {
            event.preventDefault();
            void navigate({ to: backHref });
          }}
        >
          Back to app artifacts
        </a>
        <header className="rounded-lg border border-border/70 bg-card/90 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Artifact
              </p>
              <h1 className="mt-1 truncate text-lg font-semibold">{metadata.title}</h1>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5"
                title={contentRefreshedAt ? renderDate(contentRefreshedAt) : undefined}
              >
                {fileContent.isFetching ? (
                  <RefreshCwIcon className="size-3 animate-spin" />
                ) : (
                  <CheckCircle2Icon className="size-3" />
                )}
                {renderRefreshCopy("Content", contentRefreshedAt)}
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5"
                title={catalogFetchedAt ? renderDate(catalogFetchedAt) : undefined}
              >
                {isCatalogFetching ? (
                  <RefreshCwIcon className="size-3 animate-spin" />
                ) : (
                  <CheckCircle2Icon className="size-3" />
                )}
                {renderRefreshCopy("Metadata", catalogFetchedAt)}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isRefreshing ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                <RefreshCwIcon className="size-3 animate-spin" />
                Refreshing
              </span>
            ) : null}
            {metadata.pinned ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                <PinIcon className="size-3" />
                Pinned
              </span>
            ) : null}
            {metadata.archived ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                <ArchiveIcon className="size-3" />
                Archived
              </span>
            ) : null}
            {metadata.kind ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {metadata.kind}
              </span>
            ) : null}
            {metadata.status ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {metadata.status}
              </span>
            ) : null}
          </div>

          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ArtifactMetaField
              label="Created"
              value={metadata.createdAt ? renderDate(metadata.createdAt) : null}
            />
            <ArtifactMetaField
              label="Updated"
              value={metadata.updatedAt ? renderDate(metadata.updatedAt) : null}
            />
            <ArtifactMetaField label="Repo" value={metadata.repo} />
            <ArtifactMetaField label="Worker" value={metadata.worker} />
            <ArtifactMetaField label="Plan" value={metadata.planKey} />
            <ArtifactMetaField label="Thread" value={metadata.threadId} />
            <ArtifactMetaField
              label="Catalog fetched"
              value={catalogFetchedAt ? renderDate(catalogFetchedAt) : null}
            />
            <ArtifactMetaField
              label="Content refreshed"
              value={contentRefreshedAt ? renderDate(contentRefreshedAt) : null}
            />
          </dl>

          {metadata.path ? (
            <p className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <LinkIcon className="size-3 shrink-0" />
              <span className="truncate">{metadata.path}</span>
            </p>
          ) : null}
          {targetProject ? (
            <p className="text-xs text-muted-foreground/75">{targetProject.path}</p>
          ) : null}
        </header>

        <div className="min-h-0 pb-10">
          <div className="flex min-h-0 gap-2">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <ChatMarkdown
                text={fileContent.data ?? ""}
                cwd={targetProject?.path}
                headingIds={headingIds}
                variant="document"
              />
            </div>
            <div className="shrink-0 transition-[width] duration-200 ease-in-out">
              <div
                className={`h-full min-h-0 ${
                  headingNavOpen
                    ? "w-80 border-l border-border/70"
                    : "w-12 border-l border-border/70"
                } sticky top-4`}
              >
                <button
                  type="button"
                  className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-border/75 bg-background/90 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setHeadingNavOpen((value) => !value)}
                  aria-expanded={headingNavOpen}
                  aria-controls="artifact-markdown-headings-nav"
                  title={headingNavOpen ? "Hide markdown headings" : "Show markdown headings"}
                >
                  {headingNavOpen ? (
                    <ChevronRightIcon className="size-4" />
                  ) : (
                    <ChevronLeftIcon className="size-4" />
                  )}
                </button>
                {headingNavOpen ? (
                  <div
                    id="artifact-markdown-headings-nav"
                    className="mt-2 flex min-h-0 flex-col border-t border-border/40"
                  >
                    <div className="flex items-center gap-1 border-b border-border/60 px-2 py-2">
                      <ListIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Headings
                      </p>
                    </div>
                    <ScrollArea className="h-[min(26rem,calc(100dvh-11rem))]">
                      <div className="px-2 py-2">
                        <ArtifactMarkdownHeadingsNav
                          nodes={headingTree}
                          onNavigate={scrollToHeading}
                        />
                      </div>
                    </ScrollArea>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}

export function ArtifactDetailPage(props: ArtifactDetailPageProps) {
  return <ArtifactDetailPageContent {...props} />;
}
