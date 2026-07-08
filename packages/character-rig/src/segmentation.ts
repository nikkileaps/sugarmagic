/**
 * packages/character-rig/src/segmentation.ts
 *
 * Purpose: Plan 064 — virtual body regions: classify every vertex
 * into head / torso / tail / arms / legs from the PRISTINE
 * auto-solve weights (each vertex's dominant bone group). The
 * geodesic solve already partitioned the mesh semantically —
 * this just reads the partition back out, so regions follow the
 * markers (and the tail toggle) with zero extra computation.
 * Regions cross-cut material pieces: a jacket sleeve vertex is
 * "left arm" because the solver said so, whatever material it
 * wears.
 *
 * Status: active
 */

import { MAX_INFLUENCES, type SkinWeights } from "./weights";

export type BodyRegionId =
  | "head"
  | "torso"
  | "tail"
  | "leftArm"
  | "rightArm"
  | "leftLeg"
  | "rightLeg";

export const BODY_REGION_LABELS: Record<BodyRegionId, string> = {
  head: "Head",
  torso: "Torso",
  tail: "Tail",
  leftArm: "Left Arm",
  rightArm: "Right Arm",
  leftLeg: "Left Leg",
  rightLeg: "Right Leg"
};

function regionOfBone(boneName: string): BodyRegionId {
  if (boneName.startsWith("DEF-tail.")) return "tail";
  if (boneName === "DEF-head" || boneName === "DEF-neck") return "head";
  if (boneName.endsWith(".L")) {
    return boneName.includes("thigh") ||
      boneName.includes("shin") ||
      boneName.includes("foot") ||
      boneName.includes("toe")
      ? "leftLeg"
      : "leftArm";
  }
  if (boneName.endsWith(".R")) {
    return boneName.includes("thigh") ||
      boneName.includes("shin") ||
      boneName.includes("foot") ||
      boneName.includes("toe")
      ? "rightLeg"
      : "rightArm";
  }
  return "torso"; // root, hips, spine chain
}

/**
 * Vertex sets per body region, from PRISTINE auto-solve weights
 * (pass the untouched solver output, not the edited weights — the
 * regions should stay stable while the user repaints). Regions
 * with no vertices (e.g. tail on a tail-less rig) are omitted.
 */
export function computeBodyRegions(
  pristine: { joints: Uint16Array; weights: Float32Array },
  boneOrder: readonly string[]
): Map<BodyRegionId, Set<number>> {
  const boneRegion = boneOrder.map((name) => regionOfBone(name));
  const regions = new Map<BodyRegionId, Set<number>>();
  const vertexCount = pristine.joints.length / MAX_INFLUENCES;
  const totals = new Map<BodyRegionId, number>();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    totals.clear();
    for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
      const weight = pristine.weights[vertex * MAX_INFLUENCES + slot]!;
      if (weight <= 0) continue;
      const column = pristine.joints[vertex * MAX_INFLUENCES + slot]!;
      const region = boneRegion[column] ?? "torso";
      totals.set(region, (totals.get(region) ?? 0) + weight);
    }
    let best: BodyRegionId = "torso";
    let bestWeight = 0;
    for (const [region, weight] of totals) {
      if (weight > bestWeight) {
        bestWeight = weight;
        best = region;
      }
    }
    let set = regions.get(best);
    if (!set) {
      set = new Set();
      regions.set(best, set);
    }
    set.add(vertex);
  }
  return regions;
}

export type { SkinWeights };
