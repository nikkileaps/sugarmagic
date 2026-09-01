/**
 * packages/domain/src/authoring-session/episode-management.test.ts
 *
 * Purpose: Pins session-level Episode management — CRUD guards
 * (never zero Episodes, never an empty Episode), ordering by list
 * position, and moving a Scene between Episodes without breaking
 * single ownership.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  addEpisodeToSession,
  addSceneToSession,
  createAuthoringSession,
  createDefaultPlayerDefinition,
  createDefaultRegion,
  deleteEpisodeFromSession,
  deleteSceneFromSession,
  findEpisodeBySceneId,
  getAllScenes,
  moveSceneToEpisodeInSession,
  normalizeGameProject,
  reorderEpisodeInSession,
  updateEpisodeEndRoutingInSession,
  updateEpisodeInSession,
  type AuthoringSession
} from "../index";

function makeSession(): AuthoringSession {
  return createAuthoringSession(
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
}

describe("Episode CRUD", () => {
  it("starts with exactly one Episode holding one Scene", () => {
    const session = makeSession();
    expect(session.gameProject.episodes).toHaveLength(1);
    expect(session.gameProject.episodes[0]!.scenes).toHaveLength(1);
  });

  it("appends a new Episode at the end, holding an empty Scene", () => {
    const session = addEpisodeToSession(makeSession(), {
      displayName: "The Rackwick Job"
    });
    expect(session.gameProject.episodes).toHaveLength(2);
    const added = session.gameProject.episodes[1]!;
    expect(added.displayName).toBe("The Rackwick Job");
    expect(added.unlockCondition).toBe("always");
    // An Episode with no Scenes cannot be entered, so it never
    // starts out empty.
    expect(added.scenes).toHaveLength(1);
    expect(session.activeSceneId).toBe(added.scenes[0]!.sceneId);
    expect(session.isDirty).toBe(true);
  });

  it("falls back to a placeholder name for a blank one", () => {
    const session = addEpisodeToSession(makeSession(), { displayName: "   " });
    expect(session.gameProject.episodes[1]!.displayName).toBe(
      "Untitled Episode"
    );
  });

  it("renames an Episode and sets its gate", () => {
    let session = makeSession();
    const episodeId = session.gameProject.episodes[0]!.episodeId;
    session = updateEpisodeInSession(session, episodeId, {
      displayName: "Wordlark Hollow",
      unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
    });
    expect(session.gameProject.episodes[0]!.displayName).toBe(
      "Wordlark Hollow"
    );
    expect(session.gameProject.episodes[0]!.unlockCondition).toEqual({
      kind: "questComplete",
      questDefinitionId: "q:1"
    });
  });

  it("refuses to delete the last Episode", () => {
    const session = makeSession();
    const episodeId = session.gameProject.episodes[0]!.episodeId;
    expect(deleteEpisodeFromSession(session, episodeId)).toBe(session);
  });

  it("deletes an Episode with its Scenes and repoints the active pointer", () => {
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    const secondId = session.gameProject.episodes[1]!.episodeId;
    // The active Scene is inside the Episode being deleted.
    session = deleteEpisodeFromSession(session, secondId);
    expect(session.gameProject.episodes).toHaveLength(1);
    expect(session.activeSceneId).toBe(
      session.gameProject.episodes[0]!.scenes[0]!.sceneId
    );
  });

  it("leaves the active pointer alone when it survives the delete", () => {
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    const firstSceneId = session.gameProject.episodes[0]!.scenes[0]!.sceneId;
    const secondId = session.gameProject.episodes[1]!.episodeId;
    session = { ...session, activeSceneId: firstSceneId };
    session = deleteEpisodeFromSession(session, secondId);
    expect(session.activeSceneId).toBe(firstSceneId);
  });

  it("reorders by moving the entry, with nothing to renumber", () => {
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    const [first, second] = session.gameProject.episodes;
    session = reorderEpisodeInSession(session, second!.episodeId, "up");
    expect(
      session.gameProject.episodes.map((episode) => episode.episodeId)
    ).toEqual([second!.episodeId, first!.episodeId]);
    // No-op at the boundary.
    expect(
      reorderEpisodeInSession(session, second!.episodeId, "up").gameProject
        .episodes
    ).toEqual(session.gameProject.episodes);
  });
});

describe("moving a Scene between Episodes", () => {
  it("removes it from one and appends it to the other, exactly once", () => {
    let session = makeSession();
    // Two Scenes in Episode one so the move does not empty it.
    session = addSceneToSession(session, { displayName: "Scene 2" });
    session = addEpisodeToSession(session, { displayName: "Two" });
    const fromId = session.gameProject.episodes[0]!.episodeId;
    const toId = session.gameProject.episodes[1]!.episodeId;
    const movingId = session.gameProject.episodes[0]!.scenes[1]!.sceneId;

    session = moveSceneToEpisodeInSession(session, movingId, toId);

    expect(
      session.gameProject.episodes[0]!.scenes.map((scene) => scene.sceneId)
    ).not.toContain(movingId);
    expect(
      session.gameProject.episodes[1]!.scenes.map((scene) => scene.sceneId)
    ).toContain(movingId);
    // Single ownership: it appears in exactly one Episode.
    expect(
      getAllScenes(session.gameProject.episodes).filter(
        (scene) => scene.sceneId === movingId
      )
    ).toHaveLength(1);
    expect(findEpisodeBySceneId(session.gameProject.episodes, movingId)
      ?.episodeId).toBe(toId);
    expect(fromId).not.toBe(toId);
  });

  it("appends to the end of the destination rather than the front", () => {
    let session = makeSession();
    session = addSceneToSession(session, { displayName: "Mover" });
    session = addEpisodeToSession(session, { displayName: "Two" });
    const toId = session.gameProject.episodes[1]!.episodeId;
    const movingId = session.gameProject.episodes[0]!.scenes[1]!.sceneId;
    session = moveSceneToEpisodeInSession(session, movingId, toId);
    const destination = session.gameProject.episodes[1]!.scenes;
    expect(destination[destination.length - 1]!.sceneId).toBe(movingId);
  });

  it("refuses to empty the source Episode", () => {
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    const onlySceneId = session.gameProject.episodes[0]!.scenes[0]!.sceneId;
    const toId = session.gameProject.episodes[1]!.episodeId;
    // An Episode with no Scenes cannot be entered.
    expect(moveSceneToEpisodeInSession(session, onlySceneId, toId)).toBe(
      session
    );
  });

  it("deleting an Episode's last Scene is refused, not allowed to empty it", () => {
    // The mirror of the move guard above: nothing else in the
    // session can produce an empty Episode, so delete must not
    // either. `resolveActiveScene` returns null for one.
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    const lonelyId = session.gameProject.episodes[1]!.scenes[0]!.sceneId;
    expect(deleteSceneFromSession(session, lonelyId)).toBe(session);
    // Deleting the whole Episode is the way out.
    session = deleteEpisodeFromSession(
      session,
      session.gameProject.episodes[1]!.episodeId
    );
    expect(session.gameProject.episodes).toHaveLength(1);
  });

  it("every Episode always holds at least one Scene", () => {
    let session = addEpisodeToSession(makeSession(), { displayName: "Two" });
    session = addSceneToSession(session, { displayName: "Extra" });
    for (const episode of session.gameProject.episodes) {
      expect(episode.scenes.length).toBeGreaterThan(0);
    }
  });

  it("is a no-op for an unknown Scene, unknown Episode, or same Episode", () => {
    let session = makeSession();
    session = addSceneToSession(session, { displayName: "Scene 2" });
    session = addEpisodeToSession(session, { displayName: "Two" });
    const sameId = session.gameProject.episodes[0]!.episodeId;
    const sceneId = session.gameProject.episodes[0]!.scenes[0]!.sceneId;
    expect(moveSceneToEpisodeInSession(session, "s:nope", sameId)).toBe(
      session
    );
    expect(moveSceneToEpisodeInSession(session, sceneId, "e:nope")).toBe(
      session
    );
    expect(moveSceneToEpisodeInSession(session, sceneId, sameId)).toBe(session);
  });
});

describe("episodeEndRouting", () => {
  it("defaults to the Episodes screen and switches", () => {
    let session = makeSession();
    expect(session.gameProject.episodeEndRouting).toBe("episodes-screen");
    session = updateEpisodeEndRoutingInSession(session, "next-episode");
    expect(session.gameProject.episodeEndRouting).toBe("next-episode");
    expect(session.isDirty).toBe(true);
  });
});
