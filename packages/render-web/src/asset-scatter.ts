/**
 * Asset-slot scatter realization.
 *
 * Builds Stage 2 asset-slot scatter instances by sampling triangles belonging
 * to one resolved asset material slot and then reusing the shared scatter
 * builder to realize the instanced meshes.
 */

import * as THREE from "three";
import type { ContentLibrarySnapshot } from "@sugarmagic/domain";
import type { EffectiveMaterialSlotBinding, ResolvedScatterLayer } from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "./authoredAssetResolver";
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

export function buildScatterInstancesForAssetSlot(
  root: THREE.Object3D,
  slot: EffectiveMaterialSlotBinding,
  options: {
    contentLibrary: ContentLibrarySnapshot;
    assetResolver: AuthoredAssetResolver;
    shaderRuntime: ShaderRuntime;
    logger?: {
      warn: (message: string, payload?: Record<string, unknown>) => void;
    };
  }
): SurfaceScatterBuildResult[] {
  const scatterLayers = (slot.surface?.layers ?? []).filter(
    (layer): layer is ResolvedScatterLayer => layer.kind === "scatter"
  );
  if (scatterLayers.length === 0) {
    return [];
  }

  const results: SurfaceScatterBuildResult[] = [];
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
      enableGpuCompute: true,
      logger: options.logger
    });
    build.root.name = `asset-scatter:${slot.slotName}:${layer.layerId}`;
    root.add(build.root);
    results.push(build);
  }

  return results;
}
