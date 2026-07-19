/**
 * Instanced placed-asset group builder (Plan 068.13a / ADR 028).
 *
 * Realizes a group of identical placed-asset `SceneObject`s -- same model
 * + same surface key (`representationKey`, which now folds in the painted
 * mask, ADR 028 Gate 2) -- as ONE `THREE.InstancedMesh` per GLB submesh,
 * instead of N full GLB clones. The Scatter Brush stamps many such
 * placements (e.g. 99 lavender plants = 396 clone draws); batching them
 * collapses that to ~one draw per submesh (shadows included).
 *
 * Shared by every host (the game runtime now; the studio viewport in
 * 068.13b) so instancing is realized ONE way. Composes the existing
 * pieces -- `cloneSkinnedObject`, `normalizeModelScale`, and the node-
 * material apply path (`ensureShaderSetAppliedToRenderable`, the same
 * traverse the per-object path uses; a node material transforms each
 * instance in its vertex stage) -- rather than a new material path.
 *
 * Returns null when the model can't be instanced (skinned), so the host
 * falls back to the per-object clone path.
 */

import * as THREE from "three";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SceneObject } from "@sugarmagic/runtime-core";
import { normalizeModelScale } from "./renderableTransforms";
import { sanitizeRenderableVertexFormats } from "./renderableFallbacks";
import {
  createRenderableShaderApplicationState,
  ensureShaderSetAppliedToRenderable,
  type RenderableShaderApplicationState
} from "./applyShaderToRenderable";
import type { ShaderRuntime } from "./ShaderRuntime";

export interface InstancedAssetGroupResult {
  root: THREE.Group;
  /** The group member whose surface is applied to the whole batch (all
   *  members share the surface key, so any one represents them). */
  representative: SceneObject;
  shaderApplication: RenderableShaderApplicationState;
  /** instanceId per InstancedMesh index, in build order -- lets picking
   *  map a raycast `intersect.instanceId` back to a PlacedAssetInstance
   *  (Plan 068.13b). */
  instanceOrder: string[];
  /** Plan 070.6 — patch ONE member's transform in place (all submeshes'
   *  InstancedMesh matrices at `index`), no group rebuild. Used when a
   *  grouped plant is moved/edited. */
  updateInstance(index: number, transform: SceneObject["transform"]): void;
  /** Plan 070.3 — hide/show ONE member in place (collapses it to zero scale at
   *  its own position, so a group that spans folders can hide just the members
   *  under a hidden folder). Idempotent: re-setting the same state is a no-op,
   *  so it's cheap to call for every member on each projection. */
  setInstanceVisible(index: number, visible: boolean): void;
  dispose(): void;
}

// Post-multiplied onto a member's world matrix to collapse it to a zero-scale
// point at its own translation (070.3 folder-eye hide) — invisible, but local,
// so the batch's bounding sphere barely changes.
const HIDE_SCALE_ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function composeInstanceWorld(
  transform: SceneObject["transform"]
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(
      transform.position[0],
      transform.position[1],
      transform.position[2]
    ),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2]
      )
    ),
    new THREE.Vector3(transform.scale[0], transform.scale[1], transform.scale[2])
  );
}

