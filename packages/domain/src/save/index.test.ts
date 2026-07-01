/**
 * packages/domain/src/save/index.test.ts
 *
 * Purpose: Verifies upgradeLegacyPayload normalizes pre-055
 * three-field payloads into the new slice-carrying shape and
 * leaves already-upgraded payloads untouched.
 *
 * Implements: Plan 055 §055.2 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { GameSavePayload } from "./index";
import { upgradeLegacyPayload } from "./index";

describe("upgradeLegacyPayload", () => {
  it("returns a payload with slices untouched when slices already populated", () => {
    const already: GameSavePayload = {
      slices: {
        "host.player": {
          schemaVersion: 1,
          data: {
            currentRegionId: "region:hollow",
            playerPosition: { x: 3, y: 0, z: 5 }
          }
        }
      },
      currentRegionId: "region:hollow",
      currentQuestId: null,
      playerPosition: { x: 3, y: 0, z: 5 }
    };
    const upgraded = upgradeLegacyPayload(already);
    // Slices exactly preserved, no re-synthesis
    expect(upgraded.slices).toEqual(already.slices);
    // Legacy fields also preserved
    expect(upgraded.currentRegionId).toBe("region:hollow");
    expect(upgraded.currentQuestId).toBeNull();
    expect(upgraded.playerPosition).toEqual({ x: 3, y: 0, z: 5 });
  });

  it("synthesizes host.player + quest.manager slices from legacy fields", () => {
    const legacy = {
      currentRegionId: "region:garden",
      currentQuestId: "quest:find-the-cat",
      playerPosition: { x: 1, y: 0, z: 2 }
    };
    const upgraded = upgradeLegacyPayload(legacy);
    expect(upgraded.slices["host.player"]).toEqual({
      schemaVersion: 1,
      data: {
        currentRegionId: "region:garden",
        playerPosition: { x: 1, y: 0, z: 2 }
      }
    });
    expect(upgraded.slices["quest.manager"]).toEqual({
      schemaVersion: 1,
      data: {
        trackedQuestDefinitionId: "quest:find-the-cat"
      }
    });
    // Legacy fields preserved for back-compat
    expect(upgraded.currentRegionId).toBe("region:garden");
    expect(upgraded.currentQuestId).toBe("quest:find-the-cat");
    expect(upgraded.playerPosition).toEqual({ x: 1, y: 0, z: 2 });
  });

  it("synthesizes slices with null data when all legacy fields are null", () => {
    const legacy = {
      currentRegionId: null,
      currentQuestId: null,
      playerPosition: null
    };
    const upgraded = upgradeLegacyPayload(legacy);
    // Both slices exist so the participants get a slice on
    // deserialize (they receive it and can populate defaults
    // from the null data rather than "no slice at all").
    expect(upgraded.slices["host.player"]?.data).toEqual({
      currentRegionId: null,
      playerPosition: null
    });
    expect(upgraded.slices["quest.manager"]?.data).toEqual({
      trackedQuestDefinitionId: null
    });
  });

  it("respects the slices field when it's present but empty (still upgrades)", () => {
    // Belt-and-suspenders: an on-disk save might have `slices: {}`
    // written by an early-055 build before any participant was
    // registered. Treat that as a legacy payload — upgrade it.
    const legacy = {
      slices: {},
      currentRegionId: "region:port",
      currentQuestId: null,
      playerPosition: { x: 0, y: 0, z: 0 }
    };
    const upgraded = upgradeLegacyPayload(legacy);
    expect(Object.keys(upgraded.slices).sort()).toEqual([
      "host.player",
      "quest.manager"
    ]);
  });

  it("is idempotent — running twice matches running once", () => {
    const legacy = {
      currentRegionId: "region:cave",
      currentQuestId: "quest:main",
      playerPosition: { x: 4, y: 2, z: 6 }
    };
    const once = upgradeLegacyPayload(legacy);
    const twice = upgradeLegacyPayload(once);
    expect(twice).toEqual(once);
  });
});
