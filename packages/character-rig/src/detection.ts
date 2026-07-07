/**
 * packages/character-rig/src/detection.ts
 *
 * Purpose: Plan 062 §062.3 — estimate the wizard's 16 joint
 * landmarks from an upright A/T-pose humanoid mesh. Pure
 * geometry heuristics (horizontal slice statistics + symmetry +
 * extremity analysis) — no ML, per Plan 062 decision 5. The
 * estimates only have to be DECENT: the wizard renders them as
 * draggable markers and the user corrects the misses, so this
 * module optimizes for "usually close" over "always right".
 *
 * Conventions (documented wizard input contract): character
 * upright along +Y, facing +Z, roughly symmetric across the
 * model's own x-center. "Left" landmarks are the character's
 * +X side.
 *
 * Status: active
 */

import { computeMeshBounds, type MeshData } from "./mesh";
import type { Vec3 } from "./math";
import type { RigLandmarks } from "./skeleton";

interface SliceStats {
  y: number;
  count: number;
  minX: number;
  maxX: number;
  /** Cluster count across x: 1 = merged (torso), 2 = split (legs). */
  clusters: number;
  /** Cluster centers, ascending x (defined when clusters === 2). */
  clusterCenters: number[];
}

const SLICE_COUNT = 64;

/**
 * Bucket TRIANGLE-SURFACE samples into horizontal slices and
 * characterize each. Sampling surfaces (not raw vertices) keeps
 * the statistics meaningful on low-poly meshes, where a big quad
 * contributes only 4 corner vertices but spans many slices — the
 * 2026-07-06 A-pose fixture failure.
 */
function computeSliceStats(mesh: MeshData): {
  slices: SliceStats[];
  minY: number;
  height: number;
  centerX: number;
  centerZ: number;
} {
  const bounds = computeMeshBounds(mesh);
  const minY = bounds.min[1];
  const height = Math.max(bounds.max[1] - minY, 1e-6);
  const sampleStep = height / SLICE_COUNT / 2;
  const buckets: number[][] = Array.from({ length: SLICE_COUNT }, () => []);
  let sumX = 0;
  let sumZ = 0;
  let sampleCount = 0;
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i]! * 3;
    const ib = mesh.indices[i + 1]! * 3;
    const ic = mesh.indices[i + 2]! * 3;
    const edge1 = Math.hypot(
      p[ib]! - p[ia]!,
      p[ib + 1]! - p[ia + 1]!,
      p[ib + 2]! - p[ia + 2]!
    );
    const edge2 = Math.hypot(
      p[ic]! - p[ia]!,
      p[ic + 1]! - p[ia + 1]!,
      p[ic + 2]! - p[ia + 2]!
    );
    const steps = Math.min(
      24,
      Math.max(1, Math.ceil(Math.max(edge1, edge2) / sampleStep))
    );
    for (let u = 0; u <= steps; u += 1) {
      for (let v = 0; v <= steps - u; v += 1) {
        const su = u / steps;
        const sv = v / steps;
        const sw = 1 - su - sv;
        const x = p[ia]! * sw + p[ib]! * su + p[ic]! * sv;
        const y = p[ia + 1]! * sw + p[ib + 1]! * su + p[ic + 1]! * sv;
        const z = p[ia + 2]! * sw + p[ib + 2]! * su + p[ic + 2]! * sv;
        const slice = Math.min(
          SLICE_COUNT - 1,
          Math.max(0, Math.floor(((y - minY) / height) * SLICE_COUNT))
        );
        buckets[slice]!.push(x);
        sumX += x;
        sumZ += z;
        sampleCount += 1;
      }
    }
  }
  const centerX = sampleCount > 0 ? sumX / sampleCount : 0;
  const centerZ = sampleCount > 0 ? sumZ / sampleCount : 0;

  const slices: SliceStats[] = buckets.map((bucket, index) => {
    const y = minY + ((index + 0.5) / SLICE_COUNT) * height;
    if (bucket.length === 0) {
      return { y, count: 0, minX: 0, maxX: 0, clusters: 0, clusterCenters: [] };
    }
    const xs = [...bucket].sort((a, b) => a - b);
    const minX = xs[0]!;
    const maxX = xs[xs.length - 1]!;
    // Cluster detection: a gap in sorted x wider than 15% of the
    // slice span (and wider than a floor) splits the slice — the
    // signature of two legs (or two arms in the arm band).
    const span = maxX - minX;
    let clusters = 1;
    let gapAt = 0;
    let widestGap = 0;
    for (let i = 1; i < xs.length; i += 1) {
      const gap = xs[i]! - xs[i - 1]!;
      if (gap > widestGap) {
        widestGap = gap;
        gapAt = (xs[i]! + xs[i - 1]!) / 2;
      }
    }
    if (span > 0 && widestGap > Math.max(span * 0.15, height * 0.02)) {
      clusters = 2;
    }
    const clusterCenters =
      clusters === 2
        ? [
            average(xs.filter((x) => x < gapAt)),
            average(xs.filter((x) => x >= gapAt))
          ]
        : [average(xs)];
    return { y, count: bucket.length, minX, maxX, clusters, clusterCenters };
  });
  return { slices, minY, height, centerX, centerZ };
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Centroid of the k vertices most extreme along +x or -x. */
function extremityCentroid(
  mesh: MeshData,
  direction: 1 | -1,
  fraction: number
): Vec3 {
  const vertexCount = mesh.positions.length / 3;
  const ranked: Array<[number, number]> = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    ranked.push([mesh.positions[vertex * 3]! * direction, vertex]);
  }
  ranked.sort((a, b) => b[0] - a[0]);
  const take = Math.max(1, Math.floor(vertexCount * fraction));
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < take; i += 1) {
    const vertex = ranked[i]![1];
    x += mesh.positions[vertex * 3]!;
    y += mesh.positions[vertex * 3 + 1]!;
    z += mesh.positions[vertex * 3 + 2]!;
  }
  return [x / take, y / take, z / take];
}

