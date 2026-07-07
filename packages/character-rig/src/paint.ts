/**
 * packages/character-rig/src/paint.ts
 *
 * Purpose: Plan 062 §062.8 — pure weight-painting operations over
 * a `SkinWeights` result. The wizard's paint viewport is a thin
 * shell around these: every brush stroke is an in-place edit of
 * the (joints, weights) arrays with per-vertex renormalization
 * and the 4-influence cap preserved, so the painted result feeds
 * straight back into `buildSkinnedCharacterGlb` unchanged.
 *
 * All functions operate on the flattened vertex space the solver
 * produced (the extraction order), keeping them mesh-library-free
 * and unit-testable.
 *
 * Status: active
 */

import { MAX_INFLUENCES, type SkinWeights } from "./weights";
import { buildVertexAdjacency, type MeshData } from "./mesh";

export type BrushMode = "add" | "subtract" | "smooth" | "fill";

export interface BrushStroke {
  /** World-space brush center. */
  center: [number, number, number];
  /** World-space brush radius. */
  radius: number;
  /** Column index into `weights.boneOrder` being painted. */
  boneColumn: number;
  /** Peak strength at the brush center, 0..1 per stroke step. */
  strength: number;
  mode: BrushMode;
  /** Restrict the stroke to one mesh piece (flattened vertex
   *  window) — layered characters (jacket over shirt over body,
   *  tail behind torso) need isolation or the 3D brush paints
   *  through everything (nikki, 2026-07-06). */
  vertexWindow?: { start: number; end: number };
}

/** Weight of a bone column at a vertex (0 when uninfluenced). */
export function boneWeightOfVertex(
  weights: SkinWeights,
  vertex: number,
  boneColumn: number
): number {
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    if (weights.joints[vertex * MAX_INFLUENCES + slot] === boneColumn) {
      return weights.weights[vertex * MAX_INFLUENCES + slot]!;
    }
  }
  return 0;
}

/**
 * Set a bone's weight at one vertex to `target` (clamped 0..1),
 * rescaling the OTHER influences proportionally into the
 * remainder and keeping only the strongest 4 overall.
 */
export function setBoneWeightAtVertex(
  weights: SkinWeights,
  vertex: number,
  boneColumn: number,
  target: number
): void {
  const clamped = Math.max(0, Math.min(1, target));
  // Collect current influences excluding the painted bone.
  const others: Array<[number, number]> = [];
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    const column = weights.joints[vertex * MAX_INFLUENCES + slot]!;
    const weight = weights.weights[vertex * MAX_INFLUENCES + slot]!;
    if (column !== boneColumn && weight > 0) others.push([column, weight]);
  }
  const othersTotal = others.reduce((sum, [, weight]) => sum + weight, 0);
  const remainder = 1 - clamped;
  const scale = othersTotal > 0 ? remainder / othersTotal : 0;
  const entries: Array<[number, number]> = [];
  if (clamped > 0) entries.push([boneColumn, clamped]);
  for (const [column, weight] of others) {
    const scaled = weight * scale;
    if (scaled > 0.0005) entries.push([column, scaled]);
  }
  // Nothing left (painted to 0 with no other influences): keep the
  // strongest previous other influence at full rather than leaving
  // the vertex unbound.
  if (entries.length === 0) {
    const strongest = others.sort((a, b) => b[1] - a[1])[0];
    entries.push(strongest ? [strongest[0], 1] : [boneColumn, 1]);
  }
  entries.sort((a, b) => b[1] - a[1]);
  const kept = entries.slice(0, MAX_INFLUENCES);
  const total = kept.reduce((sum, [, weight]) => sum + weight, 0);
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    const entry = kept[slot];
    weights.joints[vertex * MAX_INFLUENCES + slot] = entry ? entry[0] : 0;
    weights.weights[vertex * MAX_INFLUENCES + slot] = entry
      ? entry[1] / total
      : 0;
  }
}

/**
 * Apply one brush stroke step. Falloff is smooth (cosine) from
 * center to radius. Returns the affected vertex indices (for
 * heatmap refresh).
 */
/**
 * Strongest non-`boneColumn` influence at a vertex, or -1.
 */
function otherInfluenceAt(
  weights: SkinWeights,
  vertex: number,
  boneColumn: number
): number {
  let best = -1;
  let bestWeight = 0;
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    const column = weights.joints[vertex * MAX_INFLUENCES + slot]!;
    const weight = weights.weights[vertex * MAX_INFLUENCES + slot]!;
    if (column !== boneColumn && weight > bestWeight) {
      bestWeight = weight;
      best = column;
    }
  }
  return best;
}

/**
 * BFS through mesh adjacency for the nearest vertex carrying an
 * influence other than `boneColumn`; returns that bone, or -1.
 * Bounded so a stroke can't stall on a fully-filled shell.
 */
