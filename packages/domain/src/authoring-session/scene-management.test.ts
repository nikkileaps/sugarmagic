/**
 * packages/domain/src/authoring-session/scene-management.test.ts
 *
 * Purpose: Pins Plan 058 §058.3's session-level Scene management —
 * CRUD guards (never zero Scenes), scope conversion moving assets
 * between region base and the active overlay, and cross-Scene
 * copy minting fresh ids.
 *
 * Implements: Plan 058 §058.3 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  addSceneToSession,
  copyOverlayEntryToScene,
  convertAssetScopeInSession,
  createAuthoringSession,
  deleteSceneFromSession,
  getActiveScene,
  getActiveRegionContents,
  normalizeGameProject,
  reorderSceneInSession,
  switchActiveScene,
  updateSceneInSession,
  createDefaultPlayerDefinition,
  createDefaultRegion,
  createPlacedAssetInstance,
  createRegionNPCPresence,
  getAllScenes,
  mapScenes,
  type AuthoringSession
} from "../index";

/** Every Scene in the session, flattened across Episodes. */
function scenesOf(session: AuthoringSession) {
  return getAllScenes(session.gameProject.episodes);
}

function makeSession(): AuthoringSession {
  const session = createAuthoringSession(
    normalizeGameProject({
      identity: { id: "project", schema: "GameProject", version: 1 },
      displayName: "Project",
      gameRootPath: ".",
      regionRegistry: [{ regionId: "region:town" }],
      pluginConfigurations: [],
      contentLibraryId: "project:content-library",
      playerDefinition: createDefaultPlayerDefinition("project"),
      spellDefinitions: [],
      npcDefinitions: [],
      dialogueDefinitions: [],
      itemDefinitions: [],
      documentDefinitions: []
    }),
    [createDefaultRegion({ regionId: "region:town", displayName: "Town" })]
  );
  return session;
}

describe("Scene CRUD", () => {
  it("adds an empty Scene at the end of the order and makes it active", () => {
    const session = addSceneToSession(makeSession(), {
      displayName: "Scene 2"
    });
    expect(scenesOf(session)).toHaveLength(2);
    const added = scenesOf(session)[1]!;
    expect(added.displayName).toBe("Scene 2");
    expect(added.overlay.placedAssets).toEqual([]);
    // Appending IS the ordering — the new Scene lands last in its
    // Episode, with no order number to compute.
    expect(session.gameProject.episodes).toHaveLength(1);
    expect(
      session.gameProject.episodes[0]!.scenes.map((scene) => scene.displayName)
    ).toEqual(["Scene 1", "Scene 2"]);
    expect(session.activeSceneId).toBe(added.sceneId);
    expect(session.isDirty).toBe(true);
  });

  it("renames a Scene", () => {
    let session = makeSession();
    const sceneId = scenesOf(session)[0]!.sceneId;
    session = updateSceneInSession(session, sceneId, {
      displayName: "The Founding"
    });
    expect(scenesOf(session)[0]!.displayName).toBe("The Founding");
  });

  it("patches per-Scene properties (Plan 058 §058.6 panel fields)", () => {
    let session = makeSession();
    const sceneId = scenesOf(session)[0]!.sceneId;
    session = updateSceneInSession(session, sceneId, {
      description: "The player arrives at the station.",
      notes: "TODO: rain",
      environmentOverride: { environmentId: "env:twilight" },
      transitionConfig: {
        titleText: "SCENE 1",
        subtitleText: "Arrival",
        durationMs: 2000,
        fadeStyle: "cross"
      }
    });
    const scene = scenesOf(session)[0]!;
    expect(scene.description).toBe("The player arrives at the station.");
    expect(scene.notes).toBe("TODO: rain");
    expect(scene.environmentOverride).toEqual({
      environmentId: "env:twilight"
    });
    expect(scene.transitionConfig?.titleText).toBe("SCENE 1");
    // Clearing back to defaults round-trips.
    session = updateSceneInSession(session, sceneId, {
      environmentOverride: null,
      transitionConfig: null
    });
    expect(scenesOf(session)[0]!.environmentOverride).toBeNull();
    expect(scenesOf(session)[0]!.transitionConfig).toBeNull();
  });

  it("refuses to delete the last Scene", () => {
    const session = makeSession();
    const sceneId = scenesOf(session)[0]!.sceneId;
    expect(deleteSceneFromSession(session, sceneId)).toBe(session);
  });

  it("deletes a Scene and repoints the active pointer", () => {
    let session = addSceneToSession(makeSession(), { displayName: "Scene 2" });
    const secondId = session.activeSceneId!;
    session = deleteSceneFromSession(session, secondId);
    expect(scenesOf(session)).toHaveLength(1);
    expect(session.activeSceneId).toBe(scenesOf(session)[0]!.sceneId);
  });

  it("reorders Scenes by moving the entry, with nothing to renumber", () => {
    let session = addSceneToSession(makeSession(), { displayName: "Scene 2" });
    const [first, second] = scenesOf(session);
    session = reorderSceneInSession(session, second!.sceneId, "up");
    expect(scenesOf(session).map((scene) => scene.sceneId)).toEqual([
      second!.sceneId,
      first!.sceneId
    ]);
    // No-op at the boundary — a Scene does not hop into a
    // neighbouring Episode.
    expect(
      scenesOf(reorderSceneInSession(session, second!.sceneId, "up"))
    ).toEqual(scenesOf(session));
  });

  it("deleting the middle Scene leaves the rest contiguous", () => {
    let session = addSceneToSession(makeSession(), { displayName: "Scene 2" });
    session = addSceneToSession(session, { displayName: "Scene 3" });
    const middleId = scenesOf(session)[1]!.sceneId;
    session = deleteSceneFromSession(session, middleId);
    expect(scenesOf(session).map((scene) => scene.displayName)).toEqual([
      "Scene 1",
      "Scene 3"
    ]);
  });
});

