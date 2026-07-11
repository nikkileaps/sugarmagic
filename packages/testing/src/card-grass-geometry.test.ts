/**
 * Card grass geometry tests.
 *
 * Verifies the painted-silhouette card clump primitive (tuft kind
 * "card") on the CPU: quad count, root anchoring, forced-up normals,
 * full-quad UVs, and splay/crossing — the properties the stylized-grass
 * look depends on, checkable outside the WebGPU realization path.
 */

import { describe, expect, it } from "vitest";
import type { GrassTypeDefinition } from "@sugarmagic/domain";
import { createDefaultGrassTypeDefinition } from "@sugarmagic/domain";
import { createProceduralGrassGeometry } from "@sugarmagic/render-web";

function createCardGrassType(
  overrides: Partial<Extract<GrassTypeDefinition["tuft"], { kind: "card" }>> = {}
): GrassTypeDefinition {
  return {
    ...createDefaultGrassTypeDefinition("test-project", {
      definitionId: "test-project:grass-type:card-test",
      displayName: "Card Test"
    }),
    tuft: {
      kind: "card",
      cardsPerClump: 3,
      width: 0.9,
      height: 0.55,
      splayDegrees: 14,
      ...overrides
    }
  };
}

describe("card grass geometry", () => {
  it("builds one root-anchored quad per card", () => {
    const geometry = createProceduralGrassGeometry(createCardGrassType());
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();

    expect(position.count).toBe(3 * 4);
    expect(index?.count).toBe(3 * 6);

    // Each quad's two bottom vertices sit exactly on the ground plane;
    // the two top vertices sit near tuft.height (splay tilts them
    // slightly below the untilted height, never above it).
    for (let card = 0; card < 3; card += 1) {
      const base = card * 4;
      expect(position.getY(base)).toBeCloseTo(0, 5);
      expect(position.getY(base + 1)).toBeCloseTo(0, 5);
      expect(position.getY(base + 2)).toBeGreaterThan(0.5);
      expect(position.getY(base + 2)).toBeLessThanOrEqual(0.55 + 1e-5);
      expect(position.getY(base + 3)).toBeGreaterThan(0.5);
    }
  });

  it("forces every vertex normal world-up", () => {
    const geometry = createProceduralGrassGeometry(createCardGrassType());
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i += 1) {
      expect(normal.getX(i)).toBe(0);
      expect(normal.getY(i)).toBe(1);
      expect(normal.getZ(i)).toBe(0);
    }
  });

  it("spans full 0..1 UVs and tree-height per quad so the silhouette texture maps root-to-tip", () => {
    const geometry = createProceduralGrassGeometry(createCardGrassType());
    const uv = geometry.getAttribute("uv");
    const treeHeight = geometry.getAttribute("_tree_height");
    for (let card = 0; card < 3; card += 1) {
      const base = card * 4;
      expect([uv.getX(base), uv.getY(base)]).toEqual([0, 0]);
      expect([uv.getX(base + 1), uv.getY(base + 1)]).toEqual([1, 0]);
      expect([uv.getX(base + 2), uv.getY(base + 2)]).toEqual([0, 1]);
      expect([uv.getX(base + 3), uv.getY(base + 3)]).toEqual([1, 1]);
      expect(treeHeight.getX(base)).toBe(0);
      expect(treeHeight.getX(base + 2)).toBe(1);
    }
  });

  it("crosses cards at distinct yaws instead of stacking them coplanar", () => {
    const geometry = createProceduralGrassGeometry(
      createCardGrassType({ cardsPerClump: 2, splayDegrees: 0 })
    );
    const position = geometry.getAttribute("position");
    // With zero splay each card's bottom edge is a horizontal segment
    // through the origin; distinct yaw means distinct edge directions.
    const edgeAngle = (card: number) => {
      const base = card * 4;
      const dx = position.getX(base + 1) - position.getX(base);
      const dz = position.getZ(base + 1) - position.getZ(base);
      return Math.atan2(dz, dx);
    };
    const delta = Math.abs(edgeAngle(0) - edgeAngle(1)) % Math.PI;
    expect(Math.min(delta, Math.PI - delta)).toBeGreaterThan(0.5);
  });

  it("reduces card count under a reduced vertex budget but never below one", () => {
    const type = createCardGrassType({ cardsPerClump: 4 });
    const reduced = createProceduralGrassGeometry(type, { vertexBudget: 0.5 });
    expect(reduced.getAttribute("position").count).toBe(2 * 4);
    const floor = createProceduralGrassGeometry(type, { vertexBudget: 0.1 });
    expect(floor.getAttribute("position").count).toBe(4);
  });
});
