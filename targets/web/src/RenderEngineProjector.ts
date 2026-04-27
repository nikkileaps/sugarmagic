/**
 * Runtime render-engine projector (web target).
 *
 * Projects the published-web runtime's boot state onto the shared
 * `WebRenderEngine`'s imperative setter surface. The runtime's upstream
 * state shape is different from Studio's (no subscription, just a
 * `push(state)` call on boot and whenever the target decides to reload) —
 * but the projection rule is identical: detect project switch, reset the
 * engine, then push the three setters in order.
 *
 * See `apps/studio/src/viewport/RenderEngineProjector.ts` for the Studio-
 * side parallel implementation of the same pattern.
 */

import { createEmptyContentLibrarySnapshot, type RegionDocument } from "@sugarmagic/domain";
import type { WebRenderEngine } from "@sugarmagic/render-web";
import type { WebRuntimeStartState } from "./runtimeHost";

const PLACEHOLDER_CONTENT_LIBRARY = createEmptyContentLibrarySnapshot(
  "web-runtime:render-engine-projector:placeholder"
);

function getActiveRegion(
  regions: RegionDocument[],
  activeRegionId?: string | null
): RegionDocument | null {
  if (regions.length === 0) {
    return null;
  }
  return (
    regions.find((region) => region.identity.id === activeRegionId) ??
    regions[0] ??
    null
  );
}

export interface RuntimeRenderEngineProjector {
  push(state: WebRuntimeStartState): void;
  reset(): void;
}

export function createRuntimeRenderEngineProjector(
  engine: WebRenderEngine
): RuntimeRenderEngineProjector {
  let lastSeenProjectId: string | null = null;

  return {
    push(state) {
      const incomingProjectId = state.contentLibrary.identity.id ?? null;
      if (incomingProjectId !== lastSeenProjectId) {
        engine.resetForProjectSwitch();
      }
      lastSeenProjectId = incomingProjectId;
      engine.setContentLibrary(state.contentLibrary ?? PLACEHOLDER_CONTENT_LIBRARY);
      engine.setAssetSources(state.assetSources);
      engine.setEnvironment(
        getActiveRegion(state.regions, state.activeRegionId),
        state.activeEnvironmentId ?? null
      );
    },
    reset() {
      lastSeenProjectId = null;
      engine.resetForProjectSwitch();
    }
  };
}
