import { describe, expect, it } from "vitest";
import type { RegionDocument, Scene } from "@sugarmagic/domain";
import {
  createDefaultEnvironmentDefinition,
  createDefaultDeploymentSettings,
  createDefaultFoliageWindShaderGraph,
  createDefaultNPCDefinition,
  createDefaultPlayerDefinition,
  createDefaultScene,
  createAuthoringSession,
  applyCommand,
  getActiveRegionContents,
  normalizeGameProject
} from "@sugarmagic/domain";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";

function makeRegion(): RegionDocument {
  return {
    identity: { id: "station", schema: "RegionDocument", version: 1 },
    displayName: "Station",
    placement: { gridPosition: { x: 0, y: 0 }, placementPolicy: "world-grid" },
    placedAssets: [],
    folders: [],
    environmentBinding: { defaultEnvironmentId: "project:environment:default" },
    areas: [],
    behaviors: [],
    landscape: {
      enabled: false,
      size: 100,
      subdivisions: 160,
      surfaceSlots: [],
      deform: null,
      effect: null,
      paintPayload: null
    },
    markers: [],
    gameplayPlacements: []
  };
}

describe("layout scene presences", () => {
  it("enforces one player presence per (scene, region)", () => {
    const session = createAuthoringSession(
      normalizeGameProject({
        identity: { id: "project", schema: "GameProject", version: 1 },
        displayName: "Project",
        gameRootPath: ".",
        deployment: createDefaultDeploymentSettings(),
        regionRegistry: [{ regionId: "station" }],
        pluginConfigurations: [],
        contentLibraryId: "project:content-library",
        playerDefinition: createDefaultPlayerDefinition("project"),
        spellDefinitions: [],
        npcDefinitions: [],
        dialogueDefinitions: [],
        itemDefinitions: [],
        documentDefinitions: [],
        questDefinitions: []
      }),
      [makeRegion()],
      {
        identity: {
          id: "project:content-library",
          schema: "ContentLibrary",
          version: 1
        },
        assetDefinitions: [],
        characterAnimationDefinitions: [],
        characterModelDefinitions: [],
        materialDefinitions: [],
        textureDefinitions: [],
        environmentDefinitions: [
          createDefaultEnvironmentDefinition("project", {
            definitionId: "project:environment:default"
          })
        ],
        shaderDefinitions: [createDefaultFoliageWindShaderGraph("project")]
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

    // Plan 058 §058.1 — presence lands in the active Scene's
    // overlay; the composed view is where authoring reads it back.
    const contents = getActiveRegionContents(twice);
    expect(contents?.playerPresence?.presenceId).toBe("player-presence-1");
    expect(contents?.playerPresence?.transform.position).toEqual([1, 0, 2]);
  });

  it("resolves player and NPC presences into shared scene objects", () => {
    const npcDefinition = createDefaultNPCDefinition({
      definitionId: "npc-guard",
      displayName: "Station Guard"
    });
    const playerDefinition = createDefaultPlayerDefinition("project", {
      displayName: "Player"
    });

    const region = makeRegion();
    // Plan 058 §058.1 — presences live on the Scene overlay and
    // compose onto the region base at resolve time.
    const scene: Scene = createDefaultScene({
      sceneId: "scene:test",
      regionOverlays: {
        [region.identity.id]: {
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
              shaderOverride: null,
              shaderParameterOverrides: [],
              transform: {
                position: [3, 0, -2],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ],
          itemPresences: []
        }
      }
    });

    const sceneObjects = resolveSceneObjects(region, {
      playerDefinition,
      npcDefinitions: [npcDefinition],
      includePlayerPresence: true,
      activeScene: scene
    });

    expect(sceneObjects.map((object) => object.kind)).toEqual(["player", "npc"]);
    expect(sceneObjects[0]?.displayName).toBe("Player");
    expect(sceneObjects[1]?.displayName).toBe("Station Guard");
    expect(sceneObjects[1]?.transform.position).toEqual([3, 0, -2]);
  });
});
