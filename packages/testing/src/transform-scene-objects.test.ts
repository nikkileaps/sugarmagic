/**
 * Batch transform command tests.
 *
 * One gizmo drag over a selection = one command = one transaction, so a single
 * undo puts every object back rather than one object per press.
 */

import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegionLandscapeState,
  createDefaultScene,
  executeCommand,
  getActiveRegion,
  undoSession,
  type RegionDocument,
  type Scene,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "test-region";

function placedAsset(instanceId: string, x: number) {
  return {
    instanceId,
    assetDefinitionId: "builtin:cube",
    displayName: instanceId,
    parentFolderId: null,
    inspectable: null,
    shaderOverride: null,
    shaderParameterOverrides: [],
    transform: {
      position: [x, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number]
    }
  };
}

function makeTestRegion(): RegionDocument {
  return {
    identity: { id: REGION_ID, schema: "RegionDocument", version: 1 },
    displayName: "Test Region",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [placedAsset("prop_a", 0), placedAsset("prop_b", 10)],
    folders: [],
    environmentBinding: { defaultEnvironmentId: "env:default" },
    areas: [],
    behaviors: [],
    landscape: createDefaultRegionLandscapeState({ enabled: false }),
    markers: [],
    npcPresences: [],
    itemPresences: [],
    playerPresence: {
      presenceId: "player_1",
      transform: {
        position: [0, 0, 5] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number]
      }
    }
  } as unknown as RegionDocument;
}

function makeTestScene(): Scene {
  return createDefaultScene({ sceneId: "scene:test", regionId: REGION_ID });
}

const TARGET = {
  aggregateKind: "region-document" as const,
  aggregateId: REGION_ID
};

/** Shift every subject three units along x, the way a move drag would. */
function nudgeCommand(
  subjects: Array<{ subjectKind: string; subjectId: string; x: number }>
): SemanticCommand {
  return {
    kind: "TransformSceneObjects",
    target: TARGET,
    subject: {
      subjectKind: subjects[0].subjectKind,
      subjectId: subjects[0].subjectId
    },
    payload: {
      subjects: subjects.map((s) => ({
        subjectKind: s.subjectKind,
        subjectId: s.subjectId,
        position: [s.x + 3, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }))
    }
  } as SemanticCommand;
}

describe("transforming many objects", () => {
  it("moves every subject in one command", () => {
    const region = makeTestRegion();
    const result = executeCommand(
      { region, scene: makeTestScene() },
      nudgeCommand([
        { subjectKind: "placed-asset", subjectId: "prop_a", x: 0 },
        { subjectKind: "placed-asset", subjectId: "prop_b", x: 10 }
      ])
    );

    const positions = result.region.placedAssets.map(
      (asset) => asset.transform.position
    );
    expect(positions).toEqual([
      [3, 0, 0],
      [13, 0, 0]
    ]);
  });

  it("produces one transaction however many subjects it carries", () => {
    const region = makeTestRegion();
    const result = executeCommand(
      { region, scene: makeTestScene() },
      nudgeCommand([
        { subjectKind: "placed-asset", subjectId: "prop_a", x: 0 },
        { subjectKind: "placed-asset", subjectId: "prop_b", x: 10 }
      ])
    );

    expect(result.transaction.command.kind).toBe("TransformSceneObjects");
    expect(result.transaction.transactionId).toBeTruthy();
  });

  it("moves objects of different kinds together", () => {
    const region = makeTestRegion();
    const result = executeCommand(
      { region, scene: makeTestScene() },
      nudgeCommand([
        { subjectKind: "placed-asset", subjectId: "prop_a", x: 0 },
        { subjectKind: "player-presence", subjectId: "player_1", x: 0 }
      ])
    );

    expect(result.region.placedAssets[0].transform.position).toEqual([3, 0, 0]);
    expect(result.region.playerPresence?.transform.position).toEqual([3, 0, 0]);
  });

  it("leaves objects it was not given alone", () => {
    const region = makeTestRegion();
    const result = executeCommand(
      { region, scene: makeTestScene() },
      nudgeCommand([{ subjectKind: "placed-asset", subjectId: "prop_a", x: 0 }])
    );

    expect(result.region.placedAssets[1].transform.position).toEqual([
      10, 0, 0
    ]);
  });

  it("refuses a kind that has no transform command", () => {
    const region = makeTestRegion();
    expect(() =>
      executeCommand(
        { region, scene: makeTestScene() },
        nudgeCommand([
          { subjectKind: "region-marker", subjectId: "spawn_1", x: 0 }
        ])
      )
    ).toThrow(/region-marker/);
  });

  it("puts the whole selection back in one undo", () => {
    const project = createDefaultGameProject("Test", "test");
    let session = createAuthoringSession(project, [makeTestRegion()]);

    session = applyCommand(
      session,
      nudgeCommand([
        { subjectKind: "placed-asset", subjectId: "prop_a", x: 0 },
        { subjectKind: "placed-asset", subjectId: "prop_b", x: 10 }
      ])
    );
    expect(
      getActiveRegion(session)?.placedAssets.map((a) => a.transform.position)
    ).toEqual([
      [3, 0, 0],
      [13, 0, 0]
    ]);

    session = undoSession(session);

    expect(
      getActiveRegion(session)?.placedAssets.map((a) => a.transform.position)
    ).toEqual([
      [0, 0, 0],
      [10, 0, 0]
    ]);
  });
});
