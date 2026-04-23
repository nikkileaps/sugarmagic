/**
 * Studio render-engine projector.
 *
 * Projects canonical Studio store state (projectStore / shellStore /
 * assetSourceStore, via the Epic 033 projection helper) onto the shared
 * `WebRenderEngine`'s imperative setter surface. This is the single
 * Studio-side crossing point between shell state and render-web.
 *
 * The "projector" name matches the event-sourcing / CQRS pattern: a source
 * of truth (the stores) is projected onto a derived read model (the render
 * engine's environment + content + asset-source state). Projector-local
 * state (`lastSeenProjectId`) exists only to detect project-switch
 * transitions so `resetForProjectSwitch()` fires at the right moment.
 *
 * The runtime target (`targets/web/src/RenderEngineProjector.ts`) is the
 * parallel implementation of the same pattern for published builds.
 */

import { createEmptyContentLibrarySnapshot } from "@sugarmagic/domain";
import {
  shallowEqual,
  subscribeToProjection,
  type ProjectionStores
} from "@sugarmagic/shell";
import type { WebRenderEngine } from "@sugarmagic/render-web";

export interface StudioRenderEngineProjectorOptions {
  engine: WebRenderEngine;
  stores: ProjectionStores;
}

const PLACEHOLDER_CONTENT_LIBRARY = createEmptyContentLibrarySnapshot(
  "studio:render-engine-projector:placeholder"
);

export function connectStudioRenderEngineProjector(
  options: StudioRenderEngineProjectorOptions
): () => void {
  let lastSeenProjectId: string | null = null;

  return subscribeToProjection(
    options.stores,
    ({ project, shell, assetSources }) => {
      const session = project.session;
      const activeRegionId = session?.activeRegionId ?? null;
      const region =
        session && activeRegionId
          ? session.regions.get(activeRegionId) ?? null
          : null;
      return {
        projectId: session?.gameProject.identity.id ?? null,
        contentLibrary: session?.contentLibrary ?? null,
        region,
        environmentOverrideId: shell.activeEnvironmentId,
        assetSources: assetSources.sources
      };
    },
    (projection) => {
      const incomingProjectId = projection.projectId;
      if (incomingProjectId !== lastSeenProjectId) {
        options.engine.resetForProjectSwitch();
      }
      lastSeenProjectId = incomingProjectId;

      options.engine.setContentLibrary(
        projection.contentLibrary ?? PLACEHOLDER_CONTENT_LIBRARY
      );
      options.engine.setAssetSources(projection.assetSources);
      options.engine.setEnvironment(
        projection.region,
        projection.environmentOverrideId
      );
    },
    { equalityFn: shallowEqual }
  );
}
