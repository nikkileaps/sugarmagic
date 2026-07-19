import { describe, expect, it } from "vitest";
import {
  assetObjectIsInstanceable,
  objectSurfaceHasScatter,
  type SceneObject
} from "@sugarmagic/runtime-core";

// Plan 070.6/070.8 (#348, review) — the single instanceability gate both hosts
// share to decide whether a placed asset collapses into a shared InstancedMesh.
// A drift here silently either batches scatter (losing per-instance surface) or
// stops batching statics (draw-count blowup), so lock the classification.

type Slots = SceneObject["effectiveMaterialSlots"];

function sceneObject(over: Partial<SceneObject>): SceneObject {
  return {
    kind: "asset",
    modelSourcePath: "models/x.glb",
    effectiveMaterialSlots: [] as Slots,
    ...over
  } as SceneObject;
}

const slotsWithLayer = (kind: string): Slots =>
  [{ surface: { layers: [{ kind }] } }] as unknown as Slots;

describe("070.6 — assetObjectIsInstanceable gate", () => {
  it("a plain static model with a source path IS instanceable", () => {
    expect(assetObjectIsInstanceable(sceneObject({}))).toBe(true);
  });

  it("a scatter-surface asset is NOT instanceable (keeps its per-instance surface)", () => {
    const o = sceneObject({
      effectiveMaterialSlots: slotsWithLayer("scatter")
    });
    expect(objectSurfaceHasScatter(o)).toBe(true);
    expect(assetObjectIsInstanceable(o)).toBe(false);
  });

  it("a surface-ref asset is NOT instanceable (may nest scatter)", () => {
    const o = sceneObject({
      effectiveMaterialSlots: slotsWithLayer("surface-ref")
    });
    expect(assetObjectIsInstanceable(o)).toBe(false);
  });

  it("a plain-surface (non-scatter) asset IS instanceable", () => {
    const o = sceneObject({ effectiveMaterialSlots: slotsWithLayer("color") });
    expect(objectSurfaceHasScatter(o)).toBe(false);
    expect(assetObjectIsInstanceable(o)).toBe(true);
  });

  it("non-asset kinds and missing modelSourcePath are NOT instanceable", () => {
    expect(assetObjectIsInstanceable(sceneObject({ kind: "npc" }))).toBe(false);
    expect(
      assetObjectIsInstanceable(sceneObject({ modelSourcePath: undefined }))
    ).toBe(false);
  });
});
