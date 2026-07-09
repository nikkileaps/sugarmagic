/**
 * packages/character-rig/src/weight-transfer.ts
 *
 * Purpose: Plan 064 — "shrinkwrap weights": robust skin-weight
 * transfer from a source piece (the body) onto a target piece
 * (a garment), after Abdrashitov et al., "Robust Skin Weights
 * Transfer via Weight Inpainting" (SIGGRAPH Asia 2023).
 *
 * Two stages:
 *  1. CONFIDENT COPY — for each target vertex, the closest point
 *     on the source SURFACE (point-to-triangle, barycentric-
 *     interpolated weights). The match is kept only when it is
 *     trustworthy: distance below a threshold AND the normals
 *     roughly agree. Armpit pockets and loose flaps FAIL the test
 *     on purpose — copying there is what made naive nearest-vertex
 *     transfer lie.
 *  2. INPAINTING — unmatched vertices receive weights by Laplacian
 *     diffusion over the target's own topology from the confident
 *     ones (Jacobi iterations with Dirichlet boundary at matched
 *     vertices): the armpit gets a smooth interpolation of the
 *     good sleeve + good torso weights around it.
 *
 * Pure and dependency-free like the rest of this package.
 *
 * Status: active
 */

import { MAX_INFLUENCES, type SkinWeights } from "./weights";
import { buildVertexAdjacency, type MeshData } from "./mesh";

export interface ShrinkwrapOptions {
  /** Max match distance; default 4% of the source bbox diagonal. */
  distanceThreshold?: number;
  /** Max normal disagreement, degrees; default 50. */
  normalThresholdDeg?: number;
  /** Inpainting iteration cap; default 400. */
  maxIterations?: number;
}

export interface ShrinkwrapResult {
  /** Vertices weighted by direct confident copy. */
  matched: number;
  /** Vertices filled by inpainting. */
  inpainted: number;
  /** Vertices left untouched (no confident data reachable). */
  untouched: number;
  affected: number[];
}

/** Area-weighted vertex normals for the whole mesh. */
function computeVertexNormals(mesh: MeshData): Float32Array {
  const normals = new Float32Array(mesh.positions.length);
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
    const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax, uy = p[b * 3 + 1]! - ay, uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax, vy = p[c * 3 + 1]! - ay, vz = p[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) {
      normals[vertex * 3] += nx;
      normals[vertex * 3 + 1] += ny;
      normals[vertex * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length / 3; v += 1) {
    const length = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!) || 1;
    normals[v * 3] /= length;
    normals[v * 3 + 1] /= length;
    normals[v * 3 + 2] /= length;
  }
  return normals;
}

/** Closest point on triangle abc to p (Ericson, RTCD ch. 5). */
function closestPointOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: { x: number; y: number; z: number; u: number; v: number; w: number }
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.x = ax; out.y = ay; out.z = az; out.u = 1; out.v = 0; out.w = 0;
    return;
  }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.x = bx; out.y = by; out.z = bz; out.u = 0; out.v = 1; out.w = 0;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    out.x = ax + abx * t; out.y = ay + aby * t; out.z = az + abz * t;
    out.u = 1 - t; out.v = t; out.w = 0;
    return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.x = cx; out.y = cy; out.z = cz; out.u = 0; out.v = 0; out.w = 1;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    out.x = ax + acx * t; out.y = ay + acy * t; out.z = az + acz * t;
    out.u = 1 - t; out.v = 0; out.w = t;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out.x = bx + (cx - bx) * t; out.y = by + (cy - by) * t; out.z = bz + (cz - bz) * t;
    out.u = 0; out.v = 1 - t; out.w = t;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out.x = ax + abx * v + acx * w;
  out.y = ay + aby * v + acy * w;
  out.z = az + abz * v + acz * w;
  out.u = 1 - v - w; out.v = v; out.w = w;
}

/**
 * Transfer weights from `source` piece onto `target` vertices.
 * Mutates `weights` for target vertices; returns match statistics.
 */
