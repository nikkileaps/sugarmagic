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
  appliedFileSources: Record<string, string> | null;
}

export interface ShaderManagedRenderableEntry {
  root: THREE.Object3D;
  object: SceneObject;
  shaderApplication: RenderableShaderApplicationState;
}

export function createRenderableShaderApplicationState(): RenderableShaderApplicationState {
  return {
    appliedShaderSignature: null,
    appliedFileSources: null
  };
}

function hasMaterialSlotSurfaceBinding(object: SceneObject): boolean {
  return (object.effectiveMaterialSlots ?? []).some((slot) => slot.surface !== null);
}

function getRenderableShaderSignature(object: SceneObject): string | null {
  if (
    !object.effectiveShaders.surface &&
    !object.effectiveShaders.deform &&
    !object.effectiveShaders.effect &&
    !hasMaterialSlotSurfaceBinding(object)
  ) {
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
  shaderRuntime: ShaderRuntime | null,
  fileSources: Record<string, string> = {}
): boolean {
  if (
    !shaderRuntime ||
    (
      !object.effectiveShaders.surface &&
      !object.effectiveShaders.deform &&
      !object.effectiveShaders.effect &&
      !hasMaterialSlotSurfaceBinding(object)
    )
  ) {
    return false;
  }

  const previousManagedMaterials = releaseShadersFromRenderable(renderable);
  const nextLeases: ShaderMaterialLease[] = [];
  let meshCount = 0;
  const effectiveMaterialSlots = object.effectiveMaterialSlots ?? [];

  renderable.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    meshCount += 1;

    const resolveSurfaceBinding = (
      material: THREE.Material,
      slotIndex: number,
      allowSlotIndexFallback: boolean
    ) => {
      const byName = effectiveMaterialSlots.find(
        (slot) => slot.slotName === material.name
      );
      if (byName) {
        return byName.surface;
      }

      if (allowSlotIndexFallback) {
        return (
          effectiveMaterialSlots.find((slot) => slot.slotIndex === slotIndex)?.surface ??
          object.effectiveShaders.surface
        );
      }

      return object.effectiveShaders.surface;
    };

    const applyMaterial = (
      material: THREE.Material,
      slotIndex: number,
      allowSlotIndexFallback: boolean
    ): THREE.Material => {
      const finalized = shaderRuntime.applyShaderSet(
        {
          surface: resolveSurfaceBinding(material, slotIndex, allowSlotIndexFallback),
          deform: object.effectiveShaders.deform,
          effect: object.effectiveShaders.effect
        },
        {
          material,
          geometry: child.geometry,
          fileSources
        }
      ) as THREE.Material | undefined;

      if (!finalized) {
        return material;
      }

      nextLeases.push({ runtime: shaderRuntime, material: finalized });
      return finalized;
    };

    if (Array.isArray(child.material)) {
      child.material = child.material.map((material, slotIndex) =>
        applyMaterial(material, slotIndex, true)
      );
      return;
    }

    child.material = applyMaterial(child.material, 0, false);
  });

  if (nextLeases.length > 0) {
    shaderMaterialLeases.set(renderable, nextLeases);
  }
  return meshCount > 0;
}

export function ensureShaderSetAppliedToRenderable(
  renderable: THREE.Object3D,
  object: SceneObject,
  shaderRuntime: ShaderRuntime | null,
  state: RenderableShaderApplicationState,
  fileSources: Record<string, string> = {}
) {
  if (!shaderRuntime) {
    return;
  }

  const nextSignature = getRenderableShaderSignature(object);
  if (!nextSignature) {
    state.appliedShaderSignature = null;
    state.appliedFileSources = null;
    return;
  }
  if (
    state.appliedShaderSignature === nextSignature &&
    state.appliedFileSources === fileSources
  ) {
    return;
  }

  const applied = applyShaderToRenderable(renderable, object, shaderRuntime, fileSources);
  if (!applied) {
    return;
  }

  state.appliedShaderSignature = nextSignature;
  state.appliedFileSources = fileSources;
}

export function ensureShaderSetsAppliedToRenderables(
  entries: Iterable<ShaderManagedRenderableEntry>,
  shaderRuntime: ShaderRuntime | null,
  fileSources: Record<string, string> = {}
) {
  for (const entry of entries) {
    ensureShaderSetAppliedToRenderable(
      entry.root,
      entry.object,
      shaderRuntime,
      entry.shaderApplication,
      fileSources
    );
  }
}
