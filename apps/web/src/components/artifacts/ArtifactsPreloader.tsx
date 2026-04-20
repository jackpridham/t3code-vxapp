import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ensureNativeApi } from "../../nativeApi";
import {
  ARTIFACT_PRELOAD_TTL_MS,
  hasFreshArtifactPreload,
  refreshArtifactPreloadCache,
} from "../../lib/artifactPreloadCache";
import { vortexAppsListQueryOptions } from "../../lib/vortexAppsReactQuery";

export function ArtifactsPreloader() {
  const appsQuery = useQuery({
    ...vortexAppsListQueryOptions(),
    refetchInterval: ARTIFACT_PRELOAD_TTL_MS,
    staleTime: ARTIFACT_PRELOAD_TTL_MS,
  });
  const projects = useMemo(() => appsQuery.data?.catalog.projects ?? [], [appsQuery.data]);
  const projectSignature = projects.map((project) => project.target_id).join("\0");

  useEffect(() => {
    if (projects.length === 0) return;

    let cancelled = false;
    let running = false;

    const preloadStaleArtifacts = async () => {
      if (running) return;
      running = true;

      try {
        const api = ensureNativeApi();
        for (const project of projects) {
          if (cancelled) break;
          if (hasFreshArtifactPreload(project.target_id)) continue;

          try {
            const payload = await api.server.listVortexAppArtifacts({
              target_id: project.target_id,
            });
            if (!cancelled) {
              refreshArtifactPreloadCache(project, payload);
            }
          } catch (error) {
            console.warn(`[ArtifactsPreloader] Failed to preload ${project.target_id}.`, error);
          }
        }
      } finally {
        running = false;
      }
    };

    void preloadStaleArtifacts();
    const interval = window.setInterval(() => {
      void preloadStaleArtifacts();
    }, ARTIFACT_PRELOAD_TTL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectSignature, projects]);

  return null;
}
