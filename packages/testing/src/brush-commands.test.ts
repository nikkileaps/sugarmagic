/**
 * Scatter-brush batch command tests (Plan 065.2).
 *
 * One stroke = one command = one transaction: BrushPlaceAssets lands a
 * batch of placed instances, BrushEraseAssets removes a batch across
 * both the region base and the active Scene overlay.
 */

import { describe, expect, it } from "vitest";
import type {
  RegionDocument,
  Scene,
  SemanticCommand
} from "@sugarmagic/domain";
import {
  createDefaultRegionLandscapeState,
  createDefaultScene,
  executeCommand
} from "@sugarmagic/domain";

function makeTestRegion(): RegionDocument {
  return {
    identity: { id: "test-region", schema: "RegionDocument", version: 1 },
    displayName: "Test Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [
      {
        instanceId: "existing-001",
        assetDefinitionId: "builtin:cube",
        displayName: "Existing",
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
  } as unknown as RegionDocument;
}

function makeTestScene(): Scene {
  return createDefaultScene({ sceneId: "scene:test" });
}

function brushPlacement(index: number) {
  return {
    instanceId: `brushed-${index}`,
    assetDefinitionId: "asset:tree",
    displayName: `Tree ${index}`,
    position: [index, 0, -index] as [number, number, number],
    rotation: [0, index * 0.5, 0] as [number, number, number],
    scale: [1, 1 + index * 0.1, 1] as [number, number, number]
  };
}

describe("scatter brush commands", () => {
  it("lands a whole stroke of placements as one transaction", () => {
    const region = makeTestRegion();
    const command: SemanticCommand = {
      kind: "BrushPlaceAssets",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "brushed-0" },
      payload: {
        placements: [brushPlacement(0), brushPlacement(1), brushPlacement(2)],
        parentFolderId: null
      }
    };

    const result = executeCommand({ region, scene: makeTestScene() }, command);

    expect(result.region.placedAssets).toHaveLength(4);
    expect(
      result.region.placedAssets.map((asset) => asset.instanceId)
    ).toEqual(["existing-001", "brushed-0", "brushed-1", "brushed-2"]);
    expect(result.region.placedAssets[2].transform.position).toEqual([
      1, 0, -1
    ]);
    // One command -> one transaction boundary -> one undo step.
    expect(result.transaction.command.kind).toBe("BrushPlaceAssets");
  });

  it("lands scoped placements in the active Scene overlay, not the base", () => {
    const region = makeTestRegion();
    const scene = makeTestScene();
    const command: SemanticCommand = {
      kind: "BrushPlaceAssets",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "brushed-0" },
      payload: {
        placements: [brushPlacement(0), brushPlacement(1)],
        parentFolderId: null,
        scope: { sceneId: scene.sceneId }
      }
    };

    const result = executeCommand({ region, scene }, command);

    expect(result.region.placedAssets).toHaveLength(1);
    expect(
      result.scene.regionOverlays[region.identity.id]?.placedAssets ?? []
    ).toHaveLength(2);
  });

  it("creates the stroke folder in the same transaction and reuses it", () => {
    const region = makeTestRegion();
    const scene = makeTestScene();
    const stroke = (index: number): SemanticCommand => ({
      kind: "BrushPlaceAssets",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: `brushed-${index}` },
      payload: {
        placements: [brushPlacement(index)],
        parentFolderId: null,
        createFolder: {
          folderId: "folder:lavender-patch",
          displayName: "lavender-plant patch"
        }
      }
    });

    const first = executeCommand({ region, scene }, stroke(0));
    const second = executeCommand(
      { region: first.region, scene: first.scene },
      stroke(1)
    );

    // One folder despite two strokes referencing the same id.
    expect(
      second.region.folders.filter(
        (folder) => folder.folderId === "folder:lavender-patch"
      )
    ).toHaveLength(1);
    // Both placements landed inside it.
    expect(
      second.region.placedAssets
        .filter((asset) => asset.instanceId.startsWith("brushed-"))
        .every((asset) => asset.parentFolderId === "folder:lavender-patch")
    ).toBe(true);
  });

  it("erases a batch across base and overlay in one command", () => {
    const region = makeTestRegion();
    const scene = makeTestScene();

    const place: SemanticCommand = {
      kind: "BrushPlaceAssets",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "brushed-0" },
      payload: {
        placements: [brushPlacement(0)],
        parentFolderId: null,
        scope: { sceneId: scene.sceneId }
      }
    };
    const placed = executeCommand({ region, scene }, place);

    const erase: SemanticCommand = {
      kind: "BrushEraseAssets",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "brushed-0" },
      payload: {
        instanceIds: ["existing-001", "brushed-0", "not-there"]
      }
    };
    const result = executeCommand(
      { region: placed.region, scene: placed.scene },
      erase
    );

    expect(result.region.placedAssets).toHaveLength(0);
    expect(
      result.scene.regionOverlays[region.identity.id]?.placedAssets ?? []
    ).toHaveLength(0);
  });
});
