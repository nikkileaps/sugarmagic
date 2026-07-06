/**
 * packages/character-rig/src/weights.ts
 *
 * Purpose: Plan 062 §062.2 — automatic skin weights via geodesic
 * voxel binding (Dionne & de Lasa, SCA 2013 — Plan 062 decision
 * 2). Per bone segment: seed the voxels the segment passes
 * through, run Dijkstra over the traversable (surface+interior)
 * voxel graph with 26-neighbor Euclidean costs, then per vertex
 * convert the per-bone geodesic distances into inverse-square
 * falloff weights, keep the top 4, normalize, and Laplacian-
 * smooth over the mesh adjacency.
 *
 * `WeightSolver` is the Strategy seam (Plan 062 architecture): a
 * refine-weights brush or a better solver later slots in behind
 * the same interface without touching the pipeline.
 *
 * Status: active
 */

import { buildVertexAdjacency, type MeshData } from "./mesh";
import { vec3Distance, vec3Lerp, type Vec3 } from "./math";
import type { BoneSegment } from "./skeleton";
import {
  VOXEL_EMPTY,
  voxelIndex,
  voxelizeMesh,
  worldToVoxel,
  type VoxelGrid
} from "./voxel";

export const MAX_INFLUENCES = 4;

export interface SkinWeights {
  /** Bone name per influence column, indexed by the values in `joints`. */
  boneOrder: string[];
  /** 4 influence indices per vertex (into boneOrder). */
  joints: Uint16Array;
  /** 4 normalized weights per vertex. */
  weights: Float32Array;
}

export interface WeightSolveOptions {
  /** Longest-axis voxel count. Default 96 (Plan 062 range 64-128). */
  resolution?: number;
  /** Laplacian smoothing iterations over mesh adjacency. Default 2. */
  smoothingIterations?: number;
  onProgress?: (fraction: number) => void;
}

/** The Strategy seam: solve(mesh, segments) -> per-vertex weights. */
export interface WeightSolver {
  solve(
    mesh: MeshData,
    segments: BoneSegment[],
    options?: WeightSolveOptions
  ): SkinWeights;
}

const NEIGHBOR_OFFSETS: Array<[number, number, number]> = [];
for (let dz = -1; dz <= 1; dz += 1) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      NEIGHBOR_OFFSETS.push([dx, dy, dz]);
    }
  }
}

/** Binary min-heap over (distance, voxelIndex) pairs. */
class MinHeap {
  private items: Array<[number, number]> = [];
  get size(): number {
    return this.items.length;
  }
  push(distance: number, index: number): void {
    this.items.push([distance, index]);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]![0] <= this.items[i]![0]) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }
  pop(): [number, number] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (
          left < this.items.length &&
          this.items[left]![0] < this.items[smallest]![0]
        ) {
          smallest = left;
        }
        if (
          right < this.items.length &&
          this.items[right]![0] < this.items[smallest]![0]
        ) {
          smallest = right;
        }
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i]!, this.items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Seed voxels for a bone segment: sample along start->end, snap
 * each sample to the grid; samples landing in EMPTY cells (user
 * placed a marker slightly outside the body, or the rig's derived
 * finger bones overshoot a mitten hand) snap to the nearest
 * traversable voxel within a small radius.
 */
function seedSegment(grid: VoxelGrid, segment: BoneSegment): number[] {
  const seeds = new Set<number>();
  const steps = Math.max(
    1,
    Math.ceil(vec3Distance(segment.start, segment.end) / grid.cellSize) * 2
  );
  for (let step = 0; step <= steps; step += 1) {
    const point = vec3Lerp(segment.start, segment.end, step / steps);
    const [x, y, z] = worldToVoxel(grid, point);
    const index = voxelIndex(grid, x, y, z);
    if (grid.cells[index] !== VOXEL_EMPTY) {
      seeds.add(index);
      continue;
    }
    // Snap outward: expanding cube search, radius up to 3 cells.
    let snapped = -1;
    let bestDistance = Infinity;
    for (let radius = 1; radius <= 3 && snapped === -1; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            if (
              nx < 0 || ny < 0 || nz < 0 ||
              nx >= grid.dims[0] || ny >= grid.dims[1] || nz >= grid.dims[2]
            ) {
              continue;
            }
            const neighborIndex = voxelIndex(grid, nx, ny, nz);
            if (grid.cells[neighborIndex] === VOXEL_EMPTY) continue;
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance < bestDistance) {
              bestDistance = distance;
              snapped = neighborIndex;
            }
          }
        }
      }
    }
    if (snapped !== -1) seeds.add(snapped);
  }
  return [...seeds];
}

/** Multi-source Dijkstra over traversable voxels; returns distances.
 *  Float64 on purpose: storing f32 while comparing f64 heap keys
 *  lets rounding re-qualify the same relaxation forever (the
 *  2026-07-06 hang — the heap ballooned to GBs). */
