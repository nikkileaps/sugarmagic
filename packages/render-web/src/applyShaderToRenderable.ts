/**
 * applyShaderToRenderable
 *
 * Applies a resolved runtime-core shader binding to a loaded Three.js object
 * using the shared web ShaderRuntime. This module owns both the mesh traversal
 * policy and the "apply once the runtime exists, regardless of load order"
 * lifecycle so Studio and published web hosts do not drift.
 */

import * as THREE from "three";
import type { SceneObject } from "@sugarmagic/runtime-core";
import { ShaderRuntime } from "./ShaderRuntime";

interface ShaderMaterialLease {
  runtime: ShaderRuntime;
  material: THREE.Material;
}

const shaderMaterialLeases = new WeakMap<THREE.Object3D, ShaderMaterialLease[]>();

export interface RenderableShaderApplicationState {
  appliedShaderSignature: string | null;
}

export function createRenderableShaderApplicationState(): RenderableShaderApplicationState {
  return {
    appliedShaderSignature: null
  };
}

function getRenderableShaderSignature(object: SceneObject): string | null {
  if (!object.effectiveShaders.surface && !object.effectiveShaders.deform) {
    return null;
  }

  return object.representationKey;
}

export function releaseShadersFromRenderable(
  renderable: THREE.Object3D
): Set<THREE.Material> {
  const leases = shaderMaterialLeases.get(renderable) ?? [];
  const releasedMaterials = new Set<THREE.Material>();
  for (const lease of leases) {
    lease.runtime.releaseMaterial(lease.material);
    releasedMaterials.add(lease.material);
  }
  shaderMaterialLeases.delete(renderable);
  return releasedMaterials;
}

export function releaseShadersFromObjectTree(root: THREE.Object3D): Set<THREE.Material> {
  const releasedMaterials = new Set<THREE.Material>();
  root.traverse((child) => {
    for (const material of releaseShadersFromRenderable(child)) {
      releasedMaterials.add(material);
    }
  });
  for (const material of releaseShadersFromRenderable(root)) {
    releasedMaterials.add(material);
  }
  return releasedMaterials;
}

export function applyShaderToRenderable(
  renderable: THREE.Object3D,
  object: SceneObject,
  shaderRuntime: ShaderRuntime | null
): boolean {
  if (
    !shaderRuntime ||
    (!object.effectiveShaders.surface && !object.effectiveShaders.deform)
  ) {
    return false;
  }

  const previousManagedMaterials = releaseShadersFromRenderable(renderable);
  const nextLeases: ShaderMaterialLease[] = [];
  const replacedBaseMaterials = new Set<THREE.Material>();
  let meshCount = 0;
  let finalizedCount = 0;

  renderable.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    meshCount += 1;

    const applyMaterial = (material: THREE.Material): THREE.Material => {
      const finalized = shaderRuntime.applyShaderSet(object.effectiveShaders, {
          material,
          geometry: child.geometry
        }) as THREE.Material | undefined;

      if (!finalized) {
        return material;
      }

      finalizedCount += 1;
      nextLeases.push({ runtime: shaderRuntime, material: finalized });
      if (finalized !== material && !previousManagedMaterials.has(material)) {
        replacedBaseMaterials.add(material);
      }
      return finalized;
    };

    if (Array.isArray(child.material)) {
      child.material = child.material.map(applyMaterial);
      return;
    }

    child.material = applyMaterial(child.material);
  });

  if (nextLeases.length > 0) {
    shaderMaterialLeases.set(renderable, nextLeases);
  }
  for (const material of replacedBaseMaterials) {
    material.dispose();
  }
  return meshCount > 0;
}

export function ensureShaderSetAppliedToRenderable(
  renderable: THREE.Object3D,
  object: SceneObject,
  shaderRuntime: ShaderRuntime | null,
  state: RenderableShaderApplicationState
) {
  if (!shaderRuntime) {
    return;
  }

  const nextSignature = getRenderableShaderSignature(object);
  if (!nextSignature) {
    state.appliedShaderSignature = null;
    return;
  }
  if (state.appliedShaderSignature === nextSignature) {
    return;
  }

  const applied = applyShaderToRenderable(renderable, object, shaderRuntime);
  if (!applied) {
    return;
  }

  state.appliedShaderSignature = nextSignature;
}
