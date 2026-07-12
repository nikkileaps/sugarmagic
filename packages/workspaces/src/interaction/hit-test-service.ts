/**
 * HitTestService: the SINGLE ENFORCER of hit resolution.
 *
 * Based on Sugarbuilder ADR 056. Provides three hit-test modes:
 * - select: pick authored scene objects, resolved to the scene-object
 *   ROOT (the ancestor tagged with SCENE_OBJECT_MARKER_KEY, named
 *   with the instanceId) so hover outlines, click-select, the gizmo,
 *   and the Scene Explorer all agree
 * - gizmo: pick gizmo handles, applying the center-handle pick
 *   priority from the gizmo contract
 * - surface: pick placement surfaces
 *
 * What a hit MEANS (which command to run, what to do with the
 * instanceId) still belongs to the workspace layer -- but which
 * object a ray resolves to is decided here and nowhere else.
 */

import * as THREE from "three";
import { isCenterPickPriorityHandle } from "./gizmo-contract";

/**
 * userData key marking a scene-object root. Hosts tag renderable
 * roots with it (value: { instanceId, kind, ... }, node name =
 * instanceId); select-mode hits resolve to the tagged ancestor.
 */
export const SCENE_OBJECT_MARKER_KEY = "sugarmagicSceneObject";

export type HitTestMode = "select" | "gizmo" | "surface";

export interface HitTestResult {
  mode: HitTestMode;
  objectName: string;
  point: THREE.Vector3;
  distance: number;
  object: THREE.Object3D;
}

export interface HitTestService {
  testSelect: (
    normalizedX: number,
    normalizedY: number
  ) => HitTestResult | null;
  testGizmo: (
    normalizedX: number,
    normalizedY: number
  ) => HitTestResult | null;
  testSurface: (
    normalizedX: number,
    normalizedY: number
  ) => HitTestResult | null;
  setCamera: (camera: THREE.Camera) => void;
  setAuthoredRoot: (root: THREE.Object3D) => void;
  setOverlayRoot: (root: THREE.Object3D) => void;
  setSurfaceRoot: (root: THREE.Object3D | null) => void;
}

/**
 * Three's Raycaster intersects HIDDEN objects too -- visibility is a
 * render concern it never consults. Anything toggled off via
 * `.visible` (inactive gizmo mode groups, hidden overlays) must be
 * filtered here or it silently steals hits from what's on screen.
 */
function isVisibleThrough(
  object: THREE.Object3D,
  root: THREE.Object3D
): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    if (node === root) return true;
    node = node.parent;
  }
  return true;
}

function pickNearest(
  raycaster: THREE.Raycaster,
  root: THREE.Object3D,
  mode: HitTestMode
): HitTestResult | null {
  const intersects = raycaster.intersectObjects(root.children, true);
  const visible = intersects.filter((intersect) =>
    isVisibleThrough(intersect.object, root)
  );
  let hit = visible[0];
  if (!hit) return null;

  // The small move/scale center handles sit where the axis handles
  // converge. With the camera looking down an axis, that axis's
  // shaft/cone projects onto the center pixel IN FRONT of the handle
  // and wins nearest-first -- yet an edge-on axis is exactly the one
  // the drag math (correctly) refuses to drive. A center hit anywhere
  // in the stack takes priority. The rotate trackball is exempt: it
  // is the coarse target and the thin rings keep priority over it.
  if (mode === "gizmo") {
    const center = visible.find((intersect) =>
      isCenterPickPriorityHandle(intersect.object.name)
    );
    if (center) hit = center;
  }

  // SELECT hits resolve to the SCENE-OBJECT ROOT -- the ancestor
  // carrying the `sugarmagicSceneObject` marker (named with the
  // instanceId). This is the single enforcer of hit-to-instance
  // resolution: hover outlines, click-select, the gizmo, and the
  // Scene Explorer all agree because they all come through here.
  // The old "first named node" walk stopped at GLB-internal mesh
  // names ("blooms", "stems"), flickering hover between sub-meshes
  // and feeding non-instanceIds to selection.
  if (mode === "select") {
    let node: THREE.Object3D | null = hit.object;
    while (node && node !== root) {
      if (node.userData && node.userData[SCENE_OBJECT_MARKER_KEY]) {
        return {
          mode,
          objectName: node.name,
          point: hit.point.clone(),
          distance: hit.distance,
          object: node
        };
      }
      node = node.parent;
    }
    // Untagged content under the authored root (e.g. landscape
    // plane) falls through to the generic walk below.
  }

  let target = hit.object;
  while (target.parent && target.parent !== root) {
    if (target.name) break;
    target = target.parent;
  }

  return {
    mode,
    objectName: target.name || hit.object.name || "",
    point: hit.point.clone(),
    distance: hit.distance,
    object: target
  };
}

export function createHitTestService(): HitTestService {
  const raycaster = new THREE.Raycaster();
  let camera: THREE.Camera | null = null;
  let authoredRoot: THREE.Object3D | null = null;
  let overlayRoot: THREE.Object3D | null = null;
  let surfaceRoot: THREE.Object3D | null = null;

  function cast(normalizedX: number, normalizedY: number) {
    if (!camera) return;
    raycaster.setFromCamera(
      new THREE.Vector2(normalizedX, normalizedY),
      camera
    );
  }

  return {
    setCamera(c: THREE.Camera) {
      camera = c;
    },

    setAuthoredRoot(root: THREE.Object3D) {
      authoredRoot = root;
    },

    setOverlayRoot(root: THREE.Object3D) {
      overlayRoot = root;
    },

    setSurfaceRoot(root: THREE.Object3D | null) {
      surfaceRoot = root;
    },

    testSelect(normalizedX, normalizedY) {
      if (!camera || !authoredRoot) return null;
      cast(normalizedX, normalizedY);
      return pickNearest(raycaster, authoredRoot, "select");
    },

    testGizmo(normalizedX, normalizedY) {
      if (!camera || !overlayRoot) return null;
      cast(normalizedX, normalizedY);
      return pickNearest(raycaster, overlayRoot, "gizmo");
    },

    testSurface(normalizedX, normalizedY) {
      if (!camera || !surfaceRoot) return null;
      cast(normalizedX, normalizedY);
      return pickNearest(raycaster, surfaceRoot, "surface");
    }
  };
}
