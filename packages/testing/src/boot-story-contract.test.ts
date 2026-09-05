/**
 * packages/testing/src/boot-story-contract.test.ts
 *
 * Purpose: the deploy side and the runtime side agree on how the
 * story rides in boot.json.
 *
 * Nothing else checks this. `buildBootJsonPayload` is declared
 * `Record<string, unknown>`, so the key it writes is invisible to
 * the typechecker, and target-web reads `payload.seasons` in a
 * different package. Rename one and not the other and every
 * published game boots to an empty story with no error -- the
 * deploy succeeds, the bundle is well-formed, and the player gets
 * a blank region.
 *
 * So these drive the real bake and feed its output to the real
 * reader, rather than asserting a key name on either side alone.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultEpisode,
  createDefaultGameProject,
  createDefaultRegion,
  createDefaultScene,
  createDefaultSeason,
  createEmptyContentLibrarySnapshot,
  getAllEpisodes,
  type GameProject
} from "@sugarmagic/domain";
import { buildPublishedWebManagedFiles } from "@sugarmagic/plugins";
import { normalizeBootPayload } from "@sugarmagic/target-web";

const REGION = createDefaultRegion({
  regionId: "region:town",
  displayName: "Town"
});

function twoSeasonProject(): GameProject {
  return {
    ...createDefaultGameProject("Probe", "probe"),
    regionRegistry: [{ regionId: "region:town" }],
    seasons: [
      createDefaultSeason({
        seasonId: "season:one",
        displayName: "Season One",
        episodes: [
          createDefaultEpisode({
            episodeId: "e:a",
            scenes: [
              createDefaultScene({ sceneId: "s:a", regionId: "region:town" })
            ]
          })
        ]
      }),
      createDefaultSeason({
        seasonId: "season:two",
        displayName: "Season Two",
        episodes: [
          createDefaultEpisode({
            episodeId: "e:b",
            scenes: [
              createDefaultScene({ sceneId: "s:b", regionId: "region:town" })
            ]
          })
        ]
      })
    ]
  };
}

function bakeBootJson(gameProject: GameProject): Record<string, unknown> {
  const files = buildPublishedWebManagedFiles(gameProject, {
    regions: [REGION],
    contentLibrary: createEmptyContentLibrarySnapshot("project:probe"),
    assetSources: {},
    activeRegionId: "region:town",
    activeEnvironmentId: null
  });
  const boot = files.find(
    (file) => file.relativePath === ".sugarmagic/published-web/boot.json"
  );
  expect(boot).toBeDefined();
  return JSON.parse(boot?.content ?? "{}") as Record<string, unknown>;
}

describe("the story survives the trip from deploy to runtime", () => {
  it("bakes Seasons under the key the runtime reads", () => {
    const parsed = bakeBootJson(twoSeasonProject());
    const payload = normalizeBootPayload(parsed);

    expect(payload.seasons?.map((season) => season.seasonId)).toEqual([
      "season:one",
      "season:two"
    ]);
    expect(
      getAllEpisodes(payload.seasons ?? []).map((episode) => episode.episodeId)
    ).toEqual(["e:a", "e:b"]);
  });

  it("does not bake the superseded episodes key", () => {
    // Both keys present would give the runtime two stories to choose
    // between, and the choice would live in whichever read it first.
    expect(bakeBootJson(twoSeasonProject()).episodes).toBeUndefined();
  });

  it("stamps the schema version the shape belongs to", () => {
    expect(bakeBootJson(twoSeasonProject()).schemaVersion).toBe(2);
  });

  it("reads a bundle baked before Seasons existed", () => {
    // A version-1 boot.json: the story as a flat Episode list. The
    // runtime wraps it rather than booting empty.
    const legacy = {
      schemaVersion: 1,
      regions: [],
      episodes: [
        createDefaultEpisode({
          episodeId: "e:old",
          scenes: [createDefaultScene({ sceneId: "s:old" })]
        })
      ]
    };
    const payload = normalizeBootPayload(legacy);

    expect(payload.seasons).toHaveLength(1);
    expect(
      getAllEpisodes(payload.seasons ?? []).map((episode) => episode.episodeId)
    ).toEqual(["e:old"]);
    expect(
      (payload as unknown as Record<string, unknown>).episodes
    ).toBeUndefined();
  });
});
