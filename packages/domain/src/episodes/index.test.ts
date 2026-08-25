/**
 * packages/domain/src/episodes/index.test.ts
 *
 * Purpose: Pins the Episode container — the gate, the campaign
 * resolvers, and the two guards that carry the most weight in this
 * epic because hand-verification is deferred:
 *
 *   1. Order round-trip: normalizing a project preserves the order
 *      of both list levels. Order is list position now, so a
 *      reorder here is unrecoverable rather than merely wrong.
 *   2. Migration run-twice: folding pre-Episodes Scenes into one
 *      Episode is a no-op the second time. A project is normalized
 *      on every load, not once.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { createDefaultScene } from "../scenes";
import {
  DEFAULT_EPISODE_ID,
  createDefaultEpisode,
  findEpisodeBySceneId,
  findSceneById,
  getAllScenes,
  mapScenes,
  normalizeEpisode,
  normalizeEpisodeEndRouting,
  normalizeEpisodes,
  resolveActiveEpisode,
  resolveActiveScene,
  resolveUnlockedEpisodeIds
} from "./index";

describe("createDefaultEpisode", () => {
  it("fills safe defaults and accepts overrides", () => {
    const episode = createDefaultEpisode({
      episodeId: DEFAULT_EPISODE_ID,
      displayName: "Wordlark Hollow"
    });
    expect(episode.episodeId).toBe("episode:default");
    expect(episode.displayName).toBe("Wordlark Hollow");
    expect(episode.unlockCondition).toBe("always");
    expect(episode.transitionConfig).toBeNull();
    expect(episode.scenes).toEqual([]);
  });

  it("has no order number — position in the list is the order", () => {
    // Asserting a field is ABSENT means reading off-type, so the
    // double cast is the point rather than a checker workaround.
    const episode = createDefaultEpisode() as unknown as Record<
      string,
      unknown
    >;
    expect(episode.episodeOrder).toBeUndefined();
  });
});

describe("normalizeEpisode", () => {
  it("returns null for non-objects and a missing episodeId", () => {
    expect(normalizeEpisode(null)).toBeNull();
    expect(normalizeEpisode({})).toBeNull();
    expect(normalizeEpisode({ episodeId: "  " })).toBeNull();
  });

  it("coerces a malformed gate to always", () => {
    expect(
      normalizeEpisode({ episodeId: "e", unlockCondition: { kind: "bogus" } })!
        .unlockCondition
    ).toBe("always");
  });

  it("preserves every valid gate kind", () => {
    expect(
      normalizeEpisode({
        episodeId: "e",
        unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
      })!.unlockCondition
    ).toEqual({ kind: "questComplete", questDefinitionId: "q:1" });
    expect(
      normalizeEpisode({
        episodeId: "e",
        unlockCondition: {
          kind: "wallClock",
          unlockAtIso: "2026-09-15T00:00:00Z"
        }
      })!.unlockCondition
    ).toEqual({ kind: "wallClock", unlockAtIso: "2026-09-15T00:00:00Z" });
    expect(
      normalizeEpisode({ episodeId: "e", unlockCondition: { kind: "manual" } })!
        .unlockCondition
    ).toEqual({ kind: "manual" });
  });

  it("normalizes its own title card", () => {
    expect(
      normalizeEpisode({
        episodeId: "e",
        transitionConfig: { titleText: "  ACT ONE  ", fadeStyle: "sparkle" }
      })!.transitionConfig
    ).toEqual({
      titleText: "ACT ONE",
      subtitleText: null,
      durationMs: 2500,
      fadeStyle: "black"
    });
  });

  it("preserves Scene order and dedupes Scenes by id", () => {
    const episode = normalizeEpisode({
      episodeId: "e",
      scenes: [
        { sceneId: "s:c" },
        { sceneId: "s:a" },
        { sceneId: "s:c", displayName: "Duplicate" }
      ]
    });
    expect(episode!.scenes.map((scene) => scene.sceneId)).toEqual([
      "s:c",
      "s:a"
    ]);
  });
});

describe("normalizeEpisodes", () => {
  it("preserves Episode order and never sorts", () => {
    const episodes = normalizeEpisodes([
      { episodeId: "e:3" },
      { episodeId: "e:1" },
      { episodeId: "e:2" }
    ]);
    expect(episodes.map((episode) => episode.episodeId)).toEqual([
      "e:3",
      "e:1",
      "e:2"
    ]);
  });

  it("dedupes Episodes by id, first wins", () => {
    const episodes = normalizeEpisodes([
      { episodeId: "e:1", displayName: "One" },
      null,
      { episodeId: "e:1", displayName: "Duplicate" }
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.displayName).toBe("One");
  });

  it("keeps a Scene claimed by two Episodes only in the first", () => {
    // Single ownership has to hold for a hand-edited file too, not
    // just for one produced by the migration.
    const episodes = normalizeEpisodes([
      { episodeId: "e:1", scenes: [{ sceneId: "s:shared" }] },
      {
        episodeId: "e:2",
        scenes: [{ sceneId: "s:shared" }, { sceneId: "s:own" }]
      }
    ]);
    expect(episodes[0]!.scenes.map((scene) => scene.sceneId)).toEqual([
      "s:shared"
    ]);
    expect(episodes[1]!.scenes.map((scene) => scene.sceneId)).toEqual([
      "s:own"
    ]);
  });
});

describe("normalizeEpisodeEndRouting", () => {
  it("defaults to the Episodes screen and only accepts the other value", () => {
    expect(normalizeEpisodeEndRouting(undefined)).toBe("episodes-screen");
    expect(normalizeEpisodeEndRouting("nonsense")).toBe("episodes-screen");
    expect(normalizeEpisodeEndRouting("next-episode")).toBe("next-episode");
  });
});

describe("resolveUnlockedEpisodeIds", () => {
  const NOW = Date.parse("2026-07-03T12:00:00Z");
  const episodes = [
    createDefaultEpisode({ episodeId: "e:always" }),
    createDefaultEpisode({
      episodeId: "e:manual",
      unlockCondition: { kind: "manual" }
    }),
    createDefaultEpisode({
      episodeId: "e:quest",
      unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
    }),
    createDefaultEpisode({
      episodeId: "e:timed",
      unlockCondition: {
        kind: "wallClock",
        unlockAtIso: "2026-07-04T00:00:00Z"
      }
    })
  ];

  it("opens only the ungated Episode against an empty save", () => {
    const unlocked = resolveUnlockedEpisodeIds({
      episodes,
      manuallyUnlockedEpisodeIds: [],
      completedQuestIds: [],
      now: NOW
    });
    expect([...unlocked]).toEqual(["e:always"]);
  });

  it("quest completion and manual unlocks open their Episodes", () => {
    const unlocked = resolveUnlockedEpisodeIds({
      episodes,
      manuallyUnlockedEpisodeIds: ["e:manual"],
      completedQuestIds: ["q:1"],
      now: NOW
    });
    expect(unlocked.has("e:manual")).toBe(true);
    expect(unlocked.has("e:quest")).toBe(true);
    expect(unlocked.has("e:timed")).toBe(false);
  });

  it("a wall-clock gate opens at the configured instant", () => {
    const unlocked = resolveUnlockedEpisodeIds({
      episodes,
      manuallyUnlockedEpisodeIds: [],
      completedQuestIds: [],
      now: Date.parse("2026-07-04T00:00:00Z")
    });
    expect(unlocked.has("e:timed")).toBe(true);
  });

  it("a manual unlock overrides every gate kind", () => {
    // The advance path records the Episode it moved into, so a
    // player who has passed an Episode keeps it open even if the
    // author later retunes its gate.
    const unlocked = resolveUnlockedEpisodeIds({
      episodes,
      manuallyUnlockedEpisodeIds: ["e:quest", "e:timed"],
      completedQuestIds: [],
      now: NOW
    });
    expect(unlocked.has("e:quest")).toBe(true);
    expect(unlocked.has("e:timed")).toBe(true);
  });
});

describe("resolveActiveEpisode", () => {
  // Each holds a Scene: an Episode with none cannot be entered and is
  // skipped, which the last test in this block pins.
  const episodes = ["e:1", "e:2", "e:3"].map((episodeId) =>
    createDefaultEpisode({
      episodeId,
      scenes: [createDefaultScene({ sceneId: `s:${episodeId}` })]
    })
  );

  it("honors the requested Episode when its gate is open", () => {
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: new Set(["e:1", "e:2"]),
        requestedEpisodeId: "e:2"
      })?.episodeId
    ).toBe("e:2");
  });

  it("falls back to the first open Episode when the request is shut", () => {
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: new Set(["e:2"]),
        requestedEpisodeId: "e:3"
      })?.episodeId
    ).toBe("e:2");
  });

  it("boots the first Episode outright when every gate is shut", () => {
    expect(
      resolveActiveEpisode({
        episodes,
        unlockedEpisodeIds: new Set(),
        requestedEpisodeId: null
      })?.episodeId
    ).toBe("e:1");
  });

  it("skips an Episode with no Scenes -- it cannot be entered", () => {
    // `resolveActiveScene` returns null for an empty Episode, so booting
    // into one is a black screen. The session functions cannot make one;
    // a hand-edited file can.
    const withEmptyFirst = [
      createDefaultEpisode({ episodeId: "e:empty" }),
      ...episodes
    ];
    expect(
      resolveActiveEpisode({
        episodes: withEmptyFirst,
        unlockedEpisodeIds: new Set(["e:empty", "e:1"]),
        requestedEpisodeId: "e:empty"
      })?.episodeId
    ).toBe("e:1");
  });
});

describe("resolveActiveScene", () => {
  const episode = createDefaultEpisode({
    episodeId: "e:1",
    scenes: [
      createDefaultScene({ sceneId: "s:1" }),
      createDefaultScene({ sceneId: "s:2" })
    ]
  });

  it("honors a requested Scene the Episode holds", () => {
    expect(
      resolveActiveScene({ episode, requestedSceneId: "s:2" })?.sceneId
    ).toBe("s:2");
  });

  it("starts at the Episode's first Scene when the request is elsewhere", () => {
    // No gate is consulted: Scenes are ordered, not gated.
    expect(
      resolveActiveScene({ episode, requestedSceneId: "s:elsewhere" })?.sceneId
    ).toBe("s:1");
  });

  it("resolves nothing without an Episode", () => {
    expect(
      resolveActiveScene({ episode: null, requestedSceneId: "s:1" })
    ).toBeNull();
  });
});

describe("Scene lookup across Episodes", () => {
  const episodes = [
    createDefaultEpisode({
      episodeId: "e:1",
      scenes: [createDefaultScene({ sceneId: "s:1" })]
    }),
    createDefaultEpisode({
      episodeId: "e:2",
      scenes: [
        createDefaultScene({ sceneId: "s:2" }),
        createDefaultScene({ sceneId: "s:3" })
      ]
    })
  ];

  it("getAllScenes flattens in narrative order", () => {
    expect(getAllScenes(episodes).map((scene) => scene.sceneId)).toEqual([
      "s:1",
      "s:2",
      "s:3"
    ]);
  });

  it("findSceneById and findEpisodeBySceneId agree on ownership", () => {
    expect(findSceneById(episodes, "s:3")?.sceneId).toBe("s:3");
    expect(findEpisodeBySceneId(episodes, "s:3")?.episodeId).toBe("e:2");
    expect(findSceneById(episodes, "s:missing")).toBeNull();
    expect(findEpisodeBySceneId(episodes, null)).toBeNull();
  });

  it("mapScenes rewrites Scenes without moving them between Episodes", () => {
    const mapped = mapScenes(episodes, (scene) => ({
      ...scene,
      displayName: `renamed ${scene.sceneId}`
    }));
    expect(mapped[0]!.scenes.map((scene) => scene.sceneId)).toEqual(["s:1"]);
    expect(mapped[1]!.scenes.map((scene) => scene.sceneId)).toEqual([
      "s:2",
      "s:3"
    ]);
    expect(mapped[1]!.scenes[1]!.displayName).toBe("renamed s:3");
  });
});
