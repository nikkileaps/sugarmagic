/**
 * Asset-slot scatter realization.
 *
 * Builds Stage 2 asset-slot scatter instances by sampling triangles belonging
 * to one resolved asset material slot and then reusing the shared scatter
 * builder to realize the instanced meshes.
 *
 * Plan 068.11: when the slot's surface can be baked (the mesh has paint
 * UVs), blades inherit the ASSET'S OWN compiled surface under each blade
 * -- the same layers the rock renders, not the terrain. The bake is a
 * top-down world-XZ render (see asset-surface-bake), sampled by each
 * blade's world XZ (instanceOrigin) exactly like landscape grass reads
 * the ground; the shared GPU scatter pipeline is untouched (it broke
 * landscape grass once, 2026-07-13). Slots without a bake fall back to
 * the terrain color.
 */

import * as THREE from "three";
import type { ContentLibrarySnapshot, Mask } from "@sugarmagic/domain";
import type {
  EffectiveMaterialSlotBinding,
  ResolvedScatterLayer,
  ResolvedSurfaceStack
} from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "./authoredAssetResolver";
import { createAssetSurfaceBake } from "./asset-surface-bake";
import { sampleMeshTrianglesForDensity } from "./mesh-triangle-sampler";
import type { ShaderRuntime } from "./ShaderRuntime";
import {
  buildSurfaceScatterLayer,
  type SurfaceScatterBuildResult
} from "./scatter";

function matchesNamedSlot(
  material: THREE.Material,
  slot: EffectiveMaterialSlotBinding
): boolean {
  return material.name.trim().length > 0 && material.name === slot.slotName;
}

/**
 * Flatten a resolved surface stack into the scatter layers it realizes,
 * descending into surface-ref layers (Plan 068.9). A grass SURFACE
 * painted onto an asset via a surface-ref layer must actually grow
 * blades -- the color composite alone renders only the surface's flat
 * base color. Each nested scatter layer is gated by the surface-ref
 * layer's own mask (the painted coverage) so grass appears only where
 * you painted. When the surface-ref carries a real (non-"always") mask
 * it wins over the nested scatter's own mask -- the common case is a
 * grass surface whose scatter mask is "always", painted onto a rock.
 */
function collectAssetScatterLayers(
  stack: ResolvedSurfaceStack,
  gate: { mask: Mask; opacity: number } | null = null
): ResolvedScatterLayer[] {
  const collected: ResolvedScatterLayer[] = [];
  for (const layer of stack.layers) {
    if (layer.enabled === false) {
      continue;
    }
    if (layer.kind === "scatter") {
      if (!gate) {
        collected.push(layer);
        continue;
      }
      collected.push({
        ...layer,
        mask: gate.mask.kind !== "always" ? gate.mask : layer.mask,
        opacity: layer.opacity * gate.opacity
      });
      continue;
    }
    if (layer.kind === "surface-ref") {
      const childGate: { mask: Mask; opacity: number } = {
        mask:
          layer.mask.kind !== "always"
            ? layer.mask
            : gate?.mask ?? layer.mask,
        opacity: (gate?.opacity ?? 1) * layer.opacity
      };
      collected.push(...collectAssetScatterLayers(layer.nested, childGate));
    }
  }
  return collected;
}