export function shrinkwrapWeights(
  mesh: MeshData,
  weights: SkinWeights,
  target: ReadonlySet<number> | { start: number; end: number },
  /** One or several source pieces. Layered outfits cascade: wrap
   *  the innermost garment from the body, then each outer layer
   *  from EVERYTHING beneath it — an open jacket's front panels
   *  match the shirt they hang over, not the body two layers
   *  down (the arm-flooded-front bug, 2026-07-08). */
  source: { start: number; end: number } | Array<{ start: number; end: number }>,
  options: ShrinkwrapOptions = {}
): ShrinkwrapResult {
  const sources = Array.isArray(source) ? source : [source];
  const targetVerts: number[] =
    target instanceof Set || (typeof (target as Set<number>).has === "function")
      ? [...(target as ReadonlySet<number>)]
      : Array.from(
          { length: (target as { start: number; end: number }).end -
            (target as { start: number; end: number }).start },
          (_, i) => (target as { start: number; end: number }).start + i
        );
  const targetSet = new Set(targetVerts);
  const p = mesh.positions;

  // Source triangles (fully inside the source window) + bbox.
  const sourceTris: number[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const inAnySource = (vertex: number) =>
    sources.some((window) => vertex >= window.start && vertex < window.end);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
    if (inAnySource(a) && inAnySource(b) && inAnySource(c)) {
      sourceTris.push(t);
    }
  }
  for (const window of sources) {
    for (let v = window.start; v < window.end; v += 1) {
      minX = Math.min(minX, p[v * 3]!); maxX = Math.max(maxX, p[v * 3]!);
      minY = Math.min(minY, p[v * 3 + 1]!); maxY = Math.max(maxY, p[v * 3 + 1]!);
      minZ = Math.min(minZ, p[v * 3 + 2]!); maxZ = Math.max(maxZ, p[v * 3 + 2]!);
    }
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const dMax = options.distanceThreshold ?? diagonal * 0.04;
  const cosThreshold = Math.cos(
    ((options.normalThresholdDeg ?? 50) * Math.PI) / 180
  );
  if (!(dMax > 0) || sourceTris.length === 0 || targetVerts.length === 0) {
    return { matched: 0, inpainted: 0, untouched: targetVerts.length, affected: [] };
  }

  const normals = computeVertexNormals(mesh);

  // Triangle grid, cell = dMax: a target vertex only needs cells
  // within one step (matches beyond dMax are rejected anyway).
  const cell = dMax;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}:${Math.floor(z / cell)}`;
  for (const t of sourceTris) {
    const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
    const txMin = Math.min(p[a * 3]!, p[b * 3]!, p[c * 3]!);
    const txMax = Math.max(p[a * 3]!, p[b * 3]!, p[c * 3]!);
    const tyMin = Math.min(p[a * 3 + 1]!, p[b * 3 + 1]!, p[c * 3 + 1]!);
    const tyMax = Math.max(p[a * 3 + 1]!, p[b * 3 + 1]!, p[c * 3 + 1]!);
    const tzMin = Math.min(p[a * 3 + 2]!, p[b * 3 + 2]!, p[c * 3 + 2]!);
    const tzMax = Math.max(p[a * 3 + 2]!, p[b * 3 + 2]!, p[c * 3 + 2]!);
    for (let gx = Math.floor(txMin / cell); gx <= Math.floor(txMax / cell); gx += 1) {
      for (let gy = Math.floor(tyMin / cell); gy <= Math.floor(tyMax / cell); gy += 1) {
        for (let gz = Math.floor(tzMin / cell); gz <= Math.floor(tzMax / cell); gz += 1) {
          const key = `${gx}:${gy}:${gz}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(t);
          else grid.set(key, [t]);
        }
      }
    }
  }

  // Stage 1: confident matches.
  // Dense per-vertex weights over the union of bone columns seen.
  const columnIndex = new Map<number, number>();
  const vertexData = new Map<number, Float32Array<ArrayBufferLike>>();
  const matchedSet = new Set<number>();
  const out = { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 };
  const growData = (
    data: Float32Array<ArrayBufferLike>
  ): Float32Array<ArrayBufferLike> => {
    const next = new Float32Array(columnIndex.size);
    next.set(data);
    return next;
  };
  const columnSlot = (column: number): number => {
    let slot = columnIndex.get(column);
    if (slot === undefined) {
      slot = columnIndex.size;
      columnIndex.set(column, slot);
    }
    return slot;
  };

  for (const vertex of targetVerts) {
    const vx = p[vertex * 3]!, vy = p[vertex * 3 + 1]!, vz = p[vertex * 3 + 2]!;
    const gx = Math.floor(vx / cell), gy = Math.floor(vy / cell), gz = Math.floor(vz / cell);
    let bestSq = dMax * dMax;
    let best: { tri: number; u: number; v: number; w: number } | null = null;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = grid.get(`${gx + ox}:${gy + oy}:${gz + oz}`);
          if (!bucket) continue;
          for (const t of bucket) {
            const a = mesh.indices[t]!, b = mesh.indices[t + 1]!, c = mesh.indices[t + 2]!;
            closestPointOnTriangle(
              vx, vy, vz,
              p[a * 3]!, p[a * 3 + 1]!, p[a * 3 + 2]!,
              p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]!,
              p[c * 3]!, p[c * 3 + 1]!, p[c * 3 + 2]!,
              out
            );
            const dx = out.x - vx, dy = out.y - vy, dz = out.z - vz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < bestSq) {
              bestSq = distSq;
              best = { tri: t, u: out.u, v: out.v, w: out.w };
            }
          }
        }
      }
    }
    if (!best) continue;
    // Normal gate: target vertex normal vs interpolated source
    // vertex normals at the match point.
    const a = mesh.indices[best.tri]!, b = mesh.indices[best.tri + 1]!, c = mesh.indices[best.tri + 2]!;
    const snx = normals[a * 3]! * best.u + normals[b * 3]! * best.v + normals[c * 3]! * best.w;
    const sny = normals[a * 3 + 1]! * best.u + normals[b * 3 + 1]! * best.v + normals[c * 3 + 1]! * best.w;
    const snz = normals[a * 3 + 2]! * best.u + normals[b * 3 + 2]! * best.v + normals[c * 3 + 2]! * best.w;
    const dot =
      normals[vertex * 3]! * snx +
      normals[vertex * 3 + 1]! * sny +
      normals[vertex * 3 + 2]! * snz;
    if (dot < cosThreshold) continue;

    // Barycentric-interpolated weights from the triangle corners.
    let data: Float32Array<ArrayBufferLike> = new Float32Array(columnIndex.size);
    for (const [corner, bary] of [[a, best.u], [b, best.v], [c, best.w]] as const) {
      if (bary <= 0) continue;
      for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
        const weight = weights.weights[corner * MAX_INFLUENCES + slot]!;
        if (weight <= 0) continue;
        const column = weights.joints[corner * MAX_INFLUENCES + slot]!;
        const idx = columnSlot(column);
        if (idx >= data.length) data = growData(data);
        data[idx] += weight * bary;
      }
    }
    vertexData.set(vertex, data);
    matchedSet.add(vertex);
  }

  // Stage 2: inpainting — Jacobi diffusion over target adjacency,
  // Dirichlet at matched vertices.
  const adjacency = buildVertexAdjacency(mesh);
  const columns = columnIndex.size;
  const unmatched = targetVerts.filter((vertex) => !matchedSet.has(vertex));
  const maxIterations = options.maxIterations ?? 400;
  if (columns > 0 && unmatched.length > 0 && matchedSet.size > 0) {
    // Normalize matched data first (barycentric sums may be < 1).
    for (const vertex of matchedSet) {
      const data = vertexData.get(vertex)!;
      let total = 0;
      for (let i = 0; i < data.length; i += 1) total += data[i]!;
      if (total > 0) for (let i = 0; i < data.length; i += 1) data[i] = data[i]! / total;
    }
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let maxDelta = 0;
      for (const vertex of unmatched) {
        const neighbors = adjacency[vertex];
        if (!neighbors) continue;
        const sum = new Float32Array(columns);
        let count = 0;
        for (const neighbor of neighbors) {
          if (!targetSet.has(neighbor)) continue;
          const data = vertexData.get(neighbor);
          if (!data) continue;
          for (let i = 0; i < data.length; i += 1) sum[i] = sum[i]! + data[i]!;
          count += 1;
        }
        if (count === 0) continue;
        for (let i = 0; i < columns; i += 1) sum[i] = sum[i]! / count;
        const previous = vertexData.get(vertex);
        if (previous) {
          for (let i = 0; i < Math.min(previous.length, columns); i += 1) {
            maxDelta = Math.max(maxDelta, Math.abs(sum[i]! - (previous[i] ?? 0)));
          }
        } else {
          maxDelta = 1;
        }
        vertexData.set(vertex, sum);
      }
      if (maxDelta < 1e-4 && iteration > 4) break;
    }
  }

  // Write back: top-4 normalized. Vertices with no data stay put.
  const columnsByIndex = new Array<number>(columnIndex.size);
  for (const [column, idx] of columnIndex) columnsByIndex[idx] = column;
  const affected: number[] = [];
  let inpainted = 0;
  let untouched = 0;
  for (const vertex of targetVerts) {
    const data = vertexData.get(vertex);
    if (!data) {
      untouched += 1;
      continue;
    }
    const entries: Array<[number, number]> = [];
    for (let i = 0; i < data.length; i += 1) {
      if (data[i]! > 0.001) entries.push([columnsByIndex[i]!, data[i]!]);
    }
    entries.sort((x, y) => y[1] - x[1]);
    const kept = entries.slice(0, MAX_INFLUENCES);
    const total = kept.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
      const entry = kept[slot];
      weights.joints[vertex * MAX_INFLUENCES + slot] = entry ? entry[0] : 0;
      weights.weights[vertex * MAX_INFLUENCES + slot] = entry
        ? entry[1] / total
        : 0;
    }
    affected.push(vertex);
    if (!matchedSet.has(vertex)) inpainted += 1;
  }
  return { matched: matchedSet.size, inpainted, untouched, affected };
}
