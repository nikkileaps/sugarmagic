/**
 * packages/domain/src/game-project/campaign-load.test.ts
 *
 * Purpose: the campaign's load behaviour.
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
 *   2. A project with no campaign gets one Episode holding one
 *      Scene, so Studio always has an active Scene and the runtime
 *      always has something to boot into.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultEpisode,
  createDefaultScene,
  getAllScenes,
  normalizeGameProject
} from "../index";

const REGIONS = [
  createDefaultRegion({ regionId: "region:town", displayName: "Town" })
];

function projectWithEpisodes() {
  return {
    ...createDefaultGameProject("Probe", "probe"),
    regionRegistry: [{ regionId: "region:town" }],
    episodes: [
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
    ]
  };
}

describe("campaign order round-trip", () => {
  it("normalizeGameProject preserves both list orders", () => {
    const reloaded = normalizeGameProject(
      JSON.parse(JSON.stringify(projectWithEpisodes())) as never
    );
    expect(reloaded.episodes.map((episode) => episode.episodeId)).toEqual([
      "e:second",
      "e:first"
    ]);
    expect(
      getAllScenes(reloaded.episodes).map((scene) => scene.displayName)
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
      session.gameProject.episodes.map((episode) => episode.episodeId)
    ).toEqual(["e:second", "e:first"]);
    expect(
      getAllScenes(session.gameProject.episodes).map(
        (scene) => scene.displayName
      )
    ).toEqual(["B2", "B1", "A3", "A1", "A2"]);
  });

  it("survives being loaded twice", () => {
    const once = normalizeGameProject(projectWithEpisodes() as never);
    expect(normalizeGameProject(once)).toEqual(once);
  });
});

describe("a project with no campaign gets a floor", () => {
  it("normalizeGameProject supplies one Episode holding one Scene", () => {
    const bare = createDefaultGameProject("Probe", "probe") as unknown as Record<
      string,
      unknown
    >;
    delete bare.episodes;
    const project = normalizeGameProject(bare as never);
    expect(project.episodes).toHaveLength(1);
    expect(project.episodes[0]!.scenes).toHaveLength(1);
  });

  it("an empty episodes array is treated as no campaign", () => {
    const project = normalizeGameProject({
      ...createDefaultGameProject("Probe", "probe"),
      episodes: []
    } as never);
    expect(project.episodes).toHaveLength(1);
    expect(project.episodes[0]!.scenes).toHaveLength(1);
  });

  it("createAuthoringSession lands on an active Scene", () => {
    const bare = createDefaultGameProject("Probe", "probe") as unknown as Record<
      string,
      unknown
    >;
    delete bare.episodes;
    const session = createAuthoringSession(bare as never, REGIONS);
    expect(session.activeSceneId).not.toBeNull();
    expect(getAllScenes(session.gameProject.episodes)).toHaveLength(1);
  });
});

describe("the pre-Episodes shape is dropped, not converted", () => {
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
    // out beside the `episodes` that replaced them.
    expect(project.scenes).toBeUndefined();
    expect(project.scenesUiLabel).toBeUndefined();
    // The campaign comes from `episodes`; the old Scene is not folded in.
    expect(
      getAllScenes(project.episodes as never).map(
        (scene: { sceneId: string }) => scene.sceneId
      )
    ).not.toContain("s:old");
  });
});
