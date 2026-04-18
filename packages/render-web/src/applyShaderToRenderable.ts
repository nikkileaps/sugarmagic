/**
 * applyShaderToRenderable
 *
 * Applies a resolved runtime-core shader binding to a loaded Three.js object
 * using the shared web ShaderRuntime. Keeps object traversal policy in one
 * place so Studio and published web hosts do not drift.
 */

import * as THREE from "three";
import type { SceneObject } from "@sugarmagic/runtime-core";
import { ShaderRuntime } from "./ShaderRuntime";

interface ShaderMaterialLease {
  runtime: ShaderRuntime;
  material: THREE.Material;
}

const shaderMaterialLeases = new WeakMap<THREE.Object3D, ShaderMaterialLease[]>();

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
) {
  if (
    !shaderRuntime ||
    (!object.effectiveShaders.surface && !object.effectiveShaders.deform)
  ) {
    console.warn("[shader-apply:skip]", {
      instanceId: object.instanceId,
      compileProfile:
        shaderRuntime?.getCompileProfile?.() ?? null,
      hasShaderRuntime: shaderRuntime !== null,
      surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
      deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null
    });
    return;
  }

  console.warn("[shader-apply:start]", {
    instanceId: object.instanceId,
    compileProfile: shaderRuntime.getCompileProfile(),
    surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
    deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null
  });

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

  console.warn("[shader-apply:done]", {
    instanceId: object.instanceId,
    compileProfile: shaderRuntime.getCompileProfile(),
    meshCount,
    finalizedCount,
    leasedMaterialCount: nextLeases.length,
    replacedBaseMaterialCount: replacedBaseMaterials.size
  });
}
