import { useQuery } from "@tanstack/react-query";

import { buildArtifactsTargetHref } from "~/lib/artifactsRoute";
import { vortexAppsListQueryOptions } from "~/lib/vortexAppsReactQuery";

export function ArtifactsPage() {
  const appsQuery = useQuery(vortexAppsListQueryOptions());

  const projects = appsQuery.data?.catalog.projects ?? [];

  if (appsQuery.isLoading && projects.length === 0) {
    return (
      <main className="flex h-dvh min-h-0 overflow-y-auto bg-background text-foreground">
        <section
          aria-label="Artifacts"
          className="mx-auto flex w-full max-w-5xl items-start px-4 py-6"
        >
          <p className="text-sm text-muted-foreground">Loading artifact apps...</p>
        </section>
      </main>
    );
  }

  if (projects.length === 0) {
    return (
      <main className="flex h-dvh min-h-0 overflow-y-auto bg-background text-foreground">
        <section aria-label="Artifacts" className="mx-auto flex w-full max-w-5xl flex-1 px-4 py-6">
          <p className="rounded-lg border border-dashed border-border bg-card/75 p-4 text-sm text-muted-foreground">
            No artifact targets were found yet.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 overflow-y-auto bg-background text-foreground">
      <section aria-label="Artifacts" className="mx-auto flex w-full max-w-5xl flex-1 px-4 py-6">
        <div className="min-w-0 rounded-lg border border-border bg-card/90 p-4">
          <h1 className="text-lg font-semibold">Artifacts</h1>
          <p className="mt-1 text-xs text-muted-foreground">Choose an app to view its artifacts.</p>

          <ul className="mt-4 divide-y divide-border/80">
            {projects.map((project) => (
              <li key={project.target_id} className="py-2">
                <a
                  href={buildArtifactsTargetHref({ targetId: project.target_id })}
                  className="inline-block text-sm text-foreground hover:underline"
                >
                  {project.display_name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
