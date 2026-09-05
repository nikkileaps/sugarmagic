/**
 * targets/web/src/bootPayload.test.ts
 *
 * Purpose: the boot payload's file seam — what the runtime does
 * with a bundle baked by an older engine.
 *
 * `/boot.json` is one of only two places untyped data enters the
 * game, so it is the one place the legacy campaign shape can still
 * appear. These pin the precedence and, just as importantly, the
 * case that is deliberately NOT handled: a payload with no
 * campaign at all is left empty rather than given a made-up one.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultEpisode,
  createDefaultScene,
  createDefaultSeason,
  DEFAULT_SEASON_ID,
  getAllEpisodes
} from "@sugarmagic/domain";
import { normalizeBootPayload } from "./bootPayload";

const LEGACY_EPISODES = [
  createDefaultEpisode({
    episodeId: "e:second",
    scenes: [createDefaultScene({ sceneId: "s:b" })]
  }),
  createDefaultEpisode({
    episodeId: "e:first",
    scenes: [createDefaultScene({ sceneId: "s:a" })]
  })
];

describe("reading a boot payload", () => {
  it("passes an authored seasons payload through untouched", () => {
    const seasons = [
      createDefaultSeason({ seasonId: "season:one", episodes: LEGACY_EPISODES })
    ];
    const payload = normalizeBootPayload({ regions: [], seasons });
    expect(payload.seasons).toEqual(seasons);
  });

  it("wraps a pre-Seasons episodes list in one Season, in order", () => {
    const payload = normalizeBootPayload({
      regions: [],
      episodes: LEGACY_EPISODES
    });
    expect(payload.seasons).toHaveLength(1);
    expect(payload.seasons![0]!.seasonId).toBe(DEFAULT_SEASON_ID);
    expect(
      getAllEpisodes(payload.seasons!).map((episode) => episode.episodeId)
    ).toEqual(["e:second", "e:first"]);
  });

  it("falls through an EMPTY seasons array to the legacy list", () => {
    // Presence is not the test. A half-migrated bundle carrying
    // `seasons: []` beside a real campaign must not boot as empty.
    const payload = normalizeBootPayload({
      regions: [],
      seasons: [],
      episodes: LEGACY_EPISODES
    });
    expect(getAllEpisodes(payload.seasons ?? [])).toHaveLength(2);
  });

  it("leaves a payload with no campaign empty rather than inventing one", () => {
    // Studio has a one-Scene floor because an author always needs
    // somewhere to work. The runtime's position is the opposite: an
    // empty campaign is a real state, and fabricating one here would
    // disguise a bundle that shipped wrong as a bundle that is fine.
    const payload = normalizeBootPayload({ regions: [] });
    expect(getAllEpisodes(payload.seasons ?? [])).toHaveLength(0);
  });

  it("survives a payload that is not an object at all", () => {
    expect(getAllEpisodes(normalizeBootPayload(null).seasons ?? [])).toEqual(
      []
    );
  });
});
