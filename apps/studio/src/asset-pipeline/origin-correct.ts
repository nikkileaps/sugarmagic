/**
 * Asset origin correction (#358).
 *
 * Imported GLBs whose Blender object sat away from the world origin bake
 * that world position into the glTF node transform. The studio anchors a
 * placement (and its move gizmo) to the glTF scene root, so the gizmo
 * lands wherever the Blender scene origin was -- often meters off the
 * mesh. See docs / task #353 for the measured chain.
 *
 * This re-pivots the asset to BOTTOM-CENTER: XZ-centered, lowest point at
 * y=0. A placed prop then rests on the terrain at the click point and the
 * gizmo sits at its base. The correction is transform-only -- it wraps the
 * scene content under one offset node rather than rewriting vertices -- so
 * it is safe for shared geometry and multi-mesh assets, and leaves the
 * authored geometry/UVs/materials untouched.
 *
 * REFUSES animated assets: the re-emit goes through GLTFExporter, which
 * only serializes clips passed via `options.animations` (it drops
 * `gltf.animations` otherwise), so correcting an animated GLB would
 * silently strip its clips off the source file. Rather than risk that
 * (or the unverified re-parenting of a rig under the pivot), we throw and
 * let the caller alert. Library assets are static props in practice
 * (`AssetKind` = "model" | "foliage"); revisit if animated props appear.
 *
 * Manual, per-asset (an "Auto Correct Origin" button), not automatic on
 * import -- see the task for the rationale.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export interface OriginCorrectResult {
  glb: ArrayBuffer;
  /** World-space pivot shift applied to reach bottom-center. All zero
   *  when the asset was already bottom-centered. */
  offset: [number, number, number];
  /** False when the asset was already bottom-centered within tolerance
   *  (the re-emit is skipped and the input is returned unchanged). */
  changed: boolean;
}

/** Below this (world units) the asset is treated as already centered --
 *  avoids re-emitting a byte-identical file and stacking no-op wrappers. */
const CENTER_TOLERANCE = 1e-3;

/**
 * Re-pivot a GLB so its geometry's bottom-center sits at the scene root
 * (= the placement / gizmo anchor). Idempotent: a corrected asset reports
 * `changed: false` on a second pass.
 */
export async function correctAssetOriginToBottomCenter(
  glb: ArrayBuffer
): Promise<OriginCorrectResult> {
  const gltf = await new GLTFLoader().parseAsync(glb.slice(0), "");
  if (gltf.animations && gltf.animations.length > 0) {
    // Re-emitting would strip these clips (see module doc). Refuse rather
    // than silently damage the source asset.
    throw new Error(
      `This asset has ${gltf.animations.length} animation clip(s); ` +
        "origin correction would strip them, so it is not supported for " +
        "animated assets yet."
    );
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) {
    throw new Error("Asset has no measurable geometry to re-center.");
  }
  const center = box.getCenter(new THREE.Vector3());
  // Bottom-center pivot: XZ center -> origin, lowest point -> y=0.
  const offset: [number, number, number] = [-center.x, -box.min.y, -center.z];

  const changed =
    Math.abs(offset[0]) > CENTER_TOLERANCE ||
    Math.abs(offset[1]) > CENTER_TOLERANCE ||
    Math.abs(offset[2]) > CENTER_TOLERANCE;

  if (!changed) {
    // Already bottom-centered: return the input untouched, skipping a
    // pointless GLTFExporter round-trip (matches the documented contract).
    return { glb, offset, changed: false };
  }

  // Wrap all root content under a single node translated by the offset.
  // This neutralizes the baked node translation WITHOUT touching
  // vertices, so it is safe for shared geometry; on re-import the scene
  // root lands at the asset's bottom-center.
  const pivot = new THREE.Group();
  pivot.name = "sm-origin-correct";
  pivot.position.set(offset[0], offset[1], offset[2]);
  for (const child of [...scene.children]) {
    pivot.add(child);
  }
  scene.add(pivot);

  const exported = (await new GLTFExporter().parseAsync(scene, {
    binary: true
  })) as ArrayBuffer;

  return { glb: exported, offset, changed: true };
}
