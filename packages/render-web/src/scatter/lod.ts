/**
 * Scatter LOD math.
 *
 * Pure, CPU-verifiable helpers for Story 36.17. These functions own the
 * authored distance-band semantics that both the JavaScript fallback logic and
 * the WebGPU compute kernels mirror.
 */

export type ScatterLodBin = "near" | "far" | "billboard" | "none";

export interface ScatterLodRuntimeParams {
  lod1Distance: number;
  lod2Distance: number;
  lodTransitionWidth: number;
  distantMeshThreshold: number;
  maxDrawDistance: number;
  hasFarBin: boolean;
  hasBillboardBin: boolean;
}

export const LOD1_KEEP_RATIO = 0.9;
export const LOD2_KEEP_RATIO = 0.75;
export const SCATTER_LOD_BAND_SEEDS: Record<Exclude<ScatterLodBin, "none">, number> = {
  near: 11,
  far: 23,
  billboard: 37
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(min: number, max: number, value: number): number {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function computeKeepProbability(
  distance: number,
  params: Pick<
    ScatterLodRuntimeParams,
    "lod1Distance" | "lod2Distance" | "lodTransitionWidth"
  >
): number {
  const halfWidth = Math.max(0, params.lodTransitionWidth) * 0.5;
  const lod1Blend = smoothstep(
    params.lod1Distance - halfWidth,
    params.lod1Distance + halfWidth,
    distance
  );
  const lod2Blend = smoothstep(
    params.lod2Distance - halfWidth,
    params.lod2Distance + halfWidth,
    distance
  );
  const afterLod1 = lerp(1, LOD1_KEEP_RATIO, lod1Blend);
  return lerp(afterLod1, LOD2_KEEP_RATIO, lod2Blend);
}

export function hashKeep(
  sampleIndex: number,
  bandSeed: number,
  keepProbability: number
): boolean {
  const probability = clamp01(keepProbability);
  if (probability <= 0) {
    return false;
  }
  if (probability >= 1) {
    return true;
  }
  const hash =
    Math.sin(sampleIndex * 12.9898 + bandSeed * 78.233) * 43758.5453;
  const normalized = hash - Math.floor(hash);
  return normalized <= probability;
}

export function computeLodBin(
  distance: number,
  params: ScatterLodRuntimeParams
): ScatterLodBin {
  if (distance > params.maxDrawDistance) {
    return "none";
  }
  if (params.hasBillboardBin && distance >= params.distantMeshThreshold) {
    return "billboard";
  }
  if (params.hasFarBin && distance >= params.lod1Distance) {
    return "far";
  }
  return "near";
}