/**
 * Estimate all 16 landmarks. Works for both T-pose (arms along
 * +-X) and A-pose (arms angled down ~45 degrees) because arm
 * landmarks derive from the hand extremity + the shoulder, not
 * from assumed arm direction.
 */
export function detectRigLandmarks(mesh: MeshData): RigLandmarks {
  const { slices, minY, height, centerX, centerZ } = computeSliceStats(mesh);
  const atY = (fraction: number) => minY + height * fraction;

  // Crotch: the legs are the CONTIGUOUS run of two-cluster slices
  // starting at the bottom of the model; the crotch is where that
  // run first merges. Stopping at the first merge matters — in
  // A-pose the angled arms create two-cluster slices HIGHER up
  // that must not be mistaken for legs (the 2026-07-06 test
  // failure).
  let crotchY = atY(0.45);
  let sawLegRun = false;
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index]!;
    if (slice.count === 0) continue;
    if (slice.y > atY(0.6)) break;
    if (slice.clusters === 2) {
      sawLegRun = true;
      crotchY = slice.y;
    } else if (sawLegRun) {
      // First merged slice after the leg run — the join.
      crotchY = slice.y;
      break;
    }
  }

  // Leg cluster centers, sampled at mid-leg height — only from
  // slices BELOW the crotch so A-pose arms can't contribute.
  const midLeg = slices.reduce<SliceStats | null>((best, slice) => {
    if (slice.clusters !== 2 || slice.y >= crotchY) return best;
    const target = minY + (crotchY - minY) * 0.5;
    if (!best) return slice;
    return Math.abs(slice.y - target) < Math.abs(best.y - target)
      ? slice
      : best;
  }, null);
  const legOffset = midLeg
    ? (midLeg.clusterCenters[1]! - midLeg.clusterCenters[0]!) / 2
    : height * 0.09;
  const legCenterX = midLeg
    ? (midLeg.clusterCenters[0]! + midLeg.clusterCenters[1]!) / 2
    : centerX;

  // Neck: narrowest slice in the upper band (between shoulders
  // and skull bulge).
  let neckY = atY(0.86);
  let narrowest = Infinity;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    if (slice.y < atY(0.78) || slice.y > atY(0.95)) continue;
    const width = slice.maxX - slice.minX;
    if (width < narrowest) {
      narrowest = width;
      neckY = slice.y;
    }
  }

  // Shoulders: widest slice in the shoulder band. In T-pose the
  // arms dominate the width there, so clamp the shoulder x to the
  // torso edge estimated from the slice just above the neck band
  // torso width at chest height.
  let shoulderY = atY(0.8);
  let widest = 0;
  for (const slice of slices) {
    if (slice.count === 0) continue;
    if (slice.y < atY(0.68) || slice.y > atY(0.85)) continue;
    const width = slice.maxX - slice.minX;
    if (width > widest) {
      widest = width;
      shoulderY = slice.y;
    }
  }
  // Torso half-width: median slice half-span through the belly
  // band, where arms (in T or A pose) don't contribute.
  const bellyWidths = slices
    .filter(
      (slice) =>
        slice.count > 0 && slice.y > crotchY && slice.y < atY(0.62)
    )
    .map((slice) => (slice.maxX - slice.minX) / 2)
    .sort((a, b) => a - b);
  const torsoHalfWidth =
    bellyWidths.length > 0
      ? bellyWidths[Math.floor(bellyWidths.length / 2)]!
      : height * 0.12;

  const wristLeft = extremityCentroid(mesh, 1, 0.01);
  const wristRight = extremityCentroid(mesh, -1, 0.01);
  const shoulderLeft: Vec3 = [
    legCenterX + torsoHalfWidth * 0.9,
    shoulderY,
    centerZ
  ];
  const shoulderRight: Vec3 = [
    legCenterX - torsoHalfWidth * 0.9,
    shoulderY,
    centerZ
  ];
  const midpoint = (a: Vec3, b: Vec3): Vec3 => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2
  ];

  const ankleY = minY + height * 0.06;
  const pelvis: Vec3 = [legCenterX, crotchY + height * 0.04, centerZ];
  const hipLeft: Vec3 = [legCenterX + legOffset, crotchY + height * 0.02, centerZ];
  const hipRight: Vec3 = [legCenterX - legOffset, crotchY + height * 0.02, centerZ];
  const ankleLeft: Vec3 = [legCenterX + legOffset, ankleY, centerZ];
  const ankleRight: Vec3 = [legCenterX - legOffset, ankleY, centerZ];

  return {
    pelvis,
    chest: [legCenterX, shoulderY - height * 0.06, centerZ],
    neck: [legCenterX, neckY, centerZ],
    head: [legCenterX, neckY + (minY + height - neckY) * 0.35, centerZ],
    shoulderLeft,
    elbowLeft: midpoint(shoulderLeft, wristLeft),
    wristLeft,
    shoulderRight,
    elbowRight: midpoint(shoulderRight, wristRight),
    wristRight,
    hipLeft,
    kneeLeft: midpoint(hipLeft, ankleLeft),
    ankleLeft,
    hipRight,
    kneeRight: midpoint(hipRight, ankleRight),
    ankleRight
  } as RigLandmarks;
}
