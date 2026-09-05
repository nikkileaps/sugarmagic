/**
 * packages/domain/src/seasons/index.test.ts
 *
 * Purpose: the Season level of the story — the container, its
 * load behaviour, and the invariants the rest of the epic leans on.
 *
 * Two of these look like bookkeeping and are not:
 *
 *   1. A pre-Seasons file wraps into a Season whose id is a
 *      LITERAL. A generated id would differ on every load, and
 *      nothing downstream would notice until a save pointed at a
 *      Season that no longer existed.
 *   2. `episodes` does not survive the load. The normalizer spreads
 *      its input through an `unknown` cast, so a stale key rides
 *      onto the output invisibly and gets written back to disk on
 *      every save.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultEpisode,
  createDefaultGameProject,
  createDefaultQuestDefinition,
  createDefaultScene,
  createDefaultSeason,
  DEFAULT_SEASON_ID,
  getAllEpisodes,
  getAllScenes,
  findSeasonByEpisodeId,
  mapEpisodes,
  mapScenes,
  normalizeGameProject,
  normalizeSeasons,
  takeQuestContainmentNotes
} from "../index";

function twoSeasons() {
  return [
    createDefaultSeason({
      seasonId: "season:one",
      displayName: "Season One",
      episodes: [
        createDefaultEpisode({
          episodeId: "e:a",
          scenes: [createDefaultScene({ sceneId: "s:a1", displayName: "A1" })]
        }),
        createDefaultEpisode({
          episodeId: "e:b",
          scenes: [createDefaultScene({ sceneId: "s:b1", displayName: "B1" })]
        })
      ]
    }),
    createDefaultSeason({
      seasonId: "season:two",
      displayName: "Season Two",
      episodes: [
        createDefaultEpisode({
          episodeId: "e:c",
          scenes: [createDefaultScene({ sceneId: "s:c1", displayName: "C1" })]
        })
      ]
    })
  ];
}

describe("a Season contains Episodes", () => {
  it("round trips a two-Season story, preserving every list order", () => {
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      seasons: twoSeasons()
    } as never);

    expect(project.seasons.map((season) => season.seasonId)).toEqual([
      "season:one",
      "season:two"
    ]);
    expect(
      getAllEpisodes(project.seasons).map((episode) => episode.episodeId)
    ).toEqual(["e:a", "e:b", "e:c"]);
    expect(
      getAllScenes(getAllEpisodes(project.seasons)).map(
        (scene) => scene.displayName
      )
    ).toEqual(["A1", "B1", "C1"]);
  });

  it("survives being loaded twice", () => {
    const once = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      seasons: twoSeasons()
    } as never);
    expect(normalizeGameProject(once)).toEqual(once);
  });

  it("narrative order is the concatenation, so gating cannot see the grouping", () => {
    // Decision 2 of the epic rests on this: routing walks a flat list.
    const seasons = twoSeasons();
    expect(getAllEpisodes(seasons).map((e) => e.episodeId)).toEqual([
      "e:a",
      "e:b",
      "e:c"
    ]);
  });

  it("finds the Season holding an Episode, which is why the save stores no Season", () => {
    const seasons = twoSeasons();
    expect(findSeasonByEpisodeId(seasons, "e:c")?.seasonId).toBe("season:two");
    expect(findSeasonByEpisodeId(seasons, "e:nope")).toBeNull();
  });
});

describe("the write helpers preserve containment", () => {
  it("mapEpisodes rewrites Episodes without moving them between Seasons", () => {
    const rewritten = mapEpisodes(twoSeasons(), (episode) => ({
      ...episode,
      displayName: `${episode.episodeId}!`
    }));
    expect(rewritten.map((s) => s.episodes.map((e) => e.episodeId))).toEqual([
      ["e:a", "e:b"],
      ["e:c"]
    ]);
    expect(rewritten[1]!.episodes[0]!.displayName).toBe("e:c!");
  });

  it("mapScenes rewrites every Scene and keeps both levels of ownership", () => {
    const rewritten = mapScenes(twoSeasons(), (scene) => ({
      ...scene,
      displayName: scene.displayName.toLowerCase()
    }));
    expect(rewritten.map((s) => s.seasonId)).toEqual([
      "season:one",
      "season:two"
    ]);
    expect(rewritten.map((s) => s.episodes.map((e) => e.episodeId))).toEqual([
      ["e:a", "e:b"],
      ["e:c"]
    ]);
    expect(
      getAllScenes(getAllEpisodes(rewritten)).map((scene) => scene.displayName)
    ).toEqual(["a1", "b1", "c1"]);
  });
});

/**
 * A pre-Seasons project as it appears on disk: a flat `episodes`
 * list and no `seasons` key at all. `createDefaultGameProject` now
 * builds a Season, so the key has to be removed rather than
 * overwritten -- a fixture that leaves it in exercises the
 * authored-Seasons branch and never reaches the wrap.
 */
