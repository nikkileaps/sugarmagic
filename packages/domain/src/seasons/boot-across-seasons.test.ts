/**
 * packages/domain/src/seasons/boot-across-seasons.test.ts
 *
 * Purpose: boot resolution reads the story as one flat run and
 * cannot see the Season grouping.
 *
 * That is the claim the Season level rests on. Because it holds,
 * a Season needs no gate of its own and the save stores no Season
 * pointer: gating, the boot Episode and the next-Episode walk all
 * work on `getAllEpisodes(seasons)`, where a Season boundary is
 * just the next entry in the list.
 *
 * If it stopped holding, the failure would be quiet -- a player
 * finishing Season 1 would land somewhere plausible rather than
 * nowhere -- so it is pinned here rather than left to the
 * resolvers' own tests, which all run inside a single Season.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultEpisode,
  createDefaultQuestDefinition,
  createDefaultScene,
  createDefaultSeason,
  getAllEpisodes,
  resolveActiveEpisode,
  resolveActiveScene,
  resolveUnlockedEpisodeIds,
  type Season
} from "../index";

const NOW = 1_700_000_000_000;

/**
 * Season one holds two Episodes; Season two holds the third. Every
 * Scene carries one quest, because a Scene with no quests counts as
 * complete (`isSceneComplete` runs `.every()` over an empty list) and
 * a story made of those makes the completion tests below vacuous.
 */
function story(options: { lastGate?: "always" | "manual" } = {}): Season[] {
  const sceneWithQuest = (sceneId: string) =>
    createDefaultScene({
      sceneId,
      questDefinitions: [
        createDefaultQuestDefinition({
          definitionId: `quest:${sceneId}`,
          displayName: sceneId
        })
      ]
    });

  return [
    createDefaultSeason({
      seasonId: "season:one",
      episodes: [
        createDefaultEpisode({
          episodeId: "e:a",
          scenes: [sceneWithQuest("s:a")]
        }),
        createDefaultEpisode({
          episodeId: "e:b",
          scenes: [sceneWithQuest("s:b")]
        })
      ]
    }),
    createDefaultSeason({
      seasonId: "season:two",
      episodes: [
        createDefaultEpisode({
          episodeId: "e:c",
          unlockCondition:
            options.lastGate === "manual" ? { kind: "manual" } : "always",
          scenes: [sceneWithQuest("s:c")]
        })
      ]
    })
  ];
}

/** Season one's quests are done; Season two's are not. */
const SEASON_ONE_DONE = (questDefinitionId: string) =>
  questDefinitionId === "quest:s:a" || questDefinitionId === "quest:s:b";

function unlocked(seasons: Season[], manual: string[] = []) {
  return resolveUnlockedEpisodeIds({
    episodes: getAllEpisodes(seasons),
    manuallyUnlockedEpisodeIds: manual,
    completedQuestIds: [],
    now: NOW
  });
}

describe("boot reads across a Season boundary", () => {
  it("gates every Episode in the story, not just the first Season's", () => {
    const seasons = story();
    expect([...unlocked(seasons)].sort()).toEqual(["e:a", "e:b", "e:c"]);
  });

  it("honours a gate on an Episode in the second Season", () => {
    const seasons = story({ lastGate: "manual" });
    expect(unlocked(seasons).has("e:c")).toBe(false);
    expect(unlocked(seasons, ["e:c"]).has("e:c")).toBe(true);
  });

  it("boots into an Episode in the second Season when the save asks for it", () => {
    // The save stores an Episode id and no Season. Resolution has to find
    // it wherever it lives, which is what makes storing a Season pointer
    // a second copy of a derived fact.
    const seasons = story();
    const episode = resolveActiveEpisode({
      episodes: getAllEpisodes(seasons),
      unlockedEpisodeIds: unlocked(seasons),
      requestedEpisodeId: "e:c"
    });
    expect(episode?.episodeId).toBe("e:c");
    expect(
      resolveActiveScene({ episode, requestedSceneId: null })?.sceneId
    ).toBe("s:c");
  });

  it("crosses into the next Season when the first Season is finished", () => {
    // Season one's Episodes are complete, so the frontier is the first
    // open Episode in the flattened run -- which sits in the next Season.
    // The boundary is not a stopping point.
    const seasons = story();
    const episode = resolveActiveEpisode({
      episodes: getAllEpisodes(seasons),
      unlockedEpisodeIds: unlocked(seasons),
      requestedEpisodeId: null,
      isQuestCompleted: SEASON_ONE_DONE
    });
    expect(episode?.episodeId).toBe("e:c");
    expect(
      resolveActiveScene({
        episode,
        requestedSceneId: null,
        isQuestCompleted: SEASON_ONE_DONE
      })?.sceneId
    ).toBe("s:c");
  });

  it("stops when the next Season's only Episode is gated shut", () => {
    // Nothing open past the boundary is a real position on the story
    // timeline, not a failure to find one.
    const seasons = story({ lastGate: "manual" });
    const episode = resolveActiveEpisode({
      episodes: getAllEpisodes(seasons),
      unlockedEpisodeIds: unlocked(seasons),
      requestedEpisodeId: null,
      isQuestCompleted: SEASON_ONE_DONE
    });
    expect(episode).toBeNull();
  });

  it("refuses a save pointing at an Episode whose gate is shut", () => {
    const seasons = story({ lastGate: "manual" });
    const episode = resolveActiveEpisode({
      episodes: getAllEpisodes(seasons),
      unlockedEpisodeIds: unlocked(seasons),
      requestedEpisodeId: "e:c"
    });
    expect(episode?.episodeId).not.toBe("e:c");
  });
});
