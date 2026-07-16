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
  dispose(): void;
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
    new THREE.Matrix4().compose(
      new THREE.Vector3(
        member.transform.position[0],
        member.transform.position[1],
        member.transform.position[2]
      ),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          member.transform.rotation[0],
          member.transform.rotation[1],
          member.transform.rotation[2]
        )
      ),
      new THREE.Vector3(
        member.transform.scale[0],
        member.transform.scale[1],
        member.transform.scale[2]
      )
    )
  );

  const root = new THREE.Group();
  root.name = `instanced-asset:${representative.representationKey}`;
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const composed = new THREE.Matrix4();
  template.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }
    const submesh = child as THREE.Mesh;
    const instanced = new THREE.InstancedMesh(
      submesh.geometry,
      submesh.material,
      instanceWorld.length
    );
    instanced.name = submesh.name || "mesh";
    for (let i = 0; i < instanceWorld.length; i += 1) {
      composed.multiplyMatrices(instanceWorld[i]!, submesh.matrixWorld);
      instanced.setMatrixAt(i, composed);
    }
    instanced.instanceMatrix.needsUpdate = true;
    root.add(instanced);
    instancedMeshes.push(instanced);
  });

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
    dispose() {
      for (const instanced of instancedMeshes) {
        instanced.geometry.dispose();
        instanced.dispose();
      }
    }
  };
}