describe("scope conversion", () => {
  function sessionWithBaseAsset(): AuthoringSession {
    const session = makeSession();
    const region = session.regions.get("region:town")!;
    const newRegions = new Map(session.regions);
    newRegions.set("region:town", {
      ...region,
      placedAssets: [
        createPlacedAssetInstance({
          instanceId: "asset:statue",
          assetDefinitionId: "def:statue",
          displayName: "Statue"
        })
      ]
    });
    return { ...session, regions: newRegions };
  }

  it("moves a base asset into the active Scene overlay and back", () => {
    let session = sessionWithBaseAsset();
    const sceneId = getActiveScene(session)!.sceneId;

    session = convertAssetScopeInSession(session, {
      regionId: "region:town",
      instanceId: "asset:statue"
    });
    expect(session.regions.get("region:town")!.placedAssets).toHaveLength(0);
    const overlay = getActiveScene(session)!.overlay;
    expect(overlay.placedAssets.map((asset) => asset.instanceId)).toEqual([
      "asset:statue"
    ]);
    // Composed view still shows it (same Scene active).
    expect(
      getActiveRegionContents(session)!.placedAssets.map(
        (asset) => asset.instanceId
      )
    ).toEqual(["asset:statue"]);

    // Round-trip: promote back to Base.
    session = convertAssetScopeInSession(session, {
      regionId: "region:town",
      instanceId: "asset:statue"
    });
    expect(
      session.regions.get("region:town")!.placedAssets.map(
        (asset) => asset.instanceId
      )
    ).toEqual(["asset:statue"]);
    expect(
      getActiveScene(session)!.overlay.placedAssets
    ).toHaveLength(0);
    expect(getActiveScene(session)!.sceneId).toBe(sceneId);
  });

  it("clears the folder assignment when converting (folders stay in their scope)", () => {
    let session = sessionWithBaseAsset();
    const region = session.regions.get("region:town")!;
    const newRegions = new Map(session.regions);
    newRegions.set("region:town", {
      ...region,
      folders: [
        { folderId: "folder:props", displayName: "Props", parentFolderId: null }
      ],
      placedAssets: [
        { ...region.placedAssets[0]!, parentFolderId: "folder:props" }
      ]
    });
    session = { ...session, regions: newRegions };

    session = convertAssetScopeInSession(session, {
      regionId: "region:town",
      instanceId: "asset:statue"
    });
    const overlay = getActiveScene(session)!.overlay;
    expect(overlay.placedAssets[0]!.parentFolderId).toBeNull();
  });
});

