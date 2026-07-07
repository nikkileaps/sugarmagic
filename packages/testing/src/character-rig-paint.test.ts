/**
 * Plan 062 §062.8 — pure weight-painting ops: renormalization,
 * 4-influence cap, brush falloff, smooth mode.
 */
import { describe, expect, it } from "vitest";
import {
  applyBrushStroke,
  boneWeightOfVertex,
  buildVertexAdjacency,
  setBoneWeightAtVertex,
  MAX_INFLUENCES,
  type MeshData,
  type SkinWeights
} from "@sugarmagic/character-rig";

function makeWeights(vertexCount: number, boneOrder: string[]): SkinWeights {
  const joints = new Uint16Array(vertexCount * MAX_INFLUENCES);
  const weights = new Float32Array(vertexCount * MAX_INFLUENCES);
  for (let v = 0; v < vertexCount; v += 1) {
    joints[v * MAX_INFLUENCES] = 0;
    weights[v * MAX_INFLUENCES] = 1;
  }
  return { boneOrder, joints, weights };
}

function weightSum(w: SkinWeights, vertex: number): number {
  let sum = 0;
  for (let slot = 0; slot < MAX_INFLUENCES; slot += 1) {
    sum += w.weights[vertex * MAX_INFLUENCES + slot]!;
  }
  return sum;
}

describe("weight painting ops (Plan 062)", () => {
  it("setBoneWeightAtVertex renormalizes and preserves the cap", () => {
    const w = makeWeights(1, ["a", "b", "c", "d", "e"]);
    setBoneWeightAtVertex(w, 0, 1, 0.6);
    expect(boneWeightOfVertex(w, 0, 1)).toBeCloseTo(0.6, 5);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(0.4, 5);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
    // Paint three more bones — cap keeps strongest four, still
    // normalized.
    setBoneWeightAtVertex(w, 0, 2, 0.3);
    setBoneWeightAtVertex(w, 0, 3, 0.2);
    setBoneWeightAtVertex(w, 0, 4, 0.1);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
  });

  it("painting to zero leaves the vertex bound to its next-strongest bone", () => {
    const w = makeWeights(1, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 1, 0.4);
    setBoneWeightAtVertex(w, 0, 1, 0);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
    expect(weightSum(w, 0)).toBeCloseTo(1, 5);
  });

  it("brush strokes fall off with distance and only touch the radius", () => {
    // 3 vertices along x: 0, 0.5 (inside), 2 (outside).
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.5, 0, 0, 2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    const affected = applyBrushStroke(mesh, w, {
      center: [0, 0, 0],
      radius: 1,
      boneColumn: 1,
      strength: 1,
      mode: "add"
    });
    expect(affected).toEqual([0, 1]);
    expect(boneWeightOfVertex(w, 0, 1)).toBeCloseTo(1, 4);
    const midFalloff = boneWeightOfVertex(w, 1, 1);
    expect(midFalloff).toBeGreaterThan(0.1);
    expect(midFalloff).toBeLessThan(0.9);
    expect(boneWeightOfVertex(w, 2, 1)).toBe(0);
  });

  it("smooth mode pulls a spike toward its neighbors", () => {
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    setBoneWeightAtVertex(w, 1, 1, 0.9); // spike (a:0.1, b:0.9)
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      { center: [0.1, 0, 0], radius: 1, boneColumn: 1, strength: 1, mode: "smooth" },
      adjacency
    );
    const smoothed = boneWeightOfVertex(w, 1, 1);
    expect(smoothed).toBeLessThan(0.9);
    expect(weightSum(w, 1)).toBeCloseTo(1, 5);
  });

  it("a sole-influence vertex stays fully bound (normalization has nowhere else to go)", () => {
    // DCC-standard: reducing the only influence renormalizes back
    // to 1 — matches Blender's auto-normalize behavior.
    const w = makeWeights(1, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 0, 0.3);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
  });
});
