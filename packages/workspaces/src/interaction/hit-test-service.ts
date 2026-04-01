/**
 * HitTestService: raycast queries over the rendered scene.
 *
 * Based on Sugarbuilder ADR 056. Provides three hit-test modes:
 * - select: pick authored scene objects
 * - gizmo: pick gizmo handles (overlay objects)
 * - surface: pick placement surfaces
 *
 * Low-level Three.js raycasting is performed here.
 * Meaning/interpretation of hits belongs to the workspace layer.
 */

import * as THREE from "three";

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

function pickNearest(
  raycaster: THREE.Raycaster,
  root: THREE.Object3D,
  mode: HitTestMode
): HitTestResult | null {
  const intersects = raycaster.intersectObjects(root.children, true);
  if (intersects.length === 0) return null;

  const hit = intersects[0];
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
