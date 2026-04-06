import { describe, expect, it } from "vitest";
import type { RegionDocument, SemanticCommand } from "@sugarmagic/domain";
import {
  executeCommand,
  pushTransaction,
  createEmptyHistory,
  createDefaultRegionLandscapeState
} from "@sugarmagic/domain";

function makeTestRegion(): RegionDocument {
  return {
    identity: { id: "test-region", schema: "RegionDocument", version: 1 },
    displayName: "Test Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      playerPresence: null,
      npcPresences: [],
      itemPresences: [],
      placedAssets: [
        {
          instanceId: "cube-001",
          assetDefinitionId: "builtin:cube",
          displayName: "Cube 001",
          parentFolderId: null,
          inspectable: null,
          transform: {
            position: [0, 1, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        }
      ]
    },
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    gameplayPlacements: []
  };
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

    const result = executeCommand(region, command);

    expect(result.region.scene.placedAssets[0].transform.position).toEqual([
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

    const result = executeCommand(region, command);
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

    const result = executeCommand(region, command);

    const serialized = JSON.stringify(result.region);
    const reloaded: RegionDocument = JSON.parse(serialized);

    expect(reloaded.scene.placedAssets[0].transform.position).toEqual([
      10, 2, -5
    ]);
    expect(reloaded.identity.id).toBe("test-region");
    expect(reloaded.identity.schema).toBe("RegionDocument");
    expect(reloaded.environmentBinding.defaultEnvironmentId).toBe("env:default");
  });

  it("does not mutate the original region", () => {
    const region = makeTestRegion();
    const originalPosition = [...region.scene.placedAssets[0].transform.position];

    const command: SemanticCommand = {
      kind: "MovePlacedAsset",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: "cube-001" },
      payload: { instanceId: "cube-001", position: [99, 99, 99] }
    };

    executeCommand(region, command);

    expect(region.scene.placedAssets[0].transform.position).toEqual(
      originalPosition
    );
  });
});
