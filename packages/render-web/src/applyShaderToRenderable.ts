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
  if (!shaderRuntime || !object.effectiveShader) {
    return;
  }

  if (
    object.effectiveShader.targetKind !== "mesh-surface" &&
    object.effectiveShader.targetKind !== "mesh-deform"
  ) {
    return;
  }

  const previousManagedMaterials = releaseShadersFromRenderable(renderable);
  const nextLeases: ShaderMaterialLease[] = [];
  const replacedBaseMaterials = new Set<THREE.Material>();

  renderable.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const targetKind = object.effectiveShader!.targetKind;

    const applyMaterial = (material: THREE.Material): THREE.Material => {
      const finalized = shaderRuntime.applyShader(object.effectiveShader!, {
          targetKind,
          material,
          geometry: child.geometry
        } as {
          targetKind: "mesh-surface" | "mesh-deform";
          material: THREE.Material;
          geometry: THREE.BufferGeometry;
        }) as THREE.Material | undefined;

      if (!finalized) {
        return material;
      }

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
}
