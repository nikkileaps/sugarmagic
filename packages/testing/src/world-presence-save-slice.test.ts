/**
 * packages/testing/src/world-presence-save-slice.test.ts
 *
 * Purpose: Verifies the world.presence save-participant
 * pipeline — WorldPresenceTracker markCollected + shouldSkip
 * behavior, (region, Scene) isolation, serialize/deserialize
 * round-trip, v1 -> v2 slice upgrade (Plan 058 §058.5),
 * participant factory forwarding.
 *
 * Implements: Plan 055 §055.6 tests, Plan 058 §058.5 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  WorldPresenceTracker,
  createWorldPresenceSaveParticipant
} from "@sugarmagic/runtime-core";
import type { WorldPresenceSlice, SaveSlice } from "@sugarmagic/runtime-core";

const S1 = "scene:one";
const S2 = "scene:two";

describe("WorldPresenceTracker", () => {
  describe("markCollected + shouldSkip", () => {
    it("shouldSkip returns true after markCollected for same region+scene+presence", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", S1, "presence:coin-1");
      expect(tracker.shouldSkip("region:hollow", S1, "presence:coin-1")).toBe(
        true
      );
    });

    it("shouldSkip returns false for un-collected presence in known region", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", S1, "presence:coin-1");
      expect(tracker.shouldSkip("region:hollow", S1, "presence:key-1")).toBe(
        false
      );
    });

    it("shouldSkip returns false for unknown region", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", S1, "presence:coin-1");
      expect(
        tracker.shouldSkip("region:elsewhere", S1, "presence:coin-1")
      ).toBe(false);
    });

    it("shouldSkip returns false for null regionId (no active region context)", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", S1, "presence:coin-1");
      expect(tracker.shouldSkip(null, S1, "presence:coin-1")).toBe(false);
    });

    it("markCollected with null regionId is a silent no-op", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected(null, S1, "presence:coin-1");
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });

    it("null sceneId keys under the default Scene (pre-Scenes callers)", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", null, "presence:coin-1");
      expect(
        tracker.shouldSkip("region:hollow", null, "presence:coin-1")
      ).toBe(true);
      expect(
        tracker.shouldSkip("region:hollow", "scene:default", "presence:coin-1")
      ).toBe(true);
    });
  });

  describe("(region, Scene) isolation", () => {
    it("collecting in region A doesn't affect region B", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", S1, "presence:x");
      tracker.markCollected("region:b", S1, "presence:y");
      expect(tracker.shouldSkip("region:a", S1, "presence:y")).toBe(false);
      expect(tracker.shouldSkip("region:b", S1, "presence:x")).toBe(false);
      expect(tracker.shouldSkip("region:a", S1, "presence:x")).toBe(true);
      expect(tracker.shouldSkip("region:b", S1, "presence:y")).toBe(true);
    });

    it("Plan 058 §058.5 — collecting in Scene 1 doesn't affect the same region in Scene 2", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", S1, "presence:x");
      expect(tracker.shouldSkip("region:a", S1, "presence:x")).toBe(true);
      expect(tracker.shouldSkip("region:a", S2, "presence:x")).toBe(false);
    });
  });

  describe("round-trip", () => {
    it("serialize + deserialize preserves all collected presences", () => {
      const source = new WorldPresenceTracker();
      source.markCollected("region:a", S1, "presence:1");
      source.markCollected("region:a", S2, "presence:2");
      source.markCollected("region:b", S1, "presence:3");

      const slice = source.serializeSaveSlice();

      const restored = new WorldPresenceTracker();
      restored.deserializeSaveSlice({ schemaVersion: 2, data: slice });

      expect(restored.shouldSkip("region:a", S1, "presence:1")).toBe(true);
      expect(restored.shouldSkip("region:a", S2, "presence:2")).toBe(true);
      expect(restored.shouldSkip("region:a", S1, "presence:2")).toBe(false);
      expect(restored.shouldSkip("region:b", S1, "presence:3")).toBe(true);
      expect(restored.serializeSaveSlice()).toEqual(slice);
    });

    it("empty tracker returns empty slice", () => {
      const tracker = new WorldPresenceTracker();
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });
  });

  describe("v1 -> v2 upgrade", () => {
    it("wraps flat v1 per-region arrays under the default Scene", () => {
      const tracker = new WorldPresenceTracker();
      tracker.deserializeSaveSlice({
        schemaVersion: 1,
        data: {
          collectedByRegion: {
            "region:a": ["presence:1", "presence:2"],
            "region:b": ["presence:3"]
          }
        }
      } as unknown as SaveSlice<WorldPresenceSlice>);

      expect(
        tracker.shouldSkip("region:a", "scene:default", "presence:1")
      ).toBe(true);
      expect(
        tracker.shouldSkip("region:a", "scene:default", "presence:2")
      ).toBe(true);
      expect(
        tracker.shouldSkip("region:b", "scene:default", "presence:3")
      ).toBe(true);
      // Upgraded state serializes in the v2 nested shape.
      expect(tracker.serializeSaveSlice()).toEqual({
        collectedByRegion: {
          "region:a": { "scene:default": ["presence:1", "presence:2"] },
          "region:b": { "scene:default": ["presence:3"] }
        }
      });
      // Other Scenes stay independent post-upgrade.
      expect(tracker.shouldSkip("region:a", S2, "presence:1")).toBe(false);
    });
  });

  describe("deserialize edge cases", () => {
    it("deserialize(null) resets to empty (fresh player)", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", S1, "presence:x");
      tracker.deserializeSaveSlice(null);
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });

    it("deserialize with slice clobbers existing state", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", S1, "presence:stale");
      tracker.deserializeSaveSlice({
        schemaVersion: 2,
        data: { collectedByRegion: { "region:b": { [S1]: ["presence:fresh"] } } }
      });
      expect(tracker.shouldSkip("region:a", S1, "presence:stale")).toBe(false);
      expect(tracker.shouldSkip("region:b", S1, "presence:fresh")).toBe(true);
    });
  });

  describe("reset()", () => {
    it("wipes every recorded collection", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", S1, "presence:x");
      tracker.markCollected("region:b", S2, "presence:y");
      tracker.reset();
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });
  });
});

describe("createWorldPresenceSaveParticipant", () => {
  it("declares participantId, tier region-aware, schemaVersion per the contract", () => {
    const tracker = new WorldPresenceTracker();
    const p = createWorldPresenceSaveParticipant({ tracker });
    expect(p.participantId).toBe("world.presence");
    expect(p.tier).toBe("region-aware");
    expect(p.schemaVersion).toBe(2);
  });

  it("serialize forwards to the tracker", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", S1, "presence:x");
    const p = createWorldPresenceSaveParticipant({ tracker });
    expect(p.serialize()).toEqual({
      collectedByRegion: { "region:a": { [S1]: ["presence:x"] } }
    });
  });

  it("deserialize forwards to the tracker (clobber)", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", S1, "presence:stale");
    const p = createWorldPresenceSaveParticipant({ tracker });
    p.deserialize({
      schemaVersion: 2,
      data: {
        collectedByRegion: { "region:b": { [S1]: ["presence:fresh"] } }
      }
    } as SaveSlice<WorldPresenceSlice>);
    expect(tracker.shouldSkip("region:a", S1, "presence:stale")).toBe(false);
    expect(tracker.shouldSkip("region:b", S1, "presence:fresh")).toBe(true);
  });

  it("deserialize(null) resets the tracker", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", S1, "presence:x");
    const p = createWorldPresenceSaveParticipant({ tracker });
    p.deserialize(null);
    expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
  });
});