describe("cross-Scene copy", () => {
  it("copies an NPC presence into another Scene with a fresh id", () => {
    let session = makeSession();
    const sceneOneId = scenesOf(session)[0]!.sceneId;
    // Seed an NPC presence in Scene 1's overlay.
    session = {
      ...session,
      gameProject: {
        ...session.gameProject,
        episodes: mapScenes(session.gameProject.episodes, (scene) => ({
          ...scene,
          regionId: "region:town",
          overlay: {
              suppressedRegionIds: [],
              assetAppearanceOverrides: {},
              folders: [],
              placedAssets: [],
              placedLights: [],
              playerPresence: null,
              npcPresences: [
                createRegionNPCPresence({
                  presenceId: "npc:testy",
                  npcDefinitionId: "def:testy",
                  transform: {
                    position: [3, 0, 3],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1]
                  }
                })
              ],
              itemPresences: []
            }
        }))
      }
    };
    session = addSceneToSession(session, { displayName: "Scene 2" });
    const sceneTwoId = session.activeSceneId!;

    session = copyOverlayEntryToScene(session, {
      fromSceneId: sceneOneId,
      toSceneId: sceneTwoId,
      regionId: "region:town",
      kind: "npc",
      id: "npc:testy"
    });

    const sceneTwo = scenesOf(session).find(
      (scene) => scene.sceneId === sceneTwoId
    )!;
    const copied = sceneTwo.overlay.npcPresences[0]!;
    expect(copied.npcDefinitionId).toBe("def:testy");
    expect(copied.transform.position).toEqual([3, 0, 3]);
    expect(copied.presenceId).not.toBe("npc:testy");
    // Source untouched.
    const sceneOne = scenesOf(session).find(
      (scene) => scene.sceneId === sceneOneId
    )!;
    expect(
      sceneOne.overlay.npcPresences[0]!.presenceId
    ).toBe("npc:testy");
  });

  it("never clobbers an existing player spawn in the destination", () => {
    let session = makeSession();
    const sceneOneId = scenesOf(session)[0]!.sceneId;
    session = {
      ...session,
      gameProject: {
        ...session.gameProject,
        episodes: mapScenes(session.gameProject.episodes, (scene) => ({
          ...scene,
          regionId: "region:town",
          overlay: {
              suppressedRegionIds: [],
              assetAppearanceOverrides: {},
              folders: [],
              placedAssets: [],
              placedLights: [],
              playerPresence: {
                presenceId: "player:1",
                transform: {
                  position: [1, 0, 1],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1]
                }
              },
              npcPresences: [],
              itemPresences: []
            }
        }))
      }
    };
    session = addSceneToSession(session, { displayName: "Scene 2" });
    const sceneTwoId = session.activeSceneId!;
    // Give Scene 2 its own spawn first.
    session = copyOverlayEntryToScene(session, {
      fromSceneId: sceneOneId,
      toSceneId: sceneTwoId,
      regionId: "region:town",
      kind: "player",
      id: "player:1"
    });
    const firstCopy = scenesOf(session).find(
      (scene) => scene.sceneId === sceneTwoId
    )!.overlay.playerPresence;
    expect(firstCopy).not.toBeNull();
    // Second copy is a no-op.
    const again = copyOverlayEntryToScene(session, {
      fromSceneId: sceneOneId,
      toSceneId: sceneTwoId,
      regionId: "region:town",
      kind: "player",
      id: "player:1"
    });
    expect(
      scenesOf(again).find((scene) => scene.sceneId === sceneTwoId)!
        .overlay.playerPresence
    ).toEqual(firstCopy);
  });

  it("switching Scenes shows different composed contents", () => {
    let session = makeSession();
    const sceneOneId = scenesOf(session)[0]!.sceneId;
    session = {
      ...session,
      gameProject: {
        ...session.gameProject,
        episodes: mapScenes(session.gameProject.episodes, (scene) => ({
          ...scene,
          regionId: "region:town",
          overlay: {
              suppressedRegionIds: [],
              assetAppearanceOverrides: {},
              folders: [],
              placedAssets: [],
              placedLights: [],
              playerPresence: null,
              npcPresences: [
                createRegionNPCPresence({
                  presenceId: "npc:testy",
                  npcDefinitionId: "def:testy"
                })
              ],
              itemPresences: []
            }
        }))
      }
    };
    session = addSceneToSession(session, { displayName: "Scene 2" });
    // Active = empty Scene 2: no presences.
    expect(getActiveRegionContents(session)!.npcPresences).toHaveLength(0);
    // Back to Scene 1: Testy is there.
    session = switchActiveScene(session, sceneOneId);
    expect(getActiveRegionContents(session)!.npcPresences).toHaveLength(1);
  });
});
