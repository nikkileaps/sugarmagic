import { describe, expect, it } from "vitest";
import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  GameProject,
  RegionDocument,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createAuthoringSession,
  addAssetDefinitionToSession,
  getAllAssetDefinitions,
  applyCommand,
  getActiveRegion,
  createDefaultPlayerDefinition,
  createDefaultEnvironmentDefinition,
  createDefaultRegionLandscapeState
} from "@sugarmagic/domain";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";

function makeProject(): GameProject {
  return {
    identity: { id: "wordlark", schema: "GameProject", version: 1 },
    displayName: "Wordlark",
    gameRootPath: ".",
    regionRegistry: [{ regionId: "arrival_station" }],
    pluginConfigIds: [],
    contentLibraryId: "wordlark:content-library",
    playerDefinition: createDefaultPlayerDefinition("wordlark"),
    npcDefinitions: [],
    dialogueDefinitions: [],
    itemDefinitions: [],
    documentDefinitions: [],
    questDefinitions: []
  };
}

function makeRegion(): RegionDocument {
  return {
    identity: {
      id: "arrival_station",
      schema: "RegionDocument",
      version: 1
    },
    displayName: "Arrival Station",
    placement: {
      gridPosition: { x: 0, y: 0 },
      placementPolicy: "world-grid"
    },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: [],
      itemPresences: []
    },
    environmentBinding: { defaultEnvironmentId: "wordlark:environment:default" },
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
}

function makeContentLibrary(): ContentLibrarySnapshot {
  return {
    identity: {
      id: "wordlark:content-library",
      schema: "ContentLibrary",
      version: 1
    },
    assetDefinitions: [],
    environmentDefinitions: [
      createDefaultEnvironmentDefinition("wordlark", {
        definitionId: "wordlark:environment:default",
        displayName: "Default Environment"
      })
    ]
  };
}

function makeAssetDefinition(): AssetDefinition {
  return {
    definitionId: "asset:station-building",
    definitionKind: "asset",
    displayName: "Station Building",
    assetKind: "model",
    source: {
      relativeAssetPath: "assets/imported/station-building.glb",
      fileName: "station-building.glb",
      mimeType: "model/gltf-binary"
    }
  };
}

describe("asset management loop", () => {
  it("adds imported asset definitions to the content library", () => {
    const session = createAuthoringSession(
      makeProject(),
      [makeRegion()],
      makeContentLibrary()
    );

    const updated = addAssetDefinitionToSession(session, makeAssetDefinition());

    expect(getAllAssetDefinitions(updated)).toHaveLength(1);
    expect(getAllAssetDefinitions(updated)[0]?.definitionId).toBe(
      "asset:station-building"
    );
  });

  it("places, folders, reparents, duplicates, and removes placed assets canonically", () => {
    let session = createAuthoringSession(
      makeProject(),
      [makeRegion()],
      makeContentLibrary()
    );
    session = addAssetDefinitionToSession(session, makeAssetDefinition());

    const region = getActiveRegion(session);
    expect(region).not.toBeNull();

    const createFolder: SemanticCommand = {
      kind: "CreateSceneFolder",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "scene-folder", subjectId: "folder:buildings" },
      payload: {
        folderId: "folder:buildings",
        displayName: "Buildings",
        parentFolderId: null
      }
    };

    session = applyCommand(session, createFolder);

    const placeAsset: SemanticCommand = {
      kind: "PlaceAssetInstance",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "placed-asset", subjectId: "placed-asset:station" },
      payload: {
        instanceId: "placed-asset:station",
        assetDefinitionId: "asset:station-building",
        displayName: "Station Building",
        parentFolderId: null,
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    };

    session = applyCommand(session, placeAsset);

    const moveToFolder: SemanticCommand = {
      kind: "MovePlacedAssetToFolder",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "placed-asset", subjectId: "placed-asset:station" },
      payload: {
        instanceId: "placed-asset:station",
        parentFolderId: "folder:buildings"
      }
    };

    session = applyCommand(session, moveToFolder);

    const duplicate: SemanticCommand = {
      kind: "DuplicatePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "placed-asset", subjectId: "placed-asset:station-copy" },
      payload: {
        sourceInstanceId: "placed-asset:station",
        duplicatedInstanceId: "placed-asset:station-copy",
        positionOffset: [1, 0, 1]
      }
    };

    session = applyCommand(session, duplicate);

    const remove: SemanticCommand = {
      kind: "RemovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "placed-asset", subjectId: "placed-asset:station" },
      payload: {
        instanceId: "placed-asset:station"
      }
    };

    session = applyCommand(session, remove);

    const updatedRegion = getActiveRegion(session);
    expect(updatedRegion?.scene.folders).toHaveLength(1);
    expect(updatedRegion?.scene.placedAssets).toHaveLength(1);
    expect(updatedRegion?.scene.placedAssets[0]?.instanceId).toBe(
      "placed-asset:station-copy"
    );
    expect(updatedRegion?.scene.placedAssets[0]?.parentFolderId).toBe(
      "folder:buildings"
    );
    expect(updatedRegion?.scene.placedAssets[0]?.assetDefinitionId).toBe(
      "asset:station-building"
    );
  });

  it("resolves placed assets to scene objects with canonical source paths", () => {
    let session = createAuthoringSession(
      makeProject(),
      [makeRegion()],
      makeContentLibrary()
    );
    session = addAssetDefinitionToSession(session, makeAssetDefinition());
    session = applyCommand(session, {
      kind: "PlaceAssetInstance",
      target: {
        aggregateKind: "region-document",
        aggregateId: "arrival_station"
      },
      subject: { subjectKind: "placed-asset", subjectId: "placed-asset:station" },
      payload: {
        instanceId: "placed-asset:station",
        assetDefinitionId: "asset:station-building",
        displayName: "Station Building",
        parentFolderId: null,
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });

    const region = getActiveRegion(session);
    expect(region).not.toBeNull();

    const sceneObjects = resolveSceneObjects(region!, {
      contentLibrary: session.contentLibrary
    });

    expect(sceneObjects).toHaveLength(1);
    expect(sceneObjects[0]?.modelSourcePath).toBe(
      "assets/imported/station-building.glb"
    );
  });
});
