import { describe, expect, it } from "vitest";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  createDefaultEnvironmentDefinition,
  createDefaultNPCDefinition,
  createDefaultPlayerDefinition,
  createAuthoringSession,
  applyCommand,
  getActiveRegion
} from "@sugarmagic/domain";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "station", schema: "RegionDocument", version: 1 },
    displayName: "Station",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    scene: {
      folders: [],
      placedAssets: [],
      playerPresence: null,
      npcPresences: []
    },
    environmentBinding: { defaultEnvironmentId: "project:environment:default" },
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 160,
      channels: [],
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

describe("layout scene presences", () => {
  it("enforces one player presence per region", () => {
    const session = createAuthoringSession(
      {
        identity: { id: "project", schema: "GameProject", version: 1 },
        displayName: "Project",
        gameRootPath: ".",
        regionRegistry: [{ regionId: "station" }],
        pluginConfigIds: [],
        contentLibraryId: "project:content-library",
        playerDefinition: createDefaultPlayerDefinition("project"),
        npcDefinitions: []
      },
      [makeRegion()],
      {
        identity: {
          id: "project:content-library",
          schema: "ContentLibrary",
          version: 1
        },
        assetDefinitions: [],
        environmentDefinitions: [
          createDefaultEnvironmentDefinition("project", {
            definitionId: "project:environment:default"
          })
        ]
      }
    );

    const once = applyCommand(session, {
      kind: "CreatePlayerPresence",
      target: {
        aggregateKind: "region-document",
        aggregateId: "station"
      },
      subject: {
        subjectKind: "player-presence",
        subjectId: "player-presence-1"
      },
      payload: {
        presenceId: "player-presence-1",
        position: [1, 0, 2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });

    const twice = applyCommand(once, {
      kind: "CreatePlayerPresence",
      target: {
        aggregateKind: "region-document",
        aggregateId: "station"
      },
      subject: {
        subjectKind: "player-presence",
        subjectId: "player-presence-2"
      },
      payload: {
        presenceId: "player-presence-2",
        position: [5, 0, 5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });

    expect(getActiveRegion(twice)?.scene.playerPresence?.presenceId).toBe(
      "player-presence-1"
    );
    expect(getActiveRegion(twice)?.scene.playerPresence?.transform.position).toEqual([
      1, 0, 2
    ]);
  });

  it("resolves player and NPC presences into shared scene objects", () => {
    const npcDefinition = createDefaultNPCDefinition({
      definitionId: "npc-guard",
      displayName: "Station Guard"
    });
    const playerDefinition = createDefaultPlayerDefinition("project", {
      displayName: "Player"
    });

    const region: RegionDocument = {
      ...makeRegion(),
      scene: {
        folders: [],
        placedAssets: [],
        playerPresence: {
          presenceId: "player-presence-1",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        },
        npcPresences: [
          {
            presenceId: "npc-presence-1",
            npcDefinitionId: npcDefinition.definitionId,
            transform: {
              position: [3, 0, -2],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            }
          }
        ]
      }
    };

    const sceneObjects = resolveSceneObjects(region, {
      playerDefinition,
      npcDefinitions: [npcDefinition],
      includePlayerPresence: true
    });

    expect(sceneObjects.map((object) => object.kind)).toEqual(["player", "npc"]);
    expect(sceneObjects[0]?.displayName).toBe("Player");
    expect(sceneObjects[1]?.displayName).toBe("Station Guard");
    expect(sceneObjects[1]?.transform.position).toEqual([3, 0, -2]);
  });
});
