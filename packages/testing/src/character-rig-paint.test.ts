/**
 * Plan 062 §062.8 — pure weight-painting ops: renormalization,
 * 4-influence cap, brush falloff, smooth mode.
 */
import { describe, expect, it } from "vitest";
import {
  applyBrushStroke,
  assignVerticesToBone,
  boneWeightOfVertex,
  buildVertexAdjacency,
  mirrorWeights,
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

  it("subtract on a sole-influence vertex borrows the receiving bone from neighbors", () => {
    // Three vertices in a line; middle is 100% bone 1 (a stray
    // from a fill sweep), neighbors are 100% bone 0. Subtracting
    // bone 1 at the middle must bleed weight to bone 0 instead of
    // renormalizing back to 1.
    const mesh: MeshData = {
      positions: new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0]),
      indices: new Uint32Array([0, 1, 2])
    };
    const w = makeWeights(3, ["a", "b"]);
    w.joints[1 * MAX_INFLUENCES] = 1;
    w.weights[1 * MAX_INFLUENCES] = 1;
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      {
        center: [0.1, 0, 0],
        radius: 0.05,
        boneColumn: 1,
        strength: 0.5,
        mode: "subtract"
      },
      adjacency
    );
    expect(boneWeightOfVertex(w, 1, 1)).toBeLessThan(1);
    expect(boneWeightOfVertex(w, 1, 0)).toBeGreaterThan(0);
    expect(weightSum(w, 1)).toBeCloseTo(1, 5);
  });

  it("subtract works deep inside a filled region via territorial BFS", () => {
    // A strip of 6 vertices, chained by triangles. Vertices 1-5
    // are 100% bone 1 (a Fill sweep); only vertex 0 carries bone
    // 0. Subtracting at vertex 3 (no immediate neighbor with
    // another influence) must find bone 0 by walking the mesh.
    const positions = new Float32Array(18);
    for (let i = 0; i < 6; i += 1) positions[i * 3] = i * 0.1;
    const indices = new Uint32Array([
      0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5
    ]);
    const mesh: MeshData = { positions, indices };
    const w = makeWeights(6, ["a", "b"]);
    for (let v = 1; v < 6; v += 1) {
      w.joints[v * MAX_INFLUENCES] = 1;
      w.weights[v * MAX_INFLUENCES] = 1;
    }
    const adjacency = buildVertexAdjacency(mesh);
    applyBrushStroke(
      mesh,
      w,
      {
        center: [0.3, 0, 0],
        radius: 0.05,
        boneColumn: 1,
        strength: 0.5,
        mode: "subtract"
      },
      adjacency
    );
    expect(boneWeightOfVertex(w, 3, 1)).toBeLessThan(1);
    expect(boneWeightOfVertex(w, 3, 0)).toBeGreaterThan(0);
    expect(weightSum(w, 3)).toBeCloseTo(1, 5);
  });

  it("a sole-influence vertex stays fully bound (normalization has nowhere else to go)", () => {
    // DCC-standard: reducing the only influence renormalizes back
    // to 1 — matches Blender's auto-normalize behavior.
    const w = makeWeights(1, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 0, 0.3);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
  });
});

describe("mirrorWeights (Plan 062)", () => {
  it("copies left weights onto mirrored right vertices with L/R bones swapped", () => {
    // Two mirrored pairs across x=0 plus a center vertex.
    const mesh: MeshData = {
      positions: new Float32Array([
        0.5, 1, 0, -0.5, 1, 0, 0.3, 0.2, 0.1, -0.3, 0.2, 0.1, 0, 0.5, 0
      ]),
      indices: new Uint32Array([0, 1, 2, 2, 3, 4])
    };
    const w = makeWeights(5, ["DEF-upper_arm.L", "DEF-upper_arm.R", "DEF-hips"]);
    // Paint the LEFT side: v0 arm.L 0.7 / hips 0.3, v2 arm.L 1.
    setBoneWeightAtVertex(w, 0, 2, 0.3);
    setBoneWeightAtVertex(w, 2, 0, 1);
    // Right side starts all bone 0 (arm.L — wrong on purpose).
    const affected = mirrorWeights(mesh, w, { direction: "leftToRight" });
    expect(affected.sort()).toEqual([1, 3]);
    // v1 mirrors v0: arm.R 0.7, hips 0.3.
    expect(boneWeightOfVertex(w, 1, 1)).toBeCloseTo(0.7, 5);
    expect(boneWeightOfVertex(w, 1, 2)).toBeCloseTo(0.3, 5);
    // v3 mirrors v2: arm.R 1.
    expect(boneWeightOfVertex(w, 3, 1)).toBeCloseTo(1, 5);
    // Center vertex untouched.
    expect(boneWeightOfVertex(w, 4, 0)).toBeCloseTo(1, 5);
  });

  it("leaves right-side vertices without a mirror twin untouched", () => {
    const mesh: MeshData = {
      positions: new Float32Array([0.5, 1, 0, -0.5, 3, 0]),
      indices: new Uint32Array([0, 1, 0])
    };
    const w = makeWeights(2, ["a", "b"]);
    setBoneWeightAtVertex(w, 0, 1, 1);
    const affected = mirrorWeights(mesh, w, { direction: "leftToRight" });
    expect(affected).toEqual([]);
    expect(boneWeightOfVertex(w, 1, 0)).toBeCloseTo(1, 5);
  });
});

describe("assignVerticesToBone (Plan 064)", () => {
  it("rigidly assigns an explicit selection, leaving others alone", () => {
    const w = makeWeights(4, ["a", "b"]);
    assignVerticesToBone(w, [1, 3], 1);
    expect(boneWeightOfVertex(w, 0, 0)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 1, 1)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 2, 0)).toBeCloseTo(1, 5);
    expect(boneWeightOfVertex(w, 3, 1)).toBeCloseTo(1, 5);
  });
});