function geodesicDistances(grid: VoxelGrid, seeds: number[]): Float64Array {
  const distances = new Float64Array(grid.cells.length).fill(Infinity);
  const heap = new MinHeap();
  for (const seed of seeds) {
    distances[seed] = 0;
    heap.push(0, seed);
  }
  const [dx, dy] = [grid.dims[0], grid.dims[1]];
  while (heap.size > 0) {
    const [distance, index] = heap.pop()!;
    if (distance > distances[index]!) continue;
    const x = index % dx;
    const y = Math.floor(index / dx) % dy;
    const z = Math.floor(index / (dx * dy));
    for (const [ox, oy, oz] of NEIGHBOR_OFFSETS) {
      const nx = x + ox;
      const ny = y + oy;
      const nz = z + oz;
      if (
        nx < 0 || ny < 0 || nz < 0 ||
        nx >= grid.dims[0] || ny >= grid.dims[1] || nz >= grid.dims[2]
      ) {
        continue;
      }
      const neighborIndex = voxelIndex(grid, nx, ny, nz);
      if (grid.cells[neighborIndex] === VOXEL_EMPTY) continue;
      const step = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const next = distance + step;
      if (next < distances[neighborIndex]!) {
        distances[neighborIndex] = next;
        heap.push(next, neighborIndex);
      }
    }
  }
  return distances;
}

export class GeodesicVoxelWeightSolver implements WeightSolver {
  solve(
    mesh: MeshData,
    segments: BoneSegment[],
    options: WeightSolveOptions = {}
  ): SkinWeights {
    const resolution = options.resolution ?? 96;
    const smoothingIterations = options.smoothingIterations ?? 2;
    const grid = voxelizeMesh(mesh, resolution);
    options.onProgress?.(0.1);

    // Per-bone geodesic distance fields.
    const boneOrder = segments.map((segment) => segment.boneName);
    const fields: Float64Array[] = [];
    segments.forEach((segment, index) => {
      const seeds = seedSegment(grid, segment);
      fields.push(
        seeds.length > 0
          ? geodesicDistances(grid, seeds)
          : new Float64Array(grid.cells.length).fill(Infinity)
      );
      options.onProgress?.(0.1 + 0.7 * ((index + 1) / segments.length));
    });

    // Per-vertex: inverse-square falloff over per-bone distances at
    // the vertex's voxel; keep top MAX_INFLUENCES; normalize.
    const vertexCount = mesh.positions.length / 3;
    const raw = new Float32Array(vertexCount * boneOrder.length);
    const epsilon = grid.cellSize * 0.5;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const position: Vec3 = [
        mesh.positions[vertex * 3]!,
        mesh.positions[vertex * 3 + 1]!,
        mesh.positions[vertex * 3 + 2]!
      ];
      const [x, y, z] = worldToVoxel(grid, position);
      const index = voxelIndex(grid, x, y, z);
      for (let bone = 0; bone < fields.length; bone += 1) {
        const distance = fields[bone]![index]!;
        raw[vertex * boneOrder.length + bone] = Number.isFinite(distance)
          ? 1 / ((distance * grid.cellSize + epsilon) ** 2)
          : 0;
      }
    }

    // Laplacian smoothing over mesh adjacency, then top-4 +
    // normalize.
    const adjacency =
      smoothingIterations > 0 ? buildVertexAdjacency(mesh) : [];
    let current = raw;
    for (let iteration = 0; iteration < smoothingIterations; iteration += 1) {
      const next = new Float32Array(current.length);
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const neighbors = adjacency[vertex]!;
        for (let bone = 0; bone < boneOrder.length; bone += 1) {
          let sum = current[vertex * boneOrder.length + bone]!;
          for (const neighbor of neighbors) {
            sum += current[neighbor * boneOrder.length + bone]!;
          }
          next[vertex * boneOrder.length + bone] = sum / (neighbors.size + 1);
        }
      }
      current = next;
    }

    const joints = new Uint16Array(vertexCount * MAX_INFLUENCES);
    const weights = new Float32Array(vertexCount * MAX_INFLUENCES);
    const candidate: Array<[number, number]> = [];
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      candidate.length = 0;
      for (let bone = 0; bone < boneOrder.length; bone += 1) {
        const value = current[vertex * boneOrder.length + bone]!;
        if (value > 0) candidate.push([value, bone]);
      }
      candidate.sort((a, b) => b[0] - a[0]);
      const top = candidate.slice(0, MAX_INFLUENCES);
      const total = top.reduce((sum, [value]) => sum + value, 0);
      for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
        const entry = top[slot];
        joints[vertex * MAX_INFLUENCES + slot] = entry ? entry[1] : 0;
        weights[vertex * MAX_INFLUENCES + slot] =
          entry && total > 0 ? entry[0] / total : slot === 0 ? 1 : 0;
      }
    }
    options.onProgress?.(1);
    return { boneOrder, joints, weights };
  }
}
