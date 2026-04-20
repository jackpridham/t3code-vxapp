import { createFileRoute } from "@tanstack/react-router";

import { ArtifactsPage } from "../components/artifacts/ArtifactsPage";

function ArtifactsIndexRoute() {
  return <ArtifactsPage />;
}

export const Route = createFileRoute("/artifacts/")({
  component: ArtifactsIndexRoute,
});