export function buildInstancedAssetGroup(options: {
  /** >= 2 SceneObjects sharing model + surface key. */
  group: readonly SceneObject[];
  /** The loaded GLB scene for the shared model (host loads it once). */
  sourceScene: THREE.Object3D;
  shaderRuntime: ShaderRuntime | null;
  assetSources: Record<string, string>;
  enableShadows?: (root: THREE.Object3D) => void;
}): InstancedAssetGroupResult | null {
  const { group, sourceScene, shaderRuntime, assetSources, enableShadows } =
    options;
  const representative = group[0]!;

  const template = cloneSkinnedObject(sourceScene) as THREE.Object3D;
  // Same defense the studio viewport applies: a poisoned vertex format
  // (e.g. a paint-UV bake that shipped a normalized-float attribute)
  // crashes createRenderPipeline and kills the whole WebGPU loop. Sanitize
  // at every load boundary, not just the editor's (068.13 mini-review).
  sanitizeRenderableVertexFormats(template);
  let skinned = false;
  template.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      skinned = true;
    }
  });
  if (skinned) {
    // Skinned meshes can't share one instanced skeleton -- let the host
    // fall back to per-object clones.
    return null;
  }

  // Normalize the template at identity, then read each submesh's matrix
  // relative to it and bake it into every instance's world matrix. No
  // per-instance clone.
  template.position.set(0, 0, 0);
  template.rotation.set(0, 0, 0);
  template.scale.set(1, 1, 1);
  const targetHeight = (representative as { targetModelHeight?: number | null })
    .targetModelHeight;
  if (targetHeight) {
    template.updateMatrixWorld(true);
    normalizeModelScale(template, targetHeight);
  }
  template.updateMatrixWorld(true);

  const instanceWorld = group.map((member) =>
    composeInstanceWorld(member.transform)
  );

  const root = new THREE.Group();
  root.name = `instanced-asset:${representative.representationKey}`;
  // Each InstancedMesh + its submesh-local matrix, so a single instance can
  // be re-composed later (updateInstance) without a rebuild.
  const built: Array<{ instanced: THREE.InstancedMesh; submeshMatrix: THREE.Matrix4 }> = [];
  // Members collapsed to zero scale by the Scene Explorer folder eye (070.3).
  const hiddenIndices = new Set<number>();
  const composed = new THREE.Matrix4();
  // Write member `index`'s matrix across every submesh from its current
  // `instanceWorld`, collapsing to a zero-scale point (kept AT its position, so
  // the batch bounds barely move) when the member is hidden.
  function writeInstanceMatrix(index: number): void {
    const hidden = hiddenIndices.has(index);
    for (const { instanced, submeshMatrix } of built) {
      composed.multiplyMatrices(instanceWorld[index]!, submeshMatrix);
      if (hidden) composed.multiply(HIDE_SCALE_ZERO);
      instanced.setMatrixAt(index, composed);
      instanced.instanceMatrix.needsUpdate = true;
    }
  }
  template.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }
    const submesh = child as THREE.Mesh;
    const submeshMatrix = submesh.matrixWorld.clone();
    const instanced = new THREE.InstancedMesh(
      submesh.geometry,
      submesh.material,
      instanceWorld.length
    );
    instanced.name = submesh.name || "mesh";
    root.add(instanced);
    built.push({ instanced, submeshMatrix });
  });
  for (let i = 0; i < instanceWorld.length; i += 1) {
    writeInstanceMatrix(i);
  }

  root.updateMatrixWorld(true);
  enableShadows?.(root);

  // Apply the shared surface via the SAME traverse path the per-object
  // renderables use -- it reaches each InstancedMesh (they are Meshes)
  // and swaps its material to the node surface material, which then
  // transforms per-instance in its vertex stage (ADR 028 Gate 1).
  const shaderApplication = createRenderableShaderApplicationState();
  ensureShaderSetAppliedToRenderable(
    root,
    representative,
    shaderRuntime,
    shaderApplication,
    assetSources
  );

  return {
    root,
    representative,
    shaderApplication,
    instanceOrder: group.map((member) => member.instanceId),
    updateInstance(index, transform) {
      instanceWorld[index] = composeInstanceWorld(transform);
      // Honors the member's current hidden state (writeInstanceMatrix checks
      // hiddenIndices), so moving a hidden member keeps it hidden.
      writeInstanceMatrix(index);
      // The batch's bounding sphere widened if the instance moved out; a
      // fresh compute keeps frustum culling honest.
      for (const { instanced } of built) {
        instanced.computeBoundingSphere();
      }
    },
    setInstanceVisible(index, visible) {
      const currentlyHidden = hiddenIndices.has(index);
      if (visible === !currentlyHidden) {
        return; // no transition — cheap to call for every member each frame
      }
      if (visible) hiddenIndices.delete(index);
      else hiddenIndices.add(index);
      writeInstanceMatrix(index);
    },
    dispose() {
      for (const { instanced } of built) {
        instanced.geometry.dispose();
        instanced.dispose();
      }
    }
  };
}