export function buildScatterInstancesForAssetSlot(
  root: THREE.Object3D,
  slot: EffectiveMaterialSlotBinding,
  options: {
    contentLibrary: ContentLibrarySnapshot;
    assetResolver: AuthoredAssetResolver;
    shaderRuntime: ShaderRuntime;
    /** The placed instance's world scale (Plan 068.11) -- blades are
     *  children of the scaled asset root, so their size is divided by
     *  this to render at world size. Passed from the SceneObject so it
     *  is correct regardless of build/parent order (the root's world
     *  matrix isn't reliable at build time in every host). */
    assetWorldScale?: readonly [number, number, number];
    logger?: {
      warn: (message: string, payload?: Record<string, unknown>) => void;
    };
  }
): SurfaceScatterBuildResult[] {
  const scatterLayers = slot.surface
    ? collectAssetScatterLayers(slot.surface)
    : [];
  if (scatterLayers.length === 0) {
    return [];
  }

  const results: SurfaceScatterBuildResult[] = [];

  // World-size compensation (Plan 068.11): the scatter blades are
  // children of the asset root, so they inherit its world scale --
  // a rock scaled up would render giant grass. Divide blade scale by
  // the asset's world scale so grass matches the landscape's size.
  // Prefer the SceneObject's scale (always correct); fall back to the
  // root's world matrix only if it wasn't passed.
  let averageWorldScale: number;
  if (options.assetWorldScale) {
    averageWorldScale =
      (options.assetWorldScale[0] +
        options.assetWorldScale[1] +
        options.assetWorldScale[2]) /
      3;
  } else {
    root.updateWorldMatrix(true, false);
    const rootWorldScale = new THREE.Vector3();
    root.matrixWorld.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      rootWorldScale
    );
    averageWorldScale =
      (rootWorldScale.x + rootWorldScale.y + rootWorldScale.z) / 3;
  }
  const instanceWorldScaleCompensation =
    averageWorldScale > 1e-6 ? 1 / averageWorldScale : 1;

  // Collect the slot's meshes -- both the scatter sample source and
  // the surface-bake source (Plan 068.11): blades inherit the SAME
  // meshes' compiled surface.
  const slotMeshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    if (Array.isArray(child.material)) {
      if (
        child.material.some(
          (material, materialIndex) =>
            matchesNamedSlot(material, slot) || slot.slotIndex === materialIndex
        )
      ) {
        slotMeshes.push(child);
      }
      return;
    }
    if (
      matchesNamedSlot(child.material, slot) ||
      (slot.slotIndex === 0 && slot.surface !== null)
    ) {
      slotMeshes.push(child);
    }
  });

  // Bake the slot's compiled surface into paint-UV space (only when
  // the mesh has paint UVs; otherwise null and we fall back to the
  // terrain ground map). Shared across the slot's scatter layers.
  const surfaceBake =
    slot.surface && slotMeshes.length > 0
      ? createAssetSurfaceBake({
          meshes: slotMeshes,
          surfaceStack: slot.surface,
          shaderRuntime: options.shaderRuntime
        })
      : null;
  if (surfaceBake) {
    const bakeAnchor = new THREE.Group();
    bakeAnchor.name = `asset-surface-bake:${slot.slotName}`;
    (bakeAnchor.userData as {
      sugarmagicScatterPrepare?: (renderer: unknown, camera: THREE.Camera) => void;
    }).sugarmagicScatterPrepare = (renderer) => surfaceBake.prepare(renderer);
    root.add(bakeAnchor);
    results.push({
      root: bakeAnchor,
      dispose() {
        root.remove(bakeAnchor);
        surfaceBake.dispose();
      }
    });
  }

  for (const layer of scatterLayers) {
    const samples = new Array<ReturnType<typeof sampleMeshTrianglesForDensity>[number]>();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      if (Array.isArray(child.material)) {
        for (let materialIndex = 0; materialIndex < child.material.length; materialIndex += 1) {
          const material = child.material[materialIndex]!;
          const matchesSlot =
            matchesNamedSlot(material, slot) || slot.slotIndex === materialIndex;
          if (!matchesSlot) {
            continue;
          }
          samples.push(
            ...sampleMeshTrianglesForDensity({
              mesh: child,
              root,
              density: layer.density,
              materialIndex
            })
          );
        }
        return;
      }

      const singleMaterial = child.material;
      const matchesSlot =
        matchesNamedSlot(singleMaterial, slot) ||
        (slot.slotIndex === 0 && slot.surface !== null);
      if (!matchesSlot) {
        return;
      }
      samples.push(
        ...sampleMeshTrianglesForDensity({
          mesh: child,
          root,
          density: layer.density,
          materialIndex: null
        })
      );
    });

    const build = buildSurfaceScatterLayer(layer, samples, {
      contentLibrary: options.contentLibrary,
      assetResolver: options.assetResolver,
      shaderRuntime: options.shaderRuntime,
      // Blades inherit the slot's OWN compiled surface when a bake
      // exists (Plan 068.11); the terrain map stays the fallback for
      // meshes without paint UVs.
      groundColorMap:
        options.shaderRuntime.getAmbientGroundColorMap?.() ?? null,
      assetSurfaceBake: surfaceBake ? surfaceBake.map : null,
      instanceWorldScaleCompensation,
      // GPU path throughout: blades sample the bake by their world XZ
      // (instanceOrigin), which the GPU compaction already carries --
      // no new attribute, no CPU forcing, shared pipeline untouched.
      enableGpuCompute: true,
      logger: options.logger
    });
    build.root.name = `asset-scatter:${slot.slotName}:${layer.layerId}`;
    root.add(build.root);
    results.push(build);
  }

  return results;
}
