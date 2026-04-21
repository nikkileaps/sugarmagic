/**
 * Layout interaction access.
 *
 * Provides a narrow shared query seam between the viewport-owned layout overlay
 * and the React Layout workspace chrome. Scene-graph ownership stays in the
 * overlay; the workspace resolves the overlay attached to its own viewport
 * element instead of relying on one global mutable singleton.
 */

import type { LayoutWorkspaceInstance } from "./layout-workspace";

const layoutWorkspacesByViewport = new WeakMap<
  HTMLElement,
  LayoutWorkspaceInstance
>();

export function setLayoutWorkspaceForViewport(
  viewportElement: HTMLElement,
  workspace: LayoutWorkspaceInstance | null
): void {
  if (workspace) {
    layoutWorkspacesByViewport.set(viewportElement, workspace);
    return;
  }
  layoutWorkspacesByViewport.delete(viewportElement);
}

export function getLayoutWorkspaceForViewport(
  viewportElement: HTMLElement | null
): LayoutWorkspaceInstance | null {
  if (!viewportElement) {
    return null;
  }
  return layoutWorkspacesByViewport.get(viewportElement) ?? null;
}