function findTerritorialFallback(
  weights: SkinWeights,
  adjacency: Array<Set<number>>,
  start: number,
  boneColumn: number
): number {
  const visited = new Set<number>([start]);
  let frontier = [start];
  let budget = 6000;
  while (frontier.length > 0 && budget > 0) {
    const next: number[] = [];
    for (const vertex of frontier) {
      const neighbors = adjacency[vertex];
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        budget -= 1;
        const other = otherInfluenceAt(weights, neighbor, boneColumn);
        if (other !== -1) return other;
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return -1;
}

export function applyBrushStroke(
  mesh: MeshData,
  weights: SkinWeights,
  stroke: BrushStroke,
  /** Reused adjacency for smooth mode; build once per session. */
  adjacency?: Array<Set<number>>
): number[] {
  const affected: number[] = [];
  // Deep inside a Fill-swept region every neighbor is also 100%
  // the subtracted bone — resolve ONE territorial fallback per
  // stroke (BFS to the nearest differently-owned territory) and
  // reuse it for every sole-influence vertex this stroke touches
  // (2026-07-06: "can't subtract after fill").
  let strokeFallback: number | null = null;
  const vertexCount = mesh.positions.length / 3;
  const radiusSq = stroke.radius * stroke.radius;
  const first = stroke.vertexWindow?.start ?? 0;
  const last = Math.min(stroke.vertexWindow?.end ?? vertexCount, vertexCount);
  for (let vertex = first; vertex < last; vertex += 1) {
    const dx = mesh.positions[vertex * 3]! - stroke.center[0];
    const dy = mesh.positions[vertex * 3 + 1]! - stroke.center[1];
    const dz = mesh.positions[vertex * 3 + 2]! - stroke.center[2];
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > radiusSq) continue;
    const falloff =
      0.5 * (1 + Math.cos((Math.sqrt(distanceSq) / stroke.radius) * Math.PI));
    const current = boneWeightOfVertex(weights, vertex, stroke.boneColumn);
    if (stroke.mode === "fill") {
      // Hard assignment, no falloff — sweep a region (a tail baked
      // into the body piece) to rigid single-bone ownership.
      setBoneWeightAtVertex(weights, vertex, stroke.boneColumn, 1);
    } else if (stroke.mode === "add") {
      setBoneWeightAtVertex(
        weights,
        vertex,
        stroke.boneColumn,
        current + stroke.strength * falloff
      );
    } else if (stroke.mode === "subtract") {
      const target = current - stroke.strength * falloff;
      // Sole-influence escape hatch (2026-07-06, the third time
      // this trap bit): a vertex owned 100% by the subtracted
      // bone has nowhere to put the remainder and renormalizes
      // straight back — subtract visibly does nothing. Borrow the
      // receiving bone from the NEIGHBORHOOD: the strongest
      // non-subtracted influence among adjacent vertices (stray
      // tail-painted vertices on the head bleed back to Head).
      if (current > 0.999 && target < current) {
        const neighbors = adjacency?.[vertex];
        let fallback = -1;
        let fallbackWeight = 0;
        if (neighbors) {
          const totals = new Map<number, number>();
          for (const neighbor of neighbors) {
            for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
              const column = weights.joints[neighbor * MAX_INFLUENCES + slot]!;
              const weight = weights.weights[neighbor * MAX_INFLUENCES + slot]!;
              if (column === stroke.boneColumn || weight <= 0) continue;
              const total = (totals.get(column) ?? 0) + weight;
              totals.set(column, total);
              if (total > fallbackWeight) {
                fallbackWeight = total;
                fallback = column;
              }
            }
          }
        }
        if (fallback === -1 && adjacency) {
          if (strokeFallback === null) {
            strokeFallback = findTerritorialFallback(
              weights,
              adjacency,
              vertex,
              stroke.boneColumn
            );
          }
          fallback = strokeFallback;
        }
        if (fallback !== -1) {
          const kept = Math.max(0, Math.min(1, target));
          weights.joints[vertex * MAX_INFLUENCES] = stroke.boneColumn;
          weights.weights[vertex * MAX_INFLUENCES] = kept;
          weights.joints[vertex * MAX_INFLUENCES + 1] = fallback;
          weights.weights[vertex * MAX_INFLUENCES + 1] = 1 - kept;
          for (let slot = 2; slot < MAX_INFLUENCES; slot += 1) {
            weights.joints[vertex * MAX_INFLUENCES + slot] = 0;
            weights.weights[vertex * MAX_INFLUENCES + slot] = 0;
          }
        }
        // No neighbor fallback (isolated island fully owned by the
        // bone): nothing sane to transfer to; leave it.
      } else {
        setBoneWeightAtVertex(weights, vertex, stroke.boneColumn, target);
      }
    } else {
      // Smooth: move toward the neighborhood average of this
      // bone's weight.
      const neighbors = adjacency?.[vertex];
      if (!neighbors || neighbors.size === 0) continue;
      let sum = current;
      for (const neighbor of neighbors) {
        sum += boneWeightOfVertex(weights, neighbor, stroke.boneColumn);
      }
      const average = sum / (neighbors.size + 1);
      setBoneWeightAtVertex(
        weights,
        vertex,
        stroke.boneColumn,
        current + (average - current) * stroke.strength * falloff
      );
    }
    affected.push(vertex);
  }
  return affected;
}

