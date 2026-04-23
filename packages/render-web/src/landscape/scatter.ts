/**
 * Landscape scatter sampling.
 *
 * Owns the Stage 1 CPU sampler that turns a landscape channel's resolved
 * scatter layers into concrete surface samples. The actual instanced-mesh
 * realization still lives in `render-web/src/scatter`.
 */

import type {
  ContentLibrarySnapshot,
  RegionLandscapeState
} from "@sugarmagic/domain";
import { LandscapeSplatmap } from "@sugarmagic/domain";
import type { ResolvedScatterLayer, ResolvedSurfaceStack } from "@sugarmagic/runtime-core";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import type { ShaderRuntime } from "../ShaderRuntime";
import {
  buildSurfaceScatterLayer,
  type SurfaceScatterBuildResult,
  type SurfaceScatterSample
} from "../scatter";

function hash01(seed: number): number {
  const x = Math.sin(seed * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function createLandscapeScatterSamples(
  densityPerSquareMeter: number,
  size: number,
  channelIndex: number,
  channelCount: number,
  splatmap: LandscapeSplatmap
): SurfaceScatterSample[] {
  if (!Number.isFinite(densityPerSquareMeter) || densityPerSquareMeter <= 0 || size <= 0) {
    return [];
  }

  const spacing = 1 / Math.sqrt(densityPerSquareMeter);
  const steps = Math.max(1, Math.round(size / Math.max(spacing, 0.01)));
  const cellSize = size / steps;
  const samples: SurfaceScatterSample[] = [];

  for (let zIndex = 0; zIndex < steps; zIndex += 1) {
    for (let xIndex = 0; xIndex < steps; xIndex += 1) {
      const jitterX = (hash01((xIndex + 1) * 97.13 + (zIndex + 1) * 13.71) - 0.5) * cellSize * 0.8;
      const jitterZ = (hash01((xIndex + 1) * 43.17 + (zIndex + 1) * 59.91) - 0.5) * cellSize * 0.8;
      const x = -size / 2 + (xIndex + 0.5) * cellSize + jitterX;
      const z = -size / 2 + (zIndex + 0.5) * cellSize + jitterZ;
      const u = Math.max(0, Math.min(1, x / size + 0.5));
      const v = Math.max(0, Math.min(1, z / size + 0.5));
      const splatmapWeights = splatmap.sampleAllChannelWeights(channelCount, u, v);
      const coverageWeight = splatmapWeights[channelIndex] ?? 0;
      if (coverageWeight <= 0.001) {
        continue;
      }
      samples.push({
        position: [x, 0.001, z],
        normal: [0, 1, 0],
        uv: [u, v],
        height: 0.001,
        coverageWeight,
        splatmapWeights
      });
    }
  }

  return samples;
}

export function buildLandscapeScatterForSurface(
  surface: ResolvedSurfaceStack,
  landscape: RegionLandscapeState,
  channelIndex: number,
  size: number,
  splatmap: LandscapeSplatmap,
  options: {
    contentLibrary: ContentLibrarySnapshot;
    assetResolver: AuthoredAssetResolver;
    shaderRuntime?: ShaderRuntime | null;
    logger?: {
      warn: (message: string, payload?: Record<string, unknown>) => void;
    };
  }
): SurfaceScatterBuildResult[] {
  const results: SurfaceScatterBuildResult[] = [];

  for (const layer of surface.layers) {
    if (layer.kind !== "scatter") {
      continue;
    }
    const density = Math.max(0, layer.density);
    const samples = createLandscapeScatterSamples(
      density,
      size,
      channelIndex,
      landscape.surfaceSlots.length,
      splatmap
    );
    results.push(
      buildSurfaceScatterLayer(layer as ResolvedScatterLayer, samples, options)
    );
  }

  return results;
}
