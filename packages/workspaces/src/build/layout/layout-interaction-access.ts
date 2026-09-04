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

/** The same workspaces again, in a form that can be walked. */
const attachedLayoutWorkspaces = new Set<LayoutWorkspaceInstance>();

export function setLayoutWorkspaceForViewport(
  viewportElement: HTMLElement,
  workspace: LayoutWorkspaceInstance | null
): void {
  const previous = layoutWorkspacesByViewport.get(viewportElement);
  if (previous) attachedLayoutWorkspaces.delete(previous);
  if (workspace) {
    layoutWorkspacesByViewport.set(viewportElement, workspace);
    attachedLayoutWorkspaces.add(workspace);
    return;
  }
  layoutWorkspacesByViewport.delete(viewportElement);
}

/**
 * Abandon any viewport drag in progress, and say whether there was one.
 *
 * An application-wide command -- undo is the first -- changes the document
 * while a drag is holding transforms it read at pointer-down. The drag has to
 * end before that happens, or releasing the pointer writes those stale values
 * back over the change.
 */
export function cancelActiveViewportGesture(): boolean {
  let cancelled = false;
  for (const workspace of attachedLayoutWorkspaces) {
    if (workspace.inputRouter.cancelActiveGesture()) cancelled = true;
  }
  return cancelled;
}

export function getLayoutWorkspaceForViewport(
  viewportElement: HTMLElement | null
): LayoutWorkspaceInstance | null {
  if (!viewportElement) {
    return null;
  }
  return layoutWorkspacesByViewport.get(viewportElement) ?? null;
}
