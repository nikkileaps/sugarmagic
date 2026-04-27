/**
 * Scatter LOD tests.
 *
 * Verifies Story 36.17's pure LOD helpers so the authored distance-band rules
 * remain CPU-verifiable outside the WebGPU realization path.
 */

import { describe, expect, it } from "vitest";
import {
  computeKeepProbability,
  computeLodBin,
  hashKeep,
  LOD1_KEEP_RATIO,
  LOD2_KEEP_RATIO,
  SCATTER_LOD_BAND_SEEDS,
  type ScatterLodRuntimeParams
} from "@sugarmagic/render-web";

const params: ScatterLodRuntimeParams = {
  lod1Distance: 20,
  lod2Distance: 40,
  lodTransitionWidth: 8,
  distantMeshThreshold: 60,
  maxDrawDistance: 90,
  hasFarBin: true,
  hasBillboardBin: true
};

describe("scatter LOD math", () => {
  it("assigns the expected bin for the configured distance bands", () => {
    expect(computeLodBin(8, params)).toBe("near");
    expect(computeLodBin(28, params)).toBe("far");
    expect(computeLodBin(72, params)).toBe("billboard");
    expect(computeLodBin(96, params)).toBe("none");
  });

  it("keeps hash-based thinning deterministic per sample and band", () => {
    const probability = computeKeepProbability(32, params);
    expect(hashKeep(17, SCATTER_LOD_BAND_SEEDS.far, probability)).toBe(
      hashKeep(17, SCATTER_LOD_BAND_SEEDS.far, probability)
    );
    const hasBandDifference = Array.from({ length: 128 }).some((_, sampleIndex) =>
      hashKeep(sampleIndex, SCATTER_LOD_BAND_SEEDS.far, probability) !==
      hashKeep(sampleIndex, SCATTER_LOD_BAND_SEEDS.billboard, probability)
    );
    expect(hasBandDifference).toBe(true);
  });

  it("blends keep probability smoothly over the threshold bands", () => {
    const beforeLod1 = computeKeepProbability(14, params);
    const atLod1 = computeKeepProbability(20, params);
    const betweenLod1AndLod2 = computeKeepProbability(30, params);
    const atLod2 = computeKeepProbability(40, params);
    const afterLod2 = computeKeepProbability(52, params);

    expect(beforeLod1).toBeCloseTo(1, 3);
    expect(atLod1).toBeLessThan(beforeLod1);
    expect(atLod1).toBeGreaterThan(LOD1_KEEP_RATIO);
    expect(betweenLod1AndLod2).toBeCloseTo(LOD1_KEEP_RATIO, 3);
    expect(atLod2).toBeLessThan(betweenLod1AndLod2);
    expect(afterLod2).toBeCloseTo(LOD2_KEEP_RATIO, 3);
  });

  it("matches the expected keep ratio over many sample indices", () => {
    const sampleCount = 8192;
    const farProbability = computeKeepProbability(28, params);
    const billboardProbability = computeKeepProbability(52, params);
    let farKept = 0;
    let billboardKept = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      if (hashKeep(sampleIndex, SCATTER_LOD_BAND_SEEDS.far, farProbability)) {
        farKept += 1;
      }
      if (
        hashKeep(
          sampleIndex,
          SCATTER_LOD_BAND_SEEDS.billboard,
          billboardProbability
        )
      ) {
        billboardKept += 1;
      }
    }

    expect(farKept / sampleCount).toBeCloseTo(farProbability, 1);
    expect(billboardKept / sampleCount).toBeCloseTo(billboardProbability, 1);
  });
});
