import { describe, expect, it } from "vitest";
import type { RegionDocument, Scene, SemanticCommand } from "@sugarmagic/domain";
import {
  executeCommand,
  pushTransaction,
  createDefaultScene,
  createEmptyHistory,
  createDefaultRegionLandscapeState,
  createEmptyContentLibrarySnapshot,
  normalizeRegionDocumentForLoad
} from "@sugarmagic/domain";

function makeTestRegion(): RegionDocument {
  return {
    identity: { id: "test-region", schema: "RegionDocument", version: 1 },
    displayName: "Test Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    // Plan 058 §058.1 — placed assets live at the region top
    // level (Base scope); the old `scene` nest is gone.
    placedAssets: [
      {
        instanceId: "cube-001",
        assetDefinitionId: "builtin:cube",
        displayName: "Cube 001",
        parentFolderId: null,
        inspectable: null,
        shaderOverride: null,
        shaderParameterOverrides: [],
        transform: {
          position: [0, 1, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    ],
    folders: [],
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeTestScene(): Scene {
  return createDefaultScene({ sceneId: "scene:test" });
}

describe("first authored loop", () => {
  it("executes MovePlacedAsset and updates canonical region", () => {
    const region = makeTestRegion();
    const command: SemanticCommand = {
      kind: "MovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "cube-001" },
      payload: { instanceId: "cube-001", position: [3, 1, -2] }
    };

    const result = executeCommand({ region, scene: makeTestScene() }, command);

    expect(result.region.placedAssets[0].transform.position).toEqual([
      3, 1, -2
    ]);
    expect(result.transaction.command.kind).toBe("MovePlacedAsset");
    expect(result.transaction.affectedAggregateIds).toContain("test-region");
  });

  it("records transaction in history for undo", () => {
    const region = makeTestRegion();
    let history = createEmptyHistory();

    const command: SemanticCommand = {
      kind: "MovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "cube-001" },
      payload: { instanceId: "cube-001", position: [5, 0, 0] }
    };

    const result = executeCommand({ region, scene: makeTestScene() }, command);
    history = pushTransaction(history, result.transaction);

    expect(history.undoStack).toHaveLength(1);
    expect(history.redoStack).toHaveLength(0);
    expect(history.undoStack[0].transactionId).toBe(
      result.transaction.transactionId
    );
  });

  it("preserves canonical region shape through serialization round-trip", () => {
    const region = makeTestRegion();
    const command: SemanticCommand = {
      kind: "MovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "cube-001" },
      payload: { instanceId: "cube-001", position: [10, 2, -5] }
    };

    const result = executeCommand({ region, scene: makeTestScene() }, command);

    const serialized = JSON.stringify(result.region);
    const reloaded: RegionDocument = JSON.parse(serialized);

    expect(reloaded.placedAssets[0].transform.position).toEqual([
      10, 2, -5
    ]);
    expect(reloaded.identity.id).toBe("test-region");
    expect(reloaded.identity.schema).toBe("RegionDocument");
    expect(reloaded.environmentBinding.defaultEnvironmentId).toBe("env:default");
  });

  it("does not mutate the original region", () => {
    const region = makeTestRegion();
    const originalPosition = [...region.placedAssets[0].transform.position];

    const command: SemanticCommand = {
      kind: "MovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "cube-001" },
      payload: { instanceId: "cube-001", position: [99, 99, 99] }
    };

    executeCommand({ region, scene: makeTestScene() }, command);

    expect(region.placedAssets[0].transform.position).toEqual(
      originalPosition
    );
  });

  it("mutates an overlay-scoped asset in the Scene, not the region", () => {
    // Plan 058 §058.1 — by-id mutations apply to whichever store
    // holds the id. An overlay asset moves inside the Scene's
    // overlay; the region base is untouched.
    const region = makeTestRegion();
    const scene = createDefaultScene({
      sceneId: "scene:test",
      regionOverlays: {
        [region.identity.id]: {
          assetAppearanceOverrides: {},
          folders: [],
          playerPresence: null,
          npcPresences: [],
          itemPresences: [],
          placedAssets: [
            {
              instanceId: "overlay-cube",
              assetDefinitionId: "builtin:cube",
              displayName: "Overlay Cube",
              parentFolderId: null,
              inspectable: null,
              shaderOverride: null,
              shaderParameterOverrides: [],
              transform: {
                position: [1, 1, 1],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ]
        }
      }
    });

    const result = executeCommand(
      { region, scene },
      {
        kind: "MovePlacedAsset",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: { subjectKind: "placed-asset", subjectId: "overlay-cube" },
        payload: { instanceId: "overlay-cube", position: [7, 8, 9] }
      }
    );

    expect(
      result.scene.regionOverlays[region.identity.id]?.placedAssets[0]
        ?.transform.position
    ).toEqual([7, 8, 9]);
    // Base asset untouched.
    expect(result.region.placedAssets[0].transform.position).toEqual([
      0, 1, 0
    ]);
  });

  it("places a new asset into the Scene overlay when scope names the Scene", () => {
    const region = makeTestRegion();
    const scene = makeTestScene();

    const result = executeCommand(
      { region, scene },
      {
        kind: "PlaceAssetInstance",
        target: {
          aggregateKind: "region-document",
          aggregateId: region.identity.id
        },
        subject: { subjectKind: "placed-asset", subjectId: "scoped-asset" },
        payload: {
          instanceId: "scoped-asset",
          assetDefinitionId: "builtin:cube",
          displayName: "Scene Prop",
          parentFolderId: null,
          position: [2, 0, 2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          scope: { sceneId: scene.sceneId }
        }
      }
    );

    expect(
      result.scene.regionOverlays[region.identity.id]?.placedAssets
    ).toHaveLength(1);
    // Base list unchanged (still just cube-001).
    expect(result.region.placedAssets).toHaveLength(1);
  });

  it("migrates legacy shaderOverride fields into shaderOverrides at load time", () => {
    const region = makeTestRegion();
    region.placedAssets[0] = {
      ...region.placedAssets[0],
      shaderOverride: {
        shaderDefinitionId: "project:shader:legacy-surface",
        slot: "surface"
      }
    };

    const normalized = normalizeRegionDocumentForLoad(
      region,
      createEmptyContentLibrarySnapshot("project")
    );

    expect(normalized.placedAssets[0].shaderOverrides).toEqual([
      {
        shaderDefinitionId: "project:shader:legacy-surface",
        slot: "surface"
      }
    ]);
    expect(normalized.placedAssets[0].shaderOverride).toBeUndefined();
  });
});
