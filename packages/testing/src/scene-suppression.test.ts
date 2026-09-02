/**
 * Hiding region content for one Scene (epic #226 story 8).
 *
 * Story 3 built suppression into composition and nothing could write it.
 * The scene composer is where an author does, so this covers the command:
 * it names a region-owned id rather than copying the thing, it is
 * per-Scene, and it undoes like every other authoring edit.
 */

import { describe, expect, it } from "vitest";
import {
  applyCommand,
  composeRegionContents,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createRegionNPCPresence,
  findSceneById,
  getAllScenes,
  type GameProject,
  type SemanticCommand
} from "@sugarmagic/domain";

const REGION_ID = "region:station";
const RESIDENT_ID = "presence:finnick";

function sessionWithResident() {
  const region = createDefaultRegion({
    regionId: REGION_ID,
    displayName: "Station"
  });
  region.npcPresences = [
    createRegionNPCPresence({
      presenceId: RESIDENT_ID,
      npcDefinitionId: "npc:finnick"
    })
  ];
  const base = createDefaultGameProject("Test", "test");
  const project: GameProject = {
    ...base,
    episodes: base.episodes.map((episode) => ({
      ...episode,
      scenes: episode.scenes.map((scene) => ({
        ...scene,
        regionId: REGION_ID
      }))
    }))
  };
  return { session: createAuthoringSession(project, [region]), region };
}

function suppress(
  sceneId: string,
  regionOwnedId: string,
  suppressed: boolean
): SemanticCommand {
  return {
    kind: "SetSceneSuppression",
    target: { aggregateKind: "game-project", aggregateId: "test" },
    subject: { subjectKind: "scene", subjectId: sceneId },
    payload: { sceneId, regionOwnedId, suppressed }
  };
}

describe("suppressing region content for a Scene", () => {
  it("hides the resident in that Scene and composition drops it", () => {
    const { session, region } = sessionWithResident();
    const sceneId = getAllScenes(session.gameProject.episodes)[0]!.sceneId;

    const next = applyCommand(session, suppress(sceneId, RESIDENT_ID, true));
    const scene = findSceneById(next.gameProject.episodes, sceneId)!;

    expect(scene.overlay.suppressedRegionIds).toEqual([RESIDENT_ID]);
    expect(composeRegionContents(region, scene).npcPresences).toEqual([]);
  });

  it("names the id rather than copying the thing", () => {
    const { session, region } = sessionWithResident();
    const sceneId = getAllScenes(session.gameProject.episodes)[0]!.sceneId;

    const next = applyCommand(session, suppress(sceneId, RESIDENT_ID, true));
    const scene = findSceneById(next.gameProject.episodes, sceneId)!;

    // The region still owns it: suppression hides, it never edits or
    // moves the thing, so there is no second copy to drift.
    expect(region.npcPresences).toHaveLength(1);
    expect(scene.overlay.npcPresences).toEqual([]);
  });

  it("un-suppressing brings it back", () => {
    const { session, region } = sessionWithResident();
    const sceneId = getAllScenes(session.gameProject.episodes)[0]!.sceneId;

    const hidden = applyCommand(session, suppress(sceneId, RESIDENT_ID, true));
    const shown = applyCommand(hidden, suppress(sceneId, RESIDENT_ID, false));
    const scene = findSceneById(shown.gameProject.episodes, sceneId)!;

    expect(scene.overlay.suppressedRegionIds).toEqual([]);
    expect(composeRegionContents(region, scene).npcPresences).toHaveLength(1);
  });

  it("suppressing twice does not stack duplicate ids", () => {
    const { session } = sessionWithResident();
    const sceneId = getAllScenes(session.gameProject.episodes)[0]!.sceneId;

    const once = applyCommand(session, suppress(sceneId, RESIDENT_ID, true));
    const twice = applyCommand(once, suppress(sceneId, RESIDENT_ID, true));

    expect(
      findSceneById(twice.gameProject.episodes, sceneId)!.overlay
        .suppressedRegionIds
    ).toEqual([RESIDENT_ID]);
    // A no-op edit must not push an undo step either.
    expect(twice).toBe(once);
  });
});
