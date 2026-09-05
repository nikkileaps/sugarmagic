/**
 * A navmesh follows the composition it was baked from (epic #226 story 15).
 *
 * Before this, one artifact per REGION was baked with whatever Scene
 * Studio happened to have open, so playing a different Scene pathed
 * against the wrong obstacle set. Story 3's suppression made that
 * reachable: a Scene can now remove a wall, and NPCs would still walk
 * around where it used to be.
 *
 * A navmesh is one connected mesh, so a Scene's REPLACES the region's
 * rather than adding to it -- two overlaid meshes have no coherent
 * polygon adjacency. A Scene with none did not change what blocks
 * movement, and inherits.
 */

import { describe, expect, it } from "vitest";
import {
  mapEpisodes,
  getAllEpisodes,
  applyCommand,
  collectFileBackedAssetPaths,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultScene,
  createEmptyContentLibrarySnapshot,
  getAllScenes,
  normalizeScene,
  type RegionNavMeshArtifact,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "region:hollow";

const ARTIFACT: RegionNavMeshArtifact = {
  assetPath: "assets/navmesh/region-hollow.scene-market.navmesh.bin",
  inputHash: "scene-hash",
  agentRadius: 0.35
};

function sessionWithScene() {
  const region = createDefaultRegion({
    regionId: REGION_ID,
    displayName: "Hollow"
  });
  const base = createDefaultGameProject("Test", "test");
  return createAuthoringSession(
    {
      ...base,
      seasons: mapEpisodes(base.seasons, (episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          regionId: REGION_ID
        }))
      }))
    },
    [region]
  );
}

function setSceneNavMesh(
  sceneId: string,
  navMesh: RegionNavMeshArtifact | null
): SemanticCommand {
  return {
    kind: "SetSceneNavMesh",
    target: { aggregateKind: "game-project", aggregateId: "test" },
    subject: { subjectKind: "scene", subjectId: sceneId },
    payload: { sceneId, navMesh }
  } as SemanticCommand;
}

describe("a Scene's own navmesh", () => {
  it("a Scene starts with none, meaning it inherits the region's", () => {
    expect(createDefaultScene({ sceneId: "scene:a" }).navMesh).toBeNull();
  });

  it("is recorded on the Scene that owns it", () => {
    const session = sessionWithScene();
    const sceneId = getAllScenes(getAllEpisodes(session.gameProject.seasons))[0]!.sceneId;

    const next = applyCommand(session, setSceneNavMesh(sceneId, ARTIFACT));

    expect(getAllScenes(getAllEpisodes(next.gameProject.seasons))[0]!.navMesh).toEqual(
      ARTIFACT
    );
  });

  it("clears when the Scene stops differing from its region", () => {
    // The bake clears an artifact whose composition no longer differs.
    // Left behind, the Scene would keep pathing against a composition that
    // is no longer real.
    const session = sessionWithScene();
    const sceneId = getAllScenes(getAllEpisodes(session.gameProject.seasons))[0]!.sceneId;
    const baked = applyCommand(session, setSceneNavMesh(sceneId, ARTIFACT));

    const cleared = applyCommand(baked, setSceneNavMesh(sceneId, null));

    expect(getAllScenes(getAllEpisodes(cleared.gameProject.seasons))[0]!.navMesh).toBeNull();
  });

  it("re-baking to the same artifact is not an edit", () => {
    const session = sessionWithScene();
    const sceneId = getAllScenes(getAllEpisodes(session.gameProject.seasons))[0]!.sceneId;
    const once = applyCommand(session, setSceneNavMesh(sceneId, ARTIFACT));

    const twice = applyCommand(once, setSceneNavMesh(sceneId, { ...ARTIFACT }));

    // A bake that changed nothing must not push an undo step.
    expect(twice).toBe(once);
  });

  it("survives a load, and a file written before Scenes had one reads as inherit", () => {
    expect(
      normalizeScene({ sceneId: "scene:a", navMesh: ARTIFACT } as never)?.navMesh
    ).toEqual(ARTIFACT);
    expect(normalizeScene({ sceneId: "scene:a" } as never)?.navMesh).toBeNull();
  });

  it("drops a stored reference with no path rather than keeping a broken one", () => {
    expect(
      normalizeScene({
        sceneId: "scene:a",
        navMesh: { inputHash: "x", agentRadius: 0.3 }
      } as never)?.navMesh
    ).toBeNull();
  });
});

describe("shipping the artifacts", () => {
  it("collects a Scene's navmesh, not just the region's", () => {
    // Missed here, a deploy ships the pointer without the file and the
    // runtime falls back to straight-line steering without saying so.
    const region = createDefaultRegion({
      regionId: REGION_ID,
      displayName: "Hollow"
    });
    region.navMesh = {
      assetPath: "assets/navmesh/region-hollow.navmesh.bin",
      inputHash: "region-hash",
      agentRadius: 0.35
    };
    const scene = { ...createDefaultScene({ sceneId: "scene:market" }), navMesh: ARTIFACT };

    const paths = collectFileBackedAssetPaths({
      contentLibrary: createEmptyContentLibrarySnapshot("test"),
      regions: [region],
      scenes: [scene]
    });

    expect(paths).toContain("assets/navmesh/region-hollow.navmesh.bin");
    expect(paths).toContain(ARTIFACT.assetPath);
  });

  it("ships nothing for a Scene that inherits", () => {
    const paths = collectFileBackedAssetPaths({
      contentLibrary: createEmptyContentLibrarySnapshot("test"),
      scenes: [createDefaultScene({ sceneId: "scene:quiet" })]
    });

    expect(paths.some((path) => path.includes("navmesh"))).toBe(false);
  });
});
