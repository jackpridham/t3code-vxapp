export const ARTIFACTS_ROUTE = "/artifacts" as const;

export function isArtifactsPath(pathname: string): boolean {
  return pathname === ARTIFACTS_ROUTE || pathname.startsWith(`${ARTIFACTS_ROUTE}/`);
}

type ArtifactsTargetHrefInput = {
  targetId: string;
};

export function buildArtifactsTargetHref(input: ArtifactsTargetHrefInput): string {
  return `${ARTIFACTS_ROUTE}/${encodeURIComponent(input.targetId)}`;
}

export function buildArtifactDetailHref(input: {
  targetId: string;
  artifactTitle: string;
}): string {
  return `${ARTIFACTS_ROUTE}/${encodeURIComponent(input.targetId)}/${encodeURIComponent(input.artifactTitle)}`;
}
