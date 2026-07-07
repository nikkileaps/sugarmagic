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

export type BrushMode = "add" | "subtract" | "smooth";

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
export function applyBrushStroke(
  mesh: MeshData,
  weights: SkinWeights,
  stroke: BrushStroke,
  /** Reused adjacency for smooth mode; build once per session. */
  adjacency?: Array<Set<number>>
): number[] {
  const affected: number[] = [];
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
    if (stroke.mode === "add") {
      setBoneWeightAtVertex(
        weights,
        vertex,
        stroke.boneColumn,
        current + stroke.strength * falloff
      );
    } else if (stroke.mode === "subtract") {
      setBoneWeightAtVertex(
        weights,
        vertex,
        stroke.boneColumn,
        current - stroke.strength * falloff
      );
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

export { buildVertexAdjacency };
