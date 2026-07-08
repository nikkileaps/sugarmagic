/**
 * packages/character-rig/src/region-solve.ts
 *
 * Purpose: Plan 064 — region-scoped re-solve: run the geodesic
 * weight solver over ONE body region against ONLY that region's
 * bone chain, then feather the result into the existing weights
 * at the region boundary. This is the systematic answer to
 * layered-clothing limbs (the jacket-sleeve saga): the original
 * full solve lets torso bones compete for sleeve vertices through
 * the armpit; scoping the competition to the arm chain gives the
 * graduated shoulder->upper->forearm blend automatically, and the
 * boundary band blends into whatever the user has painted on the
 * torso — no hard edges, no manual seam work.
 *
 * Status: active
 */

import { GeodesicVoxelWeightSolver } from "./weights";
import { MAX_INFLUENCES, type SkinWeights } from "./weights";
import { buildVertexAdjacency, type MeshData } from "./mesh";
import type { BoneSegment } from "./skeleton";
import { BODY_REGION_LABELS, type BodyRegionId } from "./segmentation";

/** Bones belonging to a region (mirrors the segmentation table). */
export function bonesOfRegion(
  boneOrder: readonly string[],
  region: BodyRegionId
): Set<string> {
  const isLeg = (name: string) =>
    name.includes("thigh") ||
    name.includes("shin") ||
    name.includes("foot") ||
    name.includes("toe");
  return new Set(
    boneOrder.filter((name) => {
      if (region === "tail") return name.startsWith("DEF-tail.");
      if (region === "head") return name === "DEF-head" || name === "DEF-neck";
      if (region === "leftArm") return name.endsWith(".L") && !isLeg(name);
      if (region === "rightArm") return name.endsWith(".R") && !isLeg(name);
      if (region === "leftLeg") return name.endsWith(".L") && isLeg(name);
      if (region === "rightLeg") return name.endsWith(".R") && isLeg(name);
      return (
        name === "root" || name === "DEF-hips" || name.startsWith("DEF-spine.")
      );
    })
  );
}

/** Width (in mesh hops) of the boundary feather band. */
const BLEND_BAND = 3;

/**
 * Re-solve `regionSet`'s weights against the region's own bones,
 * feathering into existing weights near the region boundary.
 * Mutates `weights` for region vertices only; returns them.
 */
export function resolveRegionWeights(
  mesh: MeshData,
  weights: SkinWeights,
  segments: BoneSegment[],
  regionSet: ReadonlySet<number>,
  region: BodyRegionId,
  options: { resolution?: number } = {}
): number[] {
  const regionBones = bonesOfRegion(weights.boneOrder, region);
  const regionSegments = segments.filter((segment) =>
    regionBones.has(segment.boneName)
  );
  if (regionSegments.length === 0 || regionSet.size === 0) return [];

  const solver = new GeodesicVoxelWeightSolver();
  const solved = solver.solve(mesh, regionSegments, {
    resolution: options.resolution ?? 64,
    smoothingIterations: 2
  });
  // Solved columns index regionSegments' bone order; map into ours.
  const columnMap = solved.boneOrder.map((name) =>
    weights.boneOrder.indexOf(name)
  );

  // Boundary feather: hop distance from the region edge inward.
  const adjacency = buildVertexAdjacency(mesh);
  const hops = new Map<number, number>();
  let frontier: number[] = [];
  for (const vertex of regionSet) {
    const neighbors = adjacency[vertex];
    if (!neighbors) continue;
    for (const neighbor of neighbors) {
      if (!regionSet.has(neighbor)) {
        hops.set(vertex, 1);
        frontier.push(vertex);
        break;
      }
    }
  }
  for (let hop = 2; hop <= BLEND_BAND; hop += 1) {
    const next: number[] = [];
    for (const vertex of frontier) {
      for (const neighbor of adjacency[vertex] ?? []) {
        if (regionSet.has(neighbor) && !hops.has(neighbor)) {
          hops.set(neighbor, hop);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  const affected: number[] = [];
  for (const vertex of regionSet) {
    // New weights from the regional solve, mapped to our columns.
    const merged = new Map<number, number>();
    const hop = hops.get(vertex);
    // Feather factor: 1 deep inside, ->0 at the boundary edge.
    const t = hop === undefined ? 1 : hop / (BLEND_BAND + 1);
    for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
      const solvedWeight = solved.weights[vertex * MAX_INFLUENCES + slot]!;
      if (solvedWeight > 0) {
        const column = columnMap[solved.joints[vertex * MAX_INFLUENCES + slot]!]!;
        if (column >= 0) {
          merged.set(column, (merged.get(column) ?? 0) + solvedWeight * t);
        }
      }
      const existingWeight = weights.weights[vertex * MAX_INFLUENCES + slot]!;
      if (existingWeight > 0 && t < 1) {
        const column = weights.joints[vertex * MAX_INFLUENCES + slot]!;
        merged.set(column, (merged.get(column) ?? 0) + existingWeight * (1 - t));
      }
    }
    const entries = [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_INFLUENCES);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
      const entry = entries[slot];
      weights.joints[vertex * MAX_INFLUENCES + slot] = entry ? entry[0] : 0;
      weights.weights[vertex * MAX_INFLUENCES + slot] = entry
        ? entry[1] / total
        : 0;
    }
    affected.push(vertex);
  }
  return affected;
}

export { BODY_REGION_LABELS };
