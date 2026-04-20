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
      !hasMaterialSlotSurfaceBinding(object)
    )
  ) {
    return false;
  }

  const previousManagedMaterials = releaseShadersFromRenderable(renderable);
  const nextLeases: ShaderMaterialLease[] = [];
  const replacedBaseMaterials = new Set<THREE.Material>();
  let meshCount = 0;
  let finalizedCount = 0;
  const effectiveMaterialSlots = object.effectiveMaterialSlots ?? [];

  // eslint-disable-next-line no-console
  console.debug("[trace:apply-shader-to-renderable] entry", {
    representationKey: object.representationKey,
    surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
    deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null,
    materialSlotCount: effectiveMaterialSlots.length,
    materialSlots: effectiveMaterialSlots.map((slot) => ({
      slotName: slot.slotName,
      slotIndex: slot.slotIndex,
      materialDefinitionId: slot.materialDefinitionId,
      surfaceShader: slot.surface?.shaderDefinitionId ?? null
    })),
    renderableName: renderable.name || "(unnamed)",
    renderableType: renderable.type
  });

  renderable.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    meshCount += 1;

    const resolveSurfaceBinding = (
      material: THREE.Material,
      slotIndex: number
    ) =>
      effectiveMaterialSlots.find(
        (slot) => slot.slotName === material.name || slot.slotIndex === slotIndex
      )?.surface ?? object.effectiveShaders.surface;

    const applyMaterial = (material: THREE.Material, slotIndex: number): THREE.Material => {
      const surfaceBinding = resolveSurfaceBinding(material, slotIndex);
      const finalized = shaderRuntime.applyShaderSet(
        {
          surface: surfaceBinding,
          deform: object.effectiveShaders.deform
        },
        {
          material,
          geometry: child.geometry,
          fileSources
        }
      ) as THREE.Material | undefined;

      // eslint-disable-next-line no-console
      console.debug("[trace:apply-material-to-mesh]", {
        meshName: child.name || "(unnamed)",
        meshUuid: child.uuid,
        slotIndex,
        slotMaterialName: material.name || "(unnamed)",
        fromMaterialUuid: material.uuid,
        toMaterialUuid: finalized?.uuid ?? null,
        sameMaterial: finalized === material,
        surfaceShader: surfaceBinding?.shaderDefinitionId ?? null
      });

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
      child.material = child.material.map((material, slotIndex) =>
        applyMaterial(material, slotIndex)
      );
      return;
    }

    child.material = applyMaterial(child.material, 0);
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
  state: RenderableShaderApplicationState,
  fileSources: Record<string, string> = {}
) {
  if (!shaderRuntime) {
    // eslint-disable-next-line no-console
    console.debug("[trace:ensure-shader-applied] skip (no shader runtime)", {
      representationKey: object.representationKey
    });
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

  // eslint-disable-next-line no-console
  console.debug("[trace:ensure-shader-applied] applying", {
    representationKey: object.representationKey,
    previousSignature: state.appliedShaderSignature,
    nextSignature,
    fileSourcesChanged: state.appliedFileSources !== fileSources
  });

  const applied = applyShaderToRenderable(renderable, object, shaderRuntime, fileSources);
  if (!applied) {
    // eslint-disable-next-line no-console
    console.debug("[trace:ensure-shader-applied] apply returned false (no meshes yet)", {
      representationKey: object.representationKey,
      renderableType: renderable.type
    });
    return;
  }

  state.appliedShaderSignature = nextSignature;
  state.appliedFileSources = fileSources;
}
