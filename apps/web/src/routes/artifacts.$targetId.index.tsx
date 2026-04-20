import { createFileRoute } from "@tanstack/react-router";

import { ArtifactTargetPage } from "../components/artifacts/ArtifactTargetPage";

function ArtifactsTargetIndexRoute() {
  const { targetId } = Route.useParams();
  return <ArtifactTargetPage targetId={targetId} />;
}

export const Route = createFileRoute("/artifacts/$targetId/")({
  component: ArtifactsTargetIndexRoute,
});
