import { createFileRoute } from "@tanstack/react-router";

import { ArtifactDetailPage } from "../components/artifacts/ArtifactDetailPage";

function ArtifactsTargetArtifactRoute() {
  const { targetId, artifactTitle } = Route.useParams();
  return <ArtifactDetailPage targetId={targetId} artifactTitle={artifactTitle} />;
}

export const Route = createFileRoute("/artifacts/$targetId/$artifactTitle")({
  component: ArtifactsTargetArtifactRoute,
});
