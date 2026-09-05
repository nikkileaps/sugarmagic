/**
 * A Scene only applies inside its own region.
 *
 * A Scene happens in exactly one region. Every reader holding a Scene and
 * a region has to ask whether they match, and there were two places that
 * answered it differently: the overlay went through
 * `sceneOverlayForRegion`, while the navmesh and the command executor each
 * did their own thing. Both got it wrong in the same direction -- they
 * used a Scene belonging to somewhere else, or silently did nothing.
 */

import { describe, expect, it } from "vitest";
import {
  mapEpisodes,
  getAllEpisodes,
  applyCommand,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultScene,
  navMeshForRegion,
  sceneDressesRegion,
  sceneOverlayForRegion,
  type RegionNavMeshArtifact,
  type SemanticCommand
} from "@sugarmagic/domain";

const HERE = "region:hollow";
const ELSEWHERE = "region:market";

const REGION_MESH: RegionNavMeshArtifact = {
  assetPath: "assets/navmesh/hollow.navmesh.bin",
  inputHash: "region",
  agentRadius: 0.35
};
const SCENE_MESH: RegionNavMeshArtifact = {
  assetPath: "assets/navmesh/hollow.festival.navmesh.bin",
  inputHash: "scene",
  agentRadius: 0.35
};

function regionWithMesh(navMesh: RegionNavMeshArtifact | null) {
  return {
    ...createDefaultRegion({ regionId: HERE, displayName: "Hollow" }),
    navMesh
  };
}

const sceneIn = (regionId: string, navMesh: RegionNavMeshArtifact | null) => ({
  ...createDefaultScene({ sceneId: "scene:festival" }),
  regionId,
  navMesh
});

describe("does this Scene dress this region", () => {
  it("yes when the Scene names it", () => {
    expect(sceneDressesRegion(sceneIn(HERE, null), HERE)).toBe(true);
  });

  it("no when the Scene happens somewhere else", () => {
    expect(sceneDressesRegion(sceneIn(ELSEWHERE, null), HERE)).toBe(false);
  });

  it("no when there is no Scene at all -- free roam", () => {
    expect(sceneDressesRegion(null, HERE)).toBe(false);
    expect(sceneOverlayForRegion(null, HERE)).toBeNull();
  });
});

describe("which navmesh a region paths against", () => {
  it("the Scene's, when the Scene dresses this region", () => {
    expect(
      navMeshForRegion(sceneIn(HERE, SCENE_MESH), regionWithMesh(REGION_MESH))
    ).toEqual(SCENE_MESH);
  });

  it("the region's, when the Scene happens somewhere else", () => {
    // The bug this pins: walking through a doorway kept the Scene from the
    // region just left, so the new region pathed against a navmesh baked
    // for a different place. NPCs walked around walls that were not there.
    expect(
      navMeshForRegion(
        sceneIn(ELSEWHERE, SCENE_MESH),
        regionWithMesh(REGION_MESH)
      )
    ).toEqual(REGION_MESH);
  });

  it("the region's, when the Scene baked none of its own", () => {
    expect(
      navMeshForRegion(sceneIn(HERE, null), regionWithMesh(REGION_MESH))
    ).toEqual(REGION_MESH);
  });

  it("nothing, when neither has one", () => {
    expect(navMeshForRegion(sceneIn(HERE, null), regionWithMesh(null))).toBeNull();
  });
});

describe("editing a Scene that happens somewhere else", () => {
  function sessionEditing(regionId: string) {
    const base = createDefaultGameProject("Test", "test");
    // The project's Scene dresses HERE; the region being edited is the
    // argument, so passing ELSEWHERE is the mismatch case.
    return createAuthoringSession(
      {
        ...base,
        seasons: mapEpisodes(base.seasons, (episode) => ({
          ...episode,
          scenes: episode.scenes.map((scene) => ({ ...scene, regionId: HERE }))
        }))
      },
      [
        createDefaultRegion({ regionId: HERE, displayName: "Hollow" }),
        createDefaultRegion({ regionId: ELSEWHERE, displayName: "Market" })
      ]
    );
  }

  // Naming the region explicitly is how a quest-side dispatch reaches a
  // region other than the one Studio has open -- the path that can hand the
  // executor a region the active Scene does not dress.
  const createNpcInScene = (regionId: string): SemanticCommand => ({
    kind: "CreateNPCPresence",
    target: { aggregateKind: "region-document", aggregateId: regionId },
    subject: { subjectKind: "npc-presence", subjectId: "presence:1" },
    payload: {
      presenceId: "presence:1",
      npcDefinitionId: "npc:jonas",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    }
  });

  it("says so instead of quietly placing nothing", () => {
    // It used to return the Scene unchanged: the command reported success,
    // the undo stack grew a step that undid nothing, and the author was
    // left looking at a viewport where the NPC they placed never appeared.
    const session = sessionEditing(ELSEWHERE);

    expect(() =>
      applyCommand(session, createNpcInScene(ELSEWHERE))
    ).toThrowError(/happens in region/);
  });

  it("places it when the Scene does dress the region", () => {
    const session = sessionEditing(HERE);

    const next = applyCommand(session, createNpcInScene(HERE));

    expect(
      sceneOverlayForRegion(
        getAllEpisodes(next.gameProject.seasons)[0]!.scenes[0]!,
        HERE
      )?.npcPresences.map((presence) => presence.presenceId)
    ).toEqual(["presence:1"]);
  });
});
