/**
 * Per-instance collider override (Plan 069.6).
 *
 * Mirrors the 068 surfaceSlotOverride slice: a per-instance collider that
 * beats the asset definition, base + scene scoped, resolved scene > instance
 * > definition. Covers the precedence resolver and the command's scope
 * routing (base -> the instance; scene -> the Scene overlay bag).
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegionLandscapeState,
  createDefaultScene,
  createPlacedAssetInstance,
  executeCommand,
  resolveEffectiveInstanceCollider,
  type AssetCollider,
  type RegionDocument,
  type Scene,
  type SemanticCommand
} from "@sugarmagic/domain";

const DEF_BOUNDS = {
  min: [-1, -1, -1] as [number, number, number],
  max: [1, 1, 1] as [number, number, number]
};
const DEF_COLLIDER: AssetCollider = { shape: "auto-box", localBounds: DEF_BOUNDS };

describe("resolveEffectiveInstanceCollider — precedence", () => {
  it("falls back to the definition when there is no override", () => {
    const resolved = resolveEffectiveInstanceCollider(DEF_COLLIDER, undefined, undefined);
    expect(resolved.tier).toBe("definition");
    expect(resolved.collider).toEqual(DEF_COLLIDER);
  });

  it("a shape-only override inherits the definition's baked bounds", () => {
    const resolved = resolveEffectiveInstanceCollider(
      DEF_COLLIDER,
      { shape: "none", localBounds: null },
      undefined
    );
    expect(resolved.tier).toBe("base");
    expect(resolved.collider?.shape).toBe("none");
    expect(resolved.collider?.localBounds).toEqual(DEF_BOUNDS); // inherited
  });

  it("a resized instance override wins over the definition", () => {
    const resized = {
      shape: "auto-box" as const,
      localBounds: {
        min: [-2, -2, -2] as [number, number, number],
        max: [2, 2, 2] as [number, number, number]
      }
    };
    const resolved = resolveEffectiveInstanceCollider(DEF_COLLIDER, resized, undefined);
    expect(resolved.tier).toBe("base");
    expect(resolved.collider?.localBounds).toEqual(resized.localBounds);
  });

  it("the scene override beats the instance override", () => {
    const resolved = resolveEffectiveInstanceCollider(
      DEF_COLLIDER,
      { shape: "auto-box", localBounds: null },
      { shape: "none", localBounds: null }
    );
    expect(resolved.tier).toBe("scene");
    expect(resolved.collider?.shape).toBe("none");
  });
});

function fixture(): { region: RegionDocument; scene: Scene } {
  const instance = createPlacedAssetInstance({
    instanceId: "inst:rock",
    assetDefinitionId: "asset:rock"
  });
  const region: RegionDocument = {
    identity: { id: "region-1", schema: "RegionDocument", version: 1 },
    displayName: "R",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [instance],
    folders: [],
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({}),
    markers: [],
    gameplayPlacements: []
  };
  return { region, scene: createDefaultScene({ sceneId: "scene:1" }) };
}

function cmd(collider: AssetCollider | null, scope: "base" | "scene"): SemanticCommand {
  return {
    kind: "SetPlacedAssetColliderOverride",
    target: { aggregateKind: "region-document", aggregateId: "region-1" },
    subject: { subjectKind: "placed-asset", subjectId: "inst:rock" },
    payload: { instanceId: "inst:rock", collider, scope }
  } as SemanticCommand;
}

describe("SetPlacedAssetColliderOverride — scope routing", () => {
  it("base scope writes the instance's own colliderOverride", () => {
    const { region, scene } = fixture();
    const next = executeCommand(
      { region, scene },
      cmd({ shape: "none", localBounds: null }, "base")
    );
    expect(next.region.placedAssets[0]?.colliderOverride?.shape).toBe("none");
  });

  it("base scope with null clears the override", () => {
    const { region, scene } = fixture();
    const set = executeCommand(
      { region, scene },
      cmd({ shape: "none", localBounds: null }, "base")
    );
    const cleared = executeCommand(
      { region: set.region, scene: set.scene },
      cmd(null, "base")
    );
    expect(cleared.region.placedAssets[0]?.colliderOverride).toBeUndefined();
  });

  it("scene scope writes the Scene overlay bag, not the instance", () => {
    const { region, scene } = fixture();
    const next = executeCommand(
      { region, scene },
      cmd({ shape: "none", localBounds: null }, "scene")
    );
    // Instance untouched...
    expect(next.region.placedAssets[0]?.colliderOverride).toBeUndefined();
    // ...the Scene overlay holds it.
    const overlay = next.scene.regionOverlays["region-1"];
    expect(
      overlay?.assetAppearanceOverrides["inst:rock"]?.colliderOverride?.shape
    ).toBe("none");
  });

  it("scene scope with null removes the overlay entry", () => {
    const { region, scene } = fixture();
    const set = executeCommand(
      { region, scene },
      cmd({ shape: "none", localBounds: null }, "scene")
    );
    const cleared = executeCommand(
      { region: set.region, scene: set.scene },
      cmd(null, "scene")
    );
    const overlay = cleared.scene.regionOverlays["region-1"];
    expect(overlay?.assetAppearanceOverrides["inst:rock"]).toBeUndefined();
  });
});
