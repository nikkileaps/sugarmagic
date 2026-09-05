/**
 * packages/domain/src/authoring-session/season-management.test.ts
 *
 * Purpose: session-level Season management — the CRUD guards and
 * the one operation that moves an Episode between Seasons.
 *
 * The rule under all of it: a Season is never empty. That needs
 * three enforcers, not one, because there are three ways to get an
 * empty container — create it that way, delete its last child, or
 * move its last child out. The Episode level already has all
 * three; these pin the same shape one level up.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  addEpisodeToSession,
  addSeasonToSession,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  deleteSeasonFromSession,
  getAllEpisodes,
  getAllScenes,
  moveEpisodeToSeasonInSession,
  reorderSeasonInSession,
  updateSeasonInSession,
  type AuthoringSession
} from "../index";

const REGIONS = [
  createDefaultRegion({ regionId: "region:town", displayName: "Town" })
];

function makeSession(): AuthoringSession {
  return createAuthoringSession(
    {
      ...createDefaultGameProject("Probe", "probe"),
      regionRegistry: [{ regionId: "region:town" }]
    } as never,
    REGIONS
  );
}

function seasonIds(session: AuthoringSession): string[] {
  return session.gameProject.seasons.map((season) => season.seasonId);
}

describe("Season CRUD", () => {
  it("starts with exactly one Season holding one Episode holding one Scene", () => {
    const session = makeSession();
    expect(session.gameProject.seasons).toHaveLength(1);
    expect(getAllEpisodes(session.gameProject.seasons)).toHaveLength(1);
    expect(
      getAllScenes(getAllEpisodes(session.gameProject.seasons))
    ).toHaveLength(1);
  });

  it("creates a Season already holding an Episode and a Scene", () => {
    // The create-side enforcer. A Season born empty would defeat the
    // delete and move guards before either ran.
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    expect(session.gameProject.seasons).toHaveLength(2);
    const added = session.gameProject.seasons[1]!;
    expect(added.displayName).toBe("Two");
    expect(added.episodes).toHaveLength(1);
    expect(added.episodes[0]!.scenes).toHaveLength(1);
  });

  it("makes the new Season's Scene the active one", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    expect(session.activeSceneId).toBe(
      session.gameProject.seasons[1]!.episodes[0]!.scenes[0]!.sceneId
    );
  });

  it("falls back to a name rather than creating an untitled Season", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "   " });
    expect(session.gameProject.seasons[1]!.displayName).toBe("Untitled Season");
  });

  it("refuses to delete the last Season", () => {
    const session = makeSession();
    const after = deleteSeasonFromSession(session, seasonIds(session)[0]!);
    expect(after).toBe(session);
  });

  it("deletes a Season and every Episode in it", () => {
    let session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const doomed = seasonIds(session)[1]!;
    const survivingEpisodes = getAllEpisodes([
      session.gameProject.seasons[0]!
    ]).map((episode) => episode.episodeId);

    session = deleteSeasonFromSession(session, doomed);
    expect(seasonIds(session)).toHaveLength(1);
    expect(
      getAllEpisodes(session.gameProject.seasons).map(
        (episode) => episode.episodeId
      )
    ).toEqual(survivingEpisodes);
  });

  it("moves the active Scene off a deleted Season", () => {
    // Reads fall back from a dangling pointer, so a stale
    // `activeSceneId` fails quietly. `switchActiveScene` compares
    // against it and Studio ships it to Preview.
    let session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const doomed = seasonIds(session)[1]!;
    const doomedSceneId = session.activeSceneId;

    session = deleteSeasonFromSession(session, doomed);
    expect(session.activeSceneId).not.toBe(doomedSceneId);
    expect(session.activeSceneId).not.toBeNull();
    expect(
      getAllScenes(getAllEpisodes(session.gameProject.seasons)).map(
        (scene) => scene.sceneId
      )
    ).toContain(session.activeSceneId);
  });

  it("ignores a delete for a Season that is not there", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    expect(deleteSeasonFromSession(session, "season:nope")).toBe(session);
  });

  it("reorders by moving the entry, and stops at the ends", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const [first, second] = seasonIds(session);

    const swapped = reorderSeasonInSession(session, second!, "up");
    expect(seasonIds(swapped)).toEqual([second, first]);

    expect(seasonIds(reorderSeasonInSession(session, first!, "up"))).toEqual([
      first,
      second
    ]);
    expect(seasonIds(reorderSeasonInSession(session, second!, "down"))).toEqual(
      [first, second]
    );
  });

  it("edits a Season's own fields without touching its Episodes", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const before = getAllEpisodes(session.gameProject.seasons);
    const after = updateSeasonInSession(session, seasonIds(session)[1]!, {
      displayName: "Renamed",
      notes: "a note"
    });
    expect(after.gameProject.seasons[1]!.displayName).toBe("Renamed");
    expect(after.gameProject.seasons[1]!.notes).toBe("a note");
    expect(getAllEpisodes(after.gameProject.seasons)).toEqual(before);
  });
});

describe("moving an Episode between Seasons", () => {
  it("removes it from one and appends it to the other, exactly once", () => {
    let session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const [one, two] = seasonIds(session);
    // Season one needs a second Episode, or the move is refused.
    session = addEpisodeToSession(session, {
      displayName: "Spare",
      seasonId: one!
    });
    const moving = session.gameProject.seasons[0]!.episodes[1]!.episodeId;

    const after = moveEpisodeToSeasonInSession(session, moving, two!);
    expect(
      after.gameProject.seasons[0]!.episodes.map((e) => e.episodeId)
    ).not.toContain(moving);
    // Appended, not inserted: position IS the order.
    expect(
      after.gameProject.seasons[1]!.episodes.map((e) => e.episodeId)
    ).toEqual([session.gameProject.seasons[1]!.episodes[0]!.episodeId, moving]);
    // Exactly once, across the whole campaign.
    expect(
      getAllEpisodes(after.gameProject.seasons).filter(
        (episode) => episode.episodeId === moving
      )
    ).toHaveLength(1);
    // The Scenes ride along with it.
    expect(after.gameProject.seasons[1]!.episodes[1]!.scenes).toHaveLength(1);
  });

  it("refuses to empty the source Season", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const [one, two] = seasonIds(session);
    const onlyEpisode = session.gameProject.seasons[1]!.episodes[0]!.episodeId;
    expect(two).toBeDefined();
    expect(moveEpisodeToSeasonInSession(session, onlyEpisode, one!)).toBe(
      session
    );
  });

  it("ignores a move to the Season already holding it", () => {
    const session = makeSession();
    const episodeId = getAllEpisodes(session.gameProject.seasons)[0]!.episodeId;
    expect(
      moveEpisodeToSeasonInSession(session, episodeId, seasonIds(session)[0]!)
    ).toBe(session);
  });

  it("ignores a move naming a Season or Episode that is not there", () => {
    const session = addSeasonToSession(makeSession(), { displayName: "Two" });
    const episodeId = getAllEpisodes(session.gameProject.seasons)[0]!.episodeId;
    expect(
      moveEpisodeToSeasonInSession(session, episodeId, "season:nope")
    ).toBe(session);
    expect(
      moveEpisodeToSeasonInSession(session, "e:nope", seasonIds(session)[1]!)
    ).toBe(session);
  });
});