function legacyProjectRaw(episodes: unknown[]): Record<string, unknown> {
  const raw = createDefaultGameProject("Probe", "probe") as unknown as Record<
    string,
    unknown
  >;
  delete raw.seasons;
  raw.episodes = episodes;
  return raw;
}

describe("loading a project that predates Seasons", () => {
  it("wraps a flat episodes list in one Season, in order", () => {
    const project = normalizeGameProject(
      legacyProjectRaw([
        createDefaultEpisode({
          episodeId: "e:second",
          scenes: [createDefaultScene({ sceneId: "s:b" })]
        }),
        createDefaultEpisode({
          episodeId: "e:first",
          scenes: [createDefaultScene({ sceneId: "s:a" })]
        })
      ]) as never
    );

    expect(project.seasons).toHaveLength(1);
    expect(project.seasons[0]!.seasonId).toBe(DEFAULT_SEASON_ID);
    expect(
      getAllEpisodes(project.seasons).map((episode) => episode.episodeId)
    ).toEqual(["e:second", "e:first"]);
  });

  it("lands on the same seasonId every time it is loaded", () => {
    const raw = legacyProjectRaw([
      createDefaultEpisode({
        episodeId: "e:a",
        scenes: [createDefaultScene({ sceneId: "s:a" })]
      })
    ]);
    const first = normalizeGameProject(
      JSON.parse(JSON.stringify(raw)) as never
    );
    const second = normalizeGameProject(
      JSON.parse(JSON.stringify(raw)) as never
    );
    expect(first.seasons[0]!.seasonId).toBe(second.seasons[0]!.seasonId);

    // And after the wrap is saved and reloaded, it stays put.
    const reloaded = normalizeGameProject(
      JSON.parse(JSON.stringify(first)) as never
    );
    expect(reloaded.seasons[0]!.seasonId).toBe(DEFAULT_SEASON_ID);
  });

  it("does not let the stale episodes key survive onto the loaded project", () => {
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      episodes: [
        createDefaultEpisode({
          episodeId: "e:a",
          scenes: [createDefaultScene({ sceneId: "s:a" })]
        })
      ]
    } as never) as unknown as Record<string, unknown>;

    expect(project.episodes).toBeUndefined();
  });

  it("prefers a non-empty seasons list over the legacy episodes list", () => {
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      seasons: twoSeasons(),
      episodes: [
        createDefaultEpisode({
          episodeId: "e:legacy",
          scenes: [createDefaultScene({ sceneId: "s:legacy" })]
        })
      ]
    } as never);

    expect(project.seasons.map((season) => season.seasonId)).toEqual([
      "season:one",
      "season:two"
    ]);
    expect(
      getAllEpisodes(project.seasons).map((episode) => episode.episodeId)
    ).not.toContain("e:legacy");
  });

  it("falls through an EMPTY seasons array to the legacy episodes list", () => {
    // Presence is not the test -- a half-migrated file carrying
    // `seasons: []` beside a real story must not load as empty.
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      seasons: [],
      episodes: [
        createDefaultEpisode({
          episodeId: "e:legacy",
          scenes: [createDefaultScene({ sceneId: "s:legacy" })]
        })
      ]
    } as never);

    expect(project.seasons).toHaveLength(1);
    expect(project.seasons[0]!.seasonId).toBe(DEFAULT_SEASON_ID);
    expect(
      getAllEpisodes(project.seasons).map((episode) => episode.episodeId)
    ).toEqual(["e:legacy"]);
  });

  it("gives a project with no story at all one Season, Episode and Scene", () => {
    const bare = createDefaultGameProject(
      "Probe",
      "probe"
    ) as unknown as Record<string, unknown>;
    delete bare.seasons;
    const project = normalizeGameProject(bare as never);

    expect(project.seasons).toHaveLength(1);
    expect(getAllEpisodes(project.seasons)).toHaveLength(1);
    expect(getAllScenes(getAllEpisodes(project.seasons))).toHaveLength(1);
  });

  it("still homes a pre-#226 flat quest on the first Scene that exists", () => {
    takeQuestContainmentNotes();
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      questDefinitions: [
        createDefaultQuestDefinition({
          definitionId: "quest:loose",
          displayName: "Loose"
        })
      ]
    } as never);
    const notes = takeQuestContainmentNotes();

    const scenes = getAllScenes(getAllEpisodes(project.seasons));
    expect(scenes[0]!.questDefinitions.map((q) => q.definitionId)).toEqual([
      "quest:loose"
    ]);
    expect(notes.map((note) => note.questDefinitionId)).toEqual([
      "quest:loose"
    ]);
  });
});

