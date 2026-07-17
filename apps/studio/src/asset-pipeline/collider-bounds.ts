/**
 * Asset collider bounds bake (Plan 069.1).
 *
 * Computes an asset's local-space AABB (a `THREE.Box3`) so the collision
 * world (069.2) can scale it by each instance's transform into a world
 * collider. The domain sets the collider SHAPE (kind-aware) but has no
 * three, so `localBounds` is filled here — at import (in-memory), on any
 * GLB-rewriting bake (origin-correct), and lazily when an old project's
 * assets are backfilled.
 *
 * Read-only: unlike the paint-UV / origin-correct bakes, this does NOT
 * re-emit the GLB — it only measures it.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetColliderBounds } from "@sugarmagic/domain";

/**
 * Local-space AABB of a GLB's geometry, or `null` when it has no
 * measurable geometry (e.g. a lights-only GLB). The scene root sits at
 * the origin, so this is the asset's own local bounds — exactly what
 * `correctAssetOriginToBottomCenter` measures.
 */
export async function computeAssetColliderBounds(
  glb: ArrayBuffer
): Promise<AssetColliderBounds | null> {
  const gltf = await new GLTFLoader().parseAsync(glb.slice(0), "");
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  if (box.isEmpty()) {
    return null;
  }
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z]
  };
}
