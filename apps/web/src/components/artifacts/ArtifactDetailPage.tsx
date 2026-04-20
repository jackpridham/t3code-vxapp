import { LinkIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import ChatMarkdown from "../ChatMarkdown";
import {
  artifactRecordMeta,
  findArtifactBySlug,
  hasFreshArtifactPreload,
  readArtifactPreloadPayload,
  type ArtifactRecord,
} from "~/lib/artifactPreloadCache";
import { buildArtifactsTargetHref } from "~/lib/artifactsRoute";
import { readWorkspaceFileContent } from "~/lib/workspaceFileContent";
import {
  vortexAppArtifactsQueryOptions,
  vortexAppsListQueryOptions,
} from "~/lib/vortexAppsReactQuery";

interface ArtifactDetailPageProps {
  targetId: string;
  artifactTitle: string;
}

function useArtifactCatalogForTarget(input: { targetId: string }): {
  artifacts: ReadonlyArray<ArtifactRecord>;
  isLoading: boolean;
} {
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

  return {
    artifacts,
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

function ArtifactDetailPageContent({ targetId, artifactTitle }: ArtifactDetailPageProps) {
  const navigate = useNavigate();
  const backHref = buildArtifactsTargetHref({ targetId });
  const appsQuery = useQuery(vortexAppsListQueryOptions());
  const { artifacts, isLoading: isArtifactListLoading } = useArtifactCatalogForTarget({ targetId });
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
    queryKey: ["artifacts", "detail", targetId, metadata?.path ?? "unknown"],
    queryFn: async () => {
      if (!absoluteArtifactPath) throw new Error("Artifact path is missing.");
      return readWorkspaceFileContent({
        worktreePath: targetProject?.path ?? null,
        absolutePath: absoluteArtifactPath,
      });
    },
    enabled: absoluteArtifactPath != null && artifact != null,
    staleTime: 30_000,
  });

  if (isArtifactListLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading artifact metadata…</p>;
  }

  if (!artifact || !metadata) {
    return (
      <main className="min-h-0 flex-1 bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            ← Back to app artifacts
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
      <main className="min-h-0 flex-1 bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            ← Back to app artifacts
          </a>
          <h1 className="text-xl font-semibold">{metadata.title}</h1>
          <p className="text-sm text-muted-foreground">Loading artifact content…</p>
        </section>
      </main>
    );
  }

  if (fileContent.error) {
    return (
      <main className="min-h-0 flex-1 bg-background p-4 text-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-3">
          <a
            className="text-xs text-muted-foreground hover:text-foreground"
            href={backHref}
            onClick={(event) => {
              event.preventDefault();
              void navigate({ to: backHref });
            }}
          >
            ← Back to app artifacts
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
    <main className="min-h-0 flex-1 bg-background text-foreground">
      <article className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-6">
        <a
          className="text-xs text-muted-foreground hover:text-foreground"
          href={backHref}
          onClick={(event) => {
            event.preventDefault();
            void navigate({ to: backHref });
          }}
        >
          ← Back to app artifacts
        </a>
        <header className="rounded-lg border border-border/70 bg-card/90 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Artifact
          </p>
          <h1 className="mt-1 text-lg font-semibold">{metadata.title}</h1>
          {metadata.path ? (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <LinkIcon className="size-3" />
              {metadata.path}
            </p>
          ) : null}
          {targetProject ? (
            <p className="text-xs text-muted-foreground/75">{targetProject.path}</p>
          ) : null}
        </header>

        <div className="min-h-0 rounded-lg border border-border bg-card/90 p-4">
          <ChatMarkdown
            text={fileContent.data ?? ""}
            cwd={targetProject?.path}
            variant="document"
          />
        </div>
      </article>
    </main>
  );
}

export function ArtifactDetailPage(props: ArtifactDetailPageProps) {
  return <ArtifactDetailPageContent {...props} />;
}