describe("ids stay unique across the whole story", () => {
  it("keeps the first of two Seasons sharing a seasonId", () => {
    const seasons = normalizeSeasons([
      createDefaultSeason({
        seasonId: "season:dup",
        displayName: "Keep me",
        episodes: [createDefaultEpisode({ episodeId: "e:a" })]
      }),
      createDefaultSeason({
        seasonId: "season:dup",
        displayName: "Drop me",
        episodes: [createDefaultEpisode({ episodeId: "e:b" })]
      })
    ]);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.displayName).toBe("Keep me");
  });

  it("keeps the first of two Seasons sharing an episodeId", () => {
    // Load-bearing: `unlockedEpisodeIds` in the save is a flat set, and
    // the owning Season is derived by search, so a duplicate would make
    // both ambiguous.
    const seasons = normalizeSeasons([
      createDefaultSeason({
        seasonId: "season:one",
        episodes: [
          createDefaultEpisode({ episodeId: "e:shared", displayName: "Keep" })
        ]
      }),
      createDefaultSeason({
        seasonId: "season:two",
        episodes: [
          createDefaultEpisode({ episodeId: "e:shared", displayName: "Drop" })
        ]
      })
    ]);

    expect(getAllEpisodes(seasons)).toHaveLength(1);
    expect(getAllEpisodes(seasons)[0]!.displayName).toBe("Keep");
    expect(findSeasonByEpisodeId(seasons, "e:shared")?.seasonId).toBe(
      "season:one"
    );
  });

  it("keeps the first of two Seasons sharing a sceneId", () => {
    const seasons = normalizeSeasons([
      createDefaultSeason({
        seasonId: "season:one",
        episodes: [
          createDefaultEpisode({
            episodeId: "e:a",
            scenes: [createDefaultScene({ sceneId: "s:shared" })]
          })
        ]
      }),
      createDefaultSeason({
        seasonId: "season:two",
        episodes: [
          createDefaultEpisode({
            episodeId: "e:b",
            scenes: [createDefaultScene({ sceneId: "s:shared" })]
          })
        ]
      })
    ]);

    expect(getAllScenes(getAllEpisodes(seasons)).map((s) => s.sceneId)).toEqual(
      ["s:shared"]
    );
  });

  it("drops a malformed Season rather than admitting it", () => {
    expect(normalizeSeasons([null, { displayName: "no id" }, 7])).toEqual([]);
    expect(normalizeSeasons("not a list")).toEqual([]);
  });
});
