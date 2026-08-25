/**
 * packages/domain/src/game-project/episode-migration.test.ts
 *
 * Purpose: The two guards Epic 207 leans on hardest, because
 * hand-verification of stories 1 through 3 is deferred to the
 * story-4 checkpoint and nobody opens the live project until then.
 *
 *   1. RUN-TWICE — a project is normalized on EVERY load, not
 *      once. Folding pre-Episodes Scenes into one Episode must be
 *      a no-op the second time, or every load would re-wrap the
 *      campaign.
 *   2. ORDER ROUND-TRIP — order is list position now, with no sort
 *      key to recover from. Saving and reloading has to preserve
 *      the order of both list levels exactly.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createDefaultGameProject, normalizeGameProject } from "./index";
import { createDefaultEpisode, getAllScenes } from "../episodes";
import { createDefaultScene } from "../scenes";

/** A project file as written before Episodes existed. */
function preEpisodesProjectFile(): Record<string, unknown> {
  // Reading a project off-type is the point here: this fixture is a
  // FILE shape, not a GameProject, and it carries keys the current
  // type has deleted.
  const base = createDefaultGameProject(
    "Wordlark Hollow",
    "wordlark"
  ) as unknown as Record<string, unknown>;
  const { episodes: _episodes, episodeEndRouting: _routing, ...rest } = base;
  return {
    ...rest,
    scenesUiLabel: "Scene",
    scenes: [
      { sceneId: "scene:default", sceneOrder: 0, displayName: "Arrival" },
      { sceneId: "scene:b", sceneOrder: 2, displayName: "Meeting Agatha" },
      { sceneId: "scene:a", sceneOrder: 1, displayName: "Finding that Guy" }
    ]
  };
}

describe("pre-Episodes project migration", () => {
  it("folds a flat Scene list into one Episode, in sceneOrder", () => {
    // sceneOrder was the old sort key, so it decides the order the
    // Scenes take in the new list -- read here and only here.
    const project = normalizeGameProject(preEpisodesProjectFile() as never);
    expect(project.episodes).toHaveLength(1);
    expect(
      project.episodes[0]!.scenes.map((scene) => scene.displayName)
    ).toEqual(["Arrival", "Finding that Guy", "Meeting Agatha"]);
  });

  it("leaves the synthesized Episode ungated so the campaign opens", () => {
    const project = normalizeGameProject(preEpisodesProjectFile() as never);
    expect(project.episodes[0]!.unlockCondition).toBe("always");
  });

  it("drops scenes and scenesUiLabel from the output shape", () => {
    const project = normalizeGameProject(
      preEpisodesProjectFile() as never
    ) as unknown as Record<string, unknown>;
    expect(project.scenes).toBeUndefined();
    expect(project.scenesUiLabel).toBeUndefined();
  });

  it("defaults episodeEndRouting to the Episodes screen", () => {
    const project = normalizeGameProject(preEpisodesProjectFile() as never);
    expect(project.episodeEndRouting).toBe("episodes-screen");
  });

  it("RUNS TWICE as a no-op", () => {
    const once = normalizeGameProject(preEpisodesProjectFile() as never);
    const twice = normalizeGameProject(once);
    expect(twice.episodes).toEqual(once.episodes);
    expect(twice.episodes).toHaveLength(1);
  });

  it("does not re-wrap a project that already has several Episodes", () => {
    // The naive migration -- "no scenes key? fold" -- would collapse
    // an authored multi-Episode campaign back into one on load.
    const authored = normalizeGameProject({
      ...createDefaultGameProject("Wordlark Hollow", "wordlark"),
      episodes: [
        createDefaultEpisode({
          episodeId: "e:1",
          scenes: [createDefaultScene({ sceneId: "s:1" })]
        }),
        createDefaultEpisode({
          episodeId: "e:2",
          scenes: [createDefaultScene({ sceneId: "s:2" })]
        })
      ]
    } as never);
    expect(authored.episodes).toHaveLength(2);
    expect(normalizeGameProject(authored).episodes).toHaveLength(2);
  });

  it("survives a project with neither key", () => {
    const bare = preEpisodesProjectFile() as Record<string, unknown>;
    delete bare.scenes;
    expect(normalizeGameProject(bare as never).episodes).toEqual([]);
  });
});

describe("campaign order round-trip", () => {
  it("preserves the order of BOTH list levels through save and reload", () => {
    // The guard for the one real risk in deleting the order number:
    // a list order cannot be recovered from once scrambled, so the
    // load path must never reorder.
    const project = normalizeGameProject({
      ...createDefaultGameProject("Wordlark Hollow", "wordlark"),
      episodes: [
        createDefaultEpisode({
          episodeId: "e:second",
          scenes: [
            createDefaultScene({ sceneId: "s:b2" }),
            createDefaultScene({ sceneId: "s:b1" })
          ]
        }),
        createDefaultEpisode({
          episodeId: "e:first",
          scenes: [
            createDefaultScene({ sceneId: "s:a3" }),
            createDefaultScene({ sceneId: "s:a1" }),
            createDefaultScene({ sceneId: "s:a2" })
          ]
        })
      ]
    } as never);

    // Through the disk shape and back, exactly as a save/load does.
    const reloaded = normalizeGameProject(
      JSON.parse(JSON.stringify(project)) as never
    );

    expect(reloaded.episodes.map((episode) => episode.episodeId)).toEqual([
      "e:second",
      "e:first"
    ]);
    expect(getAllScenes(reloaded.episodes).map((scene) => scene.sceneId)).toEqual(
      ["s:b2", "s:b1", "s:a3", "s:a1", "s:a2"]
    );
  });

  it("keeps a fresh project's single Episode and Scene intact", () => {
    const fresh = createDefaultGameProject("Test Game", "test");
    expect(fresh.episodes).toHaveLength(1);
    expect(fresh.episodes[0]!.scenes).toHaveLength(1);
    const reloaded = normalizeGameProject(
      JSON.parse(JSON.stringify(fresh)) as never
    );
    expect(reloaded.episodes[0]!.scenes[0]!.sceneId).toBe(
      fresh.episodes[0]!.scenes[0]!.sceneId
    );
  });
});
