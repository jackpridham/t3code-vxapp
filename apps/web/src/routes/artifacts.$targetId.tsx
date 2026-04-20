import { createFileRoute, Outlet } from "@tanstack/react-router";

function ArtifactsTargetRoute() {
  return <Outlet />;
}

export const Route = createFileRoute("/artifacts/$targetId")({
  component: ArtifactsTargetRoute,
});
