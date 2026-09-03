/**
 * Completion rolls up the story timeline (epic #226 story 14 / #281).
 *
 * Quest completion is the one recorded fact. A Scene is complete when its
 * quests are, an Episode when its Scenes are -- derived every time, never
 * stored beside the thing it summarises.
 *
 * It used to be stored twice over: `completedSceneIds` and
 * `completedEpisodeIds`, both pushed to when the story advanced past a
 * Scene. Nothing kept them agreeing with the quests, so adding a quest to
 * a finished Episode left a save claiming it was done.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultEpisode,
  createDefaultQuestDefinition,
  createDefaultScene,
  isEpisodeComplete,
  isSceneComplete,
  resolveActiveEpisode,
  resolveActiveScene,
  type Episode
} from "@sugarmagic/domain";

/** An Episode with one Scene per quest id given. */
function episodeWith(episodeId: string, questIds: string[][]): Episode {
  return createDefaultEpisode({
    episodeId,
    scenes: questIds.map((ids, index) => ({
      ...createDefaultScene({ sceneId: `${episodeId}:s${index}` }),
      questDefinitions: ids.map((definitionId) =>
        createDefaultQuestDefinition({ definitionId })
      )
    }))
  });
}

const done = (...ids: string[]) => (id: string) => ids.includes(id);

describe("a Scene is complete when its quests are", () => {
  it("is not complete while one is outstanding", () => {
    const scene = episodeWith("e", [["q:a", "q:b"]]).scenes[0]!;

    expect(isSceneComplete(scene, done("q:a"))).toBe(false);
    expect(isSceneComplete(scene, done("q:a", "q:b"))).toBe(true);
  });

  it("a Scene with no quests is complete, vacuously", () => {
    // Worth pinning because of what follows from it: an Episode made only
    // of quest-less Scenes is complete the moment it exists.
    const scene = createDefaultScene({ sceneId: "s:dressing" });

    expect(isSceneComplete(scene, done())).toBe(true);
  });
});

describe("an Episode is complete when its Scenes are", () => {
  it("needs every Scene, not just the last", () => {
    const episode = episodeWith("e:1", [["q:a"], ["q:b"]]);

    expect(isEpisodeComplete(episode, done("q:b"))).toBe(false);
    expect(isEpisodeComplete(episode, done("q:a", "q:b"))).toBe(true);
  });

  it("an Episode with no Scenes is NOT complete", () => {
    // It cannot be entered, so calling it finished would claim the player
    // did something they had no way to do.
    const empty = createDefaultEpisode({ episodeId: "e:empty", scenes: [] });

    expect(isEpisodeComplete(empty, done())).toBe(false);
  });

  it("reads as unfinished again when a quest is added to it", () => {
    // The divergence the stored list allowed: a save said Completed while
    // the Episode had grown a quest the player never saw. Derived, the
    // answer just changes.
    const shipped = episodeWith("e:1", [["q:a"]]);
    const patched = episodeWith("e:1", [["q:a", "q:new"]]);

    expect(isEpisodeComplete(shipped, done("q:a"))).toBe(true);
    expect(isEpisodeComplete(patched, done("q:a"))).toBe(false);
  });
});

describe("where the player is on the timeline", () => {
  const episodes = [episodeWith("e:1", [["q:a"]]), episodeWith("e:2", [["q:b"]])];
  const allUnlocked = new Set(["e:1", "e:2"]);

  it("is the first unfinished unlocked Episode", () => {
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: allUnlocked,
        requestedEpisodeId: null,
        isQuestCompleted: done("q:a")
      })?.episodeId
    ).toBe("e:2");
  });

  it("is nothing once every unlocked Episode is finished", () => {
    // Story 14's case. Nothing active is a position above the Episode
    // tier, where the world is the region at rest -- not a failure to
    // find one.
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: allUnlocked,
        requestedEpisodeId: null,
        isQuestCompleted: done("q:a", "q:b")
      })
    ).toBeNull();
  });

  it("is nothing when the finished Episode is the only one unlocked", () => {
    // The gate-shut case: e:1 done, e:2 not released yet.
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: new Set(["e:1"]),
        requestedEpisodeId: null,
        isQuestCompleted: done("q:a")
      })
    ).toBeNull();
  });

  it("does not send the player back into an Episode they finished", () => {
    // Even when the save still names it.
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: allUnlocked,
        requestedEpisodeId: "e:1",
        isQuestCompleted: done("q:a")
      })?.episodeId
    ).toBe("e:2");
  });

  it("no Episode means no Scene, which is the region at rest", () => {
    expect(
      resolveActiveScene({
        episode: null,
        requestedSceneId: null,
        isQuestCompleted: done()
      })
    ).toBeNull();
  });

  it("skips a finished Scene inside an unfinished Episode", () => {
    const episode = episodeWith("e:1", [["q:a"], ["q:b"]]);

    expect(
      resolveActiveScene({
        episode,
        requestedSceneId: null,
        isQuestCompleted: done("q:a")
      })?.sceneId
    ).toBe("e:1:s1");
  });
});