/**
 * Assign an entire vertex window rigidly to one bone — the
 * one-click answer for separate-shell pieces (a tail with no tail
 * bones, eyes, accessories) where brushwork is the wrong tool.
 */
export function fillVerticesWithBone(
  weights: SkinWeights,
  window: { start: number; end: number },
  boneColumn: number
): number[] {
  const affected: number[] = [];
  for (let vertex = window.start; vertex < window.end; vertex += 1) {
    setBoneWeightAtVertex(weights, vertex, boneColumn, 1);
    affected.push(vertex);
  }
  return affected;
}

/** Swap a bone name's .L/.R suffix ("DEF-hand.L" -> "DEF-hand.R"). */
function mirrorBoneName(name: string): string {
  if (name.endsWith(".L")) return `${name.slice(0, -2)}.R`;
  if (name.endsWith(".R")) return `${name.slice(0, -2)}.L`;
  return name;
}

/**
 * Mirror weights across the character's sagittal plane (x = 0):
 * every vertex on the TARGET side receives the weights of its
 * nearest mirror-twin on the source side, with .L/.R bone columns
 * swapped. Twins are matched by position via a spatial hash;
 * vertices with no twin within tolerance (asymmetric details) are
 * left untouched. Returns the affected vertex indices.
 */
export function mirrorWeights(
  mesh: MeshData,
  weights: SkinWeights,
  options: {
    /** "leftToRight" copies +x onto -x (left is +x). */
    direction: "leftToRight" | "rightToLeft";
    /** Restrict to one piece (flattened vertex window). */
    vertexWindow?: { start: number; end: number };
    /** Match tolerance; defaults to 0.5% of the bounding-box
     *  diagonal. */
    tolerance?: number;
  }
): number[] {
  const vertexCount = mesh.positions.length / 3;
  const first = options.vertexWindow?.start ?? 0;
  const last = Math.min(options.vertexWindow?.end ?? vertexCount, vertexCount);

  // Bounding box for the default tolerance.
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let v = first; v < last; v += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[v * 3 + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const diagonal = Math.hypot(
    max[0]! - min[0]!,
    max[1]! - min[1]!,
    max[2]! - min[2]!
  );
  const tolerance = options.tolerance ?? diagonal * 0.005;
  if (!(tolerance > 0)) return [];

  // Column -> mirrored column via bone-name suffix swap.
  const columnMirror = weights.boneOrder.map((name) => {
    const mirrored = weights.boneOrder.indexOf(mirrorBoneName(name));
    return mirrored === -1 ? weights.boneOrder.indexOf(name) : mirrored;
  });

  const sourceIsLeft = options.direction === "leftToRight";
  // Spatial hash of SOURCE-side vertices.
  const cell = tolerance * 2;
  const hash = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)}:${Math.floor(y / cell)}:${Math.floor(z / cell)}`;
  for (let v = first; v < last; v += 1) {
    const x = mesh.positions[v * 3]!;
    if (sourceIsLeft ? x < 0 : x > 0) continue;
    const key = keyOf(x, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!);
    const bucket = hash.get(key);
    if (bucket) bucket.push(v);
    else hash.set(key, [v]);
  }

  const affected: number[] = [];
  const toleranceSq = tolerance * tolerance;
  for (let v = first; v < last; v += 1) {
    const x = mesh.positions[v * 3]!;
    // Target side only (strictly past the plane; the seam row
    // belongs to both and is left as painted).
    if (sourceIsLeft ? x >= 0 : x <= 0) continue;
    const mx = -x;
    const my = mesh.positions[v * 3 + 1]!;
    const mz = mesh.positions[v * 3 + 2]!;
    let best = -1;
    let bestSq = toleranceSq;
    const cx = Math.floor(mx / cell);
    const cy = Math.floor(my / cell);
    const cz = Math.floor(mz / cell);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const bucket = hash.get(`${cx + ox}:${cy + oy}:${cz + oz}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            const dx = mesh.positions[candidate * 3]! - mx;
            const dy = mesh.positions[candidate * 3 + 1]! - my;
            const dz = mesh.positions[candidate * 3 + 2]! - mz;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < bestSq) {
              bestSq = distanceSq;
              best = candidate;
            }
          }
        }
      }
    }
    if (best === -1) continue;
    for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
      const sourceColumn = weights.joints[best * MAX_INFLUENCES + slot]!;
      weights.joints[v * MAX_INFLUENCES + slot] =
        columnMirror[sourceColumn] ?? sourceColumn;
      weights.weights[v * MAX_INFLUENCES + slot] =
        weights.weights[best * MAX_INFLUENCES + slot]!;
    }
    affected.push(v);
  }
  return affected;
}

export { buildVertexAdjacency };
