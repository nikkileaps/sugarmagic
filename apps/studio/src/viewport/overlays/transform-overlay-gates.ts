/**
 * Where viewport selection and the transform gizmo are available, and what may
 * be selected once they are.
 *
 * Pure decisions, kept apart from the overlay that acts on them so both can be
 * read and tested without a viewport.
 */

import type { RegionDocument } from "@sugarmagic/domain";
import type { ShellState } from "@sugarmagic/shell";

/** The part of the shell that decides which workspace the author is looking at. */
export type WorkspaceLocation = Pick<
  ShellState,
  "activeProductMode" | "activeBuildWorkspaceKind" | "activeStoryWorkspaceKind"
>;

/** Whether the author is in the Scene Composer. */
export function isSceneComposer(location: WorkspaceLocation): boolean {
  return (
    location.activeProductMode === "story" &&
    location.activeStoryWorkspaceKind === "composer"
  );
}

/**
 * Whether selection and the gizmo attach to the viewport here.
 *
 * Build > Layout is where region content is authored. The Scene Composer gets
 * them too, on the same viewport and the same controller -- it composes a
 * Scene's overlay onto the region, and placing that overlay needs the same
 * picking and dragging. Everywhere else the viewport shows the scene without
 * letting a click move anything, so a stray click in Landscape or Spatial
 * cannot drag a prop.
 */
export function transformOverlayAttaches(location: WorkspaceLocation): boolean {
  const inLayout =
    location.activeProductMode === "build" &&
    location.activeBuildWorkspaceKind === "layout";
  return inLayout || isSceneComposer(location);
}

/**
 * Whether the region itself owns this object, as opposed to the Scene overlay
 * composed on top of it.
 */
export function regionOwns(
  region: RegionDocument | null,
  instanceId: string
): boolean {
  if (!region) return false;
  return (
    region.placedAssets.some((asset) => asset.instanceId === instanceId) ||
    region.placedLights.some((light) => light.instanceId === instanceId) ||
    region.npcPresences.some((p) => p.presenceId === instanceId) ||
    region.itemPresences.some((p) => p.presenceId === instanceId) ||
    region.playerPresence?.presenceId === instanceId
  );
}

/**
 * Whether an object may be selected or dragged where the author is standing.
 *
 * The Scene Composer draws the region's own content so an author can see where
 * things sit while placing what this Scene adds to it, and lets them edit only
 * the Scene's overlay. Everywhere else -- Build -- every drawn object is
 * editable.
 */
export function isSelectableHere(
  location: WorkspaceLocation,
  region: RegionDocument | null,
  instanceId: string
): boolean {
  if (!isSceneComposer(location)) return true;
  return !regionOwns(region, instanceId);
}
