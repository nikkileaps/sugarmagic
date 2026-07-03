/**
 * packages/domain/src/scenes/migrate.test.ts
 *
 * Purpose: Pins the pre-058 -> Base+Overlay migration (Plan 058
 * §058.1) — legacy `region.scene` nests lift into the default
 * Scene's overlays + region base fields, idempotently — and the
 * `composeRegionContents` view both spawn paths read.
 *
 * Implements: Plan 058 §058.1 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { RegionDocument } from "../region-authoring";
import { createDefaultRegionLandscapeState } from "../region-authoring";
import {
  DEFAULT_SCENE_ID,
  composeRegionContents,
  createDefaultScene,
  migrateToScenes
} from "./index";

function makeBaseRegion(id: string): RegionDocument {
  return {
    identity: { id, schema: "RegionDocument", version: 1 },
    displayName: id,
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: null },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeLegacyRegion(id: string): RegionDocument {
  const base = makeBaseRegion(id) as Omit<
    RegionDocument,
    "placedAssets" | "folders"
  > & {
    scene?: unknown;
    placedAssets?: RegionDocument["placedAssets"];
    folders?: RegionDocument["folders"];
  };
  delete base.placedAssets;
  delete base.folders;
  base.scene = {
    folders: [{ folderId: "f1", displayName: "Props", parentFolderId: null }],
    placedAssets: [
      {
        instanceId: "asset-1",
        assetDefinitionId: "def:cube",
        displayName: "Cube",
        parentFolderId: "f1",
        inspectable: null,
        shaderOverrides: [],
        shaderParameterOverrides: [],
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    ],
    playerPresence: {
      presenceId: "player-1",
      transform: {
        position: [1, 0, 1],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    },
    npcPresences: [
      {
        presenceId: "npc-1",
        npcDefinitionId: "def:npc",
        shaderParameterOverrides: [],
        transform: {
          position: [2, 0, 2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    ],
    itemPresences: []
  };
  return base as RegionDocument;
}

describe("migrateToScenes", () => {
  it("lifts a legacy region.scene nest into the default Scene + region base", () => {
    const result = migrateToScenes({
      scenes: [],
      regions: [makeLegacyRegion("region:town")]
    });

    expect(result.didMigrate).toBe(true);
    // Assets + folders hoist to the region base (always-visible).
    const region = result.regions[0]!;
    expect(region.placedAssets.map((asset) => asset.instanceId)).toEqual([
      "asset-1"
    ]);
    expect(region.folders.map((folder) => folder.folderId)).toEqual(["f1"]);
    // Legacy nest is stripped.
    expect((region as { scene?: unknown }).scene).toBeUndefined();
    // Presences land in the default Scene's overlay.
    const defaultScene = result.scenes.find(
      (scene) => scene.sceneId === DEFAULT_SCENE_ID
    );
    expect(defaultScene).toBeDefined();
    const overlay = defaultScene!.regionOverlays["region:town"]!;
    expect(overlay.playerPresence?.presenceId).toBe("player-1");
    expect(overlay.npcPresences.map((p) => p.presenceId)).toEqual(["npc-1"]);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const first = migrateToScenes({
      scenes: [],
      regions: [makeLegacyRegion("region:town")]
    });
    const second = migrateToScenes({
      scenes: first.scenes,
      regions: first.regions
    });
    expect(second.didMigrate).toBe(false);
    expect(second.scenes).toEqual(first.scenes);
    expect(second.regions).toEqual(first.regions);
  });

  it("creates a default Scene even when no regions have legacy content", () => {
    const result = migrateToScenes({
      scenes: [],
      regions: [makeBaseRegion("region:empty")]
    });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.sceneId).toBe(DEFAULT_SCENE_ID);
  });

  it("targets an existing first Scene instead of minting a duplicate default", () => {
    const authored = createDefaultScene({
      sceneId: "scene:authored",
      displayName: "Authored"
    });
    const result = migrateToScenes({
      scenes: [authored],
      regions: [makeLegacyRegion("region:town")]
    });
    expect(result.scenes.map((scene) => scene.sceneId)).toEqual([
      "scene:authored"
    ]);
    expect(
      result.scenes[0]!.regionOverlays["region:town"]?.playerPresence
        ?.presenceId
    ).toBe("player-1");
  });

  it("never clobbers an overlay that already exists for a region", () => {
    const existing = createDefaultScene({
      sceneId: DEFAULT_SCENE_ID,
      regionOverlays: {
        "region:town": {
          folders: [],
          placedAssets: [],
          playerPresence: null,
          npcPresences: [],
          itemPresences: [
            {
              presenceId: "kept-item",
              itemDefinitionId: "def:coin",
              quantity: 1,
              shaderParameterOverrides: [],
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ]
        }
      }
    });
    const result = migrateToScenes({
      scenes: [existing],
      regions: [makeLegacyRegion("region:town")]
    });
    const overlay = result.scenes[0]!.regionOverlays["region:town"]!;
    // First-run overlay wins; the legacy presences do NOT replace it.
    expect(overlay.itemPresences.map((p) => p.presenceId)).toEqual([
      "kept-item"
    ]);
    expect(overlay.playerPresence).toBeNull();
  });
});

describe("composeRegionContents", () => {
  it("composes base assets with the Scene overlay for the region", () => {
    const migrated = migrateToScenes({
      scenes: [],
      regions: [makeLegacyRegion("region:town")]
    });
    const contents = composeRegionContents(
      migrated.regions[0]!,
      migrated.scenes[0]!
    );
    expect(contents.placedAssets.map((asset) => asset.instanceId)).toEqual([
      "asset-1"
    ]);
    expect(contents.playerPresence?.presenceId).toBe("player-1");
    expect(contents.npcPresences).toHaveLength(1);
  });

  it("null scene composes base-only", () => {
    const migrated = migrateToScenes({
      scenes: [],
      regions: [makeLegacyRegion("region:town")]
    });
    const contents = composeRegionContents(migrated.regions[0]!, null);
    expect(contents.placedAssets).toHaveLength(1);
    expect(contents.playerPresence).toBeNull();
    expect(contents.npcPresences).toHaveLength(0);
  });

  it("unions base and overlay assets + folders", () => {
    const region = makeBaseRegion("region:town");
    region.placedAssets.push({
      instanceId: "base-asset",
      assetDefinitionId: "def:wall",
      displayName: "Wall",
      parentFolderId: null,
      inspectable: null,
      shaderOverrides: [],
      shaderParameterOverrides: [],
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
    const scene = createDefaultScene({
      sceneId: "scene:x",
      regionOverlays: {
        "region:town": {
          folders: [],
          placedAssets: [
            {
              instanceId: "overlay-asset",
              assetDefinitionId: "def:stall",
              displayName: "Market Stall",
              parentFolderId: null,
              inspectable: null,
              shaderOverrides: [],
              shaderParameterOverrides: [],
              transform: {
                position: [5, 0, 5],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ],
          playerPresence: null,
          npcPresences: [],
          itemPresences: []
        }
      }
    });
    const contents = composeRegionContents(region, scene);
    expect(contents.placedAssets.map((asset) => asset.instanceId)).toEqual([
      "base-asset",
      "overlay-asset"
    ]);
  });
});
