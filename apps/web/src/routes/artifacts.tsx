import { createFileRoute } from "@tanstack/react-router";
import { Outlet } from "@tanstack/react-router";

function ArtifactsRoute() {
  return <Outlet />;
}

export const Route = createFileRoute("/artifacts")({
  component: ArtifactsRoute,
});
