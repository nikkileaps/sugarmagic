/**
 * packages/domain/src/authoring-session/season-preservation.test.ts
 *
 * Purpose: every session edit keeps each Episode in the Season
 * that owns it.
 *
 * This is the failure the typechecker cannot see. `getAllEpisodes`
 * flattens the story, so any write that rebuilds from that flat
 * list and puts the result back into `seasons[0]` compiles with no
 * error and no assertion — `strict` is on without
 * `noUncheckedIndexedAccess`, so `seasons[0]` is a `Season`, not
 * `Season | undefined`. The whole grouping then collapses on the
 * first Scene edit an author makes.
 *
 * So these assert membership, not just that the edit happened. A
 * one-Season project cannot catch this: with a single Season,
 * collapsing into `seasons[0]` is indistinguishable from correct.
 * Every fixture here has two.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  addEpisodeToSession,
  addSceneToSession,
  createAuthoringSession,
  createDefaultEpisode,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultScene,
  createDefaultSeason,
  deleteEpisodeFromSession,
  deleteSceneFromSession,
  getAllEpisodes,
  moveSceneToEpisodeInSession,
  updateSceneInSession,
  reorderEpisodeInSession,
  switchActiveScene,
  updateEpisodeInSession,
  type AuthoringSession
} from "../index";

const REGIONS = [
  createDefaultRegion({ regionId: "region:town", displayName: "Town" })
];

/** Two Seasons: one with two Episodes, one with a single Episode. */
function twoSeasonSession(): AuthoringSession {
  return createAuthoringSession(
    {
      ...createDefaultGameProject("Probe", "probe"),
      regionRegistry: [{ regionId: "region:town" }],
      seasons: [
        createDefaultSeason({
          seasonId: "season:one",
          episodes: [
            createDefaultEpisode({
              episodeId: "e:a",
              scenes: [
                createDefaultScene({ sceneId: "s:a1", regionId: "region:town" })
              ]
            }),
            createDefaultEpisode({
              episodeId: "e:b",
              scenes: [
                createDefaultScene({
                  sceneId: "s:b1",
                  regionId: "region:town"
                }),
                createDefaultScene({ sceneId: "s:b2", regionId: "region:town" })
              ]
            })
          ]
        }),
        createDefaultSeason({
          seasonId: "season:two",
          episodes: [
            createDefaultEpisode({
              episodeId: "e:c",
              scenes: [
                createDefaultScene({ sceneId: "s:c1", regionId: "region:town" })
              ]
            })
          ]
        })
      ]
    } as never,
    REGIONS
  );
}

/** Which Episodes each Season holds, in order. The thing that collapses. */
function membership(session: AuthoringSession): string[][] {
  return session.gameProject.seasons.map((season) =>
    season.episodes.map((episode) => episode.episodeId)
  );
}

const INITIAL = [["e:a", "e:b"], ["e:c"]];

describe("a session edit never re-homes an Episode", () => {
  it("starts with the membership the fixture authored", () => {
    expect(membership(twoSeasonSession())).toEqual(INITIAL);
  });

  it("survives renaming a Scene", () => {
    const session = updateSceneInSession(twoSeasonSession(), "s:c1", {
      displayName: "Renamed"
    });
    expect(membership(session)).toEqual(INITIAL);
  });

  it("survives adding a Scene to an Episode in the second Season", () => {
    const session = addSceneToSession(twoSeasonSession(), {
      displayName: "New",
      episodeId: "e:c",
      regionId: "region:town"
    });
    expect(membership(session)).toEqual(INITIAL);
    expect(
      getAllEpisodes(session.gameProject.seasons).find(
        (episode) => episode.episodeId === "e:c"
      )!.scenes
    ).toHaveLength(2);
  });

  it("survives deleting a Scene", () => {
    const session = deleteSceneFromSession(twoSeasonSession(), "s:b2");
    expect(membership(session)).toEqual(INITIAL);
  });

  it("survives moving a Scene ACROSS Seasons", () => {
    // The hardest case: source and target Episodes are in different
    // Seasons, so a rewrite that flattens has two chances to go wrong.
    const session = moveSceneToEpisodeInSession(
      twoSeasonSession(),
      "s:b2",
      "e:c"
    );
    expect(membership(session)).toEqual(INITIAL);
    const episodes = getAllEpisodes(session.gameProject.seasons);
    expect(
      episodes.find((episode) => episode.episodeId === "e:b")!.scenes
    ).toHaveLength(1);
    expect(
      episodes
        .find((episode) => episode.episodeId === "e:c")!
        .scenes.map((scene) => scene.sceneId)
    ).toEqual(["s:c1", "s:b2"]);
  });

  it("survives editing an Episode's own fields", () => {
    const session = updateEpisodeInSession(twoSeasonSession(), "e:c", {
      displayName: "Renamed"
    });
    expect(membership(session)).toEqual(INITIAL);
  });

  it("survives switching the active Scene", () => {
    const session = switchActiveScene(twoSeasonSession(), "s:c1");
    expect(membership(session)).toEqual(INITIAL);
    expect(session.activeSceneId).toBe("s:c1");
  });
});

describe("Episode operations are scoped to the owning Season", () => {
  it("adds a new Episode to the last Season by default", () => {
    const session = addEpisodeToSession(twoSeasonSession(), {
      displayName: "Fresh"
    });
    expect(membership(session)[0]).toEqual(["e:a", "e:b"]);
    expect(membership(session)[1]).toHaveLength(2);
  });

  it("adds a new Episode to the Season it is given", () => {
    const session = addEpisodeToSession(twoSeasonSession(), {
      displayName: "Fresh",
      seasonId: "season:one"
    });
    expect(membership(session)[0]).toHaveLength(3);
    expect(membership(session)[1]).toEqual(["e:c"]);
  });

  it("refuses to delete a Season's only Episode, even when the project has three", () => {
    // The guard is the owning Season's count. A project-wide count would
    // pass here and leave Season two empty.
    const session = deleteEpisodeFromSession(twoSeasonSession(), "e:c");
    expect(membership(session)).toEqual(INITIAL);
  });

  it("deletes an Episode from a Season that has more than one", () => {
    const session = deleteEpisodeFromSession(twoSeasonSession(), "e:b");
    expect(membership(session)).toEqual([["e:a"], ["e:c"]]);
  });

  it("moves the active Scene when the deleted Episode held it", () => {
    let session = switchActiveScene(twoSeasonSession(), "s:b1");
    session = deleteEpisodeFromSession(session, "e:b");
    expect(session.activeSceneId).not.toBe("s:b1");
    expect(session.activeSceneId).not.toBeNull();
  });

  it("reorders inside a Season and stops at its edges", () => {
    // "up" on the first Episode of Season one is a no-op rather than a
    // move into another Season.
    const first = reorderEpisodeInSession(twoSeasonSession(), "e:a", "up");
    expect(membership(first)).toEqual(INITIAL);

    // "up" on the only Episode of Season two does NOT pull it into
    // Season one, which is what a flat reorder would do.
    const second = reorderEpisodeInSession(twoSeasonSession(), "e:c", "up");
    expect(membership(second)).toEqual(INITIAL);

    // A real swap, inside one Season.
    const swapped = reorderEpisodeInSession(twoSeasonSession(), "e:b", "up");
    expect(membership(swapped)).toEqual([["e:b", "e:a"], ["e:c"]]);
  });
});
