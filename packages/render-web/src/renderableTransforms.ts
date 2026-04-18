/**
 * renderableTransforms
 *
 * Shared geometric transform helpers for loaded Three.js renderables. Studio
 * and published web hosts both need the same post-load normalization rules,
 * so this module keeps those calculations in one place.
 */

import * as THREE from "three";

export function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}
