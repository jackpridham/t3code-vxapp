import { createFileRoute } from "@tanstack/react-router";

import { ArtifactWindow, type ArtifactWindowProps } from "../components/ArtifactPanel";
import { parseArtifactWindowSearch } from "../lib/artifactWindow";

function ArtifactWindowRoute() {
  const search = Route.useSearch();

  const props: ArtifactWindowProps = {
    initialArtifactPath: search.path,
    initialWorktreePath: search.worktree ?? null,
  };

  return <ArtifactWindow {...props} />;
}

export const Route = createFileRoute("/artifact")({
  validateSearch: (search) => parseArtifactWindowSearch(search),
  component: ArtifactWindowRoute,
});
