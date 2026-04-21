/**
 * Spatial interaction access.
 *
 * Provides a narrow query seam between the Studio-owned spatial overlay and
 * the React Spatial workspace chrome. Scene-graph ownership stays in the
 * overlay; the workspace resolves the overlay attached to its own viewport
 * element instead of relying on one global mutable singleton.
 */

import type { SpatialWorkspaceInstance } from "./spatial-workspace";

const spatialWorkspacesByViewport = new WeakMap<
  HTMLElement,
  SpatialWorkspaceInstance
>();

export function setSpatialWorkspaceForViewport(
  viewportElement: HTMLElement,
  workspace: SpatialWorkspaceInstance | null
): void {
  if (workspace) {
    spatialWorkspacesByViewport.set(viewportElement, workspace);
    return;
  }
  spatialWorkspacesByViewport.delete(viewportElement);
}

export function getSpatialWorkspaceForViewport(
  viewportElement: HTMLElement | null
): SpatialWorkspaceInstance | null {
  if (!viewportElement) {
    return null;
  }
  return spatialWorkspacesByViewport.get(viewportElement) ?? null;
}
