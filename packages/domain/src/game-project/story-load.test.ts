/**
 * packages/domain/src/game-project/story-load.test.ts
 *
 * Purpose: the story's load behaviour.
 *
 * There is NO migration from the pre-Episodes `scenes` shape --
 * that shape is gone and a file still carrying it is overwritten
 * rather than converted. What has to hold instead:
 *
 *   1. ORDER ROUND-TRIP through the path Studio ACTUALLY takes
 *      (`createAuthoringSession`, not just `normalizeGameProject`).
 *      Order is list position now, with no sort key to recover
 *      from, so a load that reorders is unrecoverable damage. An
 *      earlier version of this file tested only the normalizer and
 *      missed a reorder in the real load path entirely.
 *   2. A project with no story gets one Season holding one
 *      Episode holding one Scene, so Studio always has an active
 *      Scene and the runtime always has something to boot into.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  getAllEpisodes,
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultEpisode,
  createDefaultSeason,
  createDefaultScene,
  getAllScenes,
  normalizeGameProject
} from "../index";

const REGIONS = [
  createDefaultRegion({ regionId: "region:town", displayName: "Town" })
];

const STORY_EPISODES = [
  createDefaultEpisode({
    episodeId: "e:second",
    scenes: [
      createDefaultScene({ sceneId: "s:b2", displayName: "B2" }),
      createDefaultScene({ sceneId: "s:b1", displayName: "B1" })
    ]
  }),
  createDefaultEpisode({
    episodeId: "e:first",
    scenes: [
      createDefaultScene({ sceneId: "s:a3", displayName: "A3" }),
      createDefaultScene({ sceneId: "s:a1", displayName: "A1" }),
      createDefaultScene({ sceneId: "s:a2", displayName: "A2" })
    ]
  })
];

function projectWithEpisodes() {
  return {
    ...createDefaultGameProject("Probe", "probe"),
    regionRegistry: [{ regionId: "region:town" }],
    seasons: [createDefaultSeason({ episodes: STORY_EPISODES })]
  };
}

describe("story order round-trip", () => {
  it("normalizeGameProject preserves both list orders", () => {
    const reloaded = normalizeGameProject(
      JSON.parse(JSON.stringify(projectWithEpisodes())) as never
    );
    expect(
      getAllEpisodes(reloaded.seasons).map((episode) => episode.episodeId)
    ).toEqual(["e:second", "e:first"]);
    expect(
      getAllScenes(getAllEpisodes(reloaded.seasons)).map(
        (scene) => scene.displayName
      )
    ).toEqual(["B2", "B1", "A3", "A1", "A2"]);
  });

  it("createAuthoringSession preserves both list orders", () => {
    // THE load path. The normalizer test above passed while this one
    // would have failed, which is exactly how a reorder shipped.
    const session = createAuthoringSession(
      JSON.parse(JSON.stringify(projectWithEpisodes())) as never,
      REGIONS
    );
    expect(
      getAllEpisodes(session.gameProject.seasons).map(
        (episode) => episode.episodeId
      )
    ).toEqual(["e:second", "e:first"]);
    expect(
      getAllScenes(getAllEpisodes(session.gameProject.seasons)).map(
        (scene) => scene.displayName
      )
    ).toEqual(["B2", "B1", "A3", "A1", "A2"]);
  });

  it("survives being loaded twice", () => {
    const once = normalizeGameProject(projectWithEpisodes() as never);
    expect(normalizeGameProject(once)).toEqual(once);
  });
});

/** A project file carrying no story key of any generation. */
function projectWithNoStory(): Record<string, unknown> {
  const bare = createDefaultGameProject("Probe", "probe") as unknown as Record<
    string,
    unknown
  >;
  delete bare.seasons;
  delete bare.episodes;
  return bare;
}

describe("a project with no story gets a floor", () => {
  it("normalizeGameProject supplies one Season, Episode and Scene", () => {
    const project = normalizeGameProject(projectWithNoStory() as never);
    expect(project.seasons).toHaveLength(1);
    expect(getAllEpisodes(project.seasons)).toHaveLength(1);
    expect(getAllEpisodes(project.seasons)[0]!.scenes).toHaveLength(1);
  });

  it("empty story arrays are treated as no story", () => {
    const project = normalizeGameProject({
      ...projectWithNoStory(),
      seasons: [],
      episodes: []
    } as never);
    expect(project.seasons).toHaveLength(1);
    expect(getAllEpisodes(project.seasons)).toHaveLength(1);
    expect(getAllEpisodes(project.seasons)[0]!.scenes).toHaveLength(1);
  });

  it("createAuthoringSession lands on an active Scene", () => {
    const session = createAuthoringSession(
      projectWithNoStory() as never,
      REGIONS
    );
    expect(session.activeSceneId).not.toBeNull();
    expect(
      getAllScenes(getAllEpisodes(session.gameProject.seasons))
    ).toHaveLength(1);
  });
});

describe("superseded story keys are dropped, not converted", () => {
  it("a stale scenes array does not survive the load", () => {
    const stale = {
      ...createDefaultGameProject("Probe", "probe"),
      scenes: [{ sceneId: "s:old", sceneOrder: 0, displayName: "Old" }],
      scenesUiLabel: "Scene"
    } as unknown as Record<string, unknown>;
    const project = normalizeGameProject(stale as never) as unknown as Record<
      string,
      unknown
    >;
    // Dropped from the output so a stale file cannot write them back
    // out beside the `seasons` that replaced them.
    expect(project.scenes).toBeUndefined();
    expect(project.scenesUiLabel).toBeUndefined();
    // The story comes from `seasons`; the old Scene is not folded in.
    expect(
      getAllScenes(getAllEpisodes(project.seasons as never)).map(
        (scene: { sceneId: string }) => scene.sceneId
      )
    ).not.toContain("s:old");
  });

  it("a flat episodes list is wrapped, then dropped from the output", () => {
    // The wrap is the conversion; the key going away is what stops the
    // normalizer's spread from carrying it back onto disk on every save.
    const legacy = projectWithNoStory();
    legacy.episodes = STORY_EPISODES;
    const project = normalizeGameProject(legacy as never) as unknown as Record<
      string,
      unknown
    >;

    expect(project.episodes).toBeUndefined();
    expect(
      getAllEpisodes(project.seasons as never).map(
        (episode: { episodeId: string }) => episode.episodeId
      )
    ).toEqual(["e:second", "e:first"]);
  });
});
