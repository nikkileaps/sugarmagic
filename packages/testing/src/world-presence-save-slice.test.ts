/**
 * packages/testing/src/world-presence-save-slice.test.ts
 *
 * Purpose: Verifies the world.presence save-participant
 * pipeline — WorldPresenceTracker markCollected + shouldSkip
 * behavior, region isolation, serialize/deserialize round-trip,
 * participant factory forwarding.
 *
 * Implements: Plan 055 §055.6 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  WorldPresenceTracker,
  createWorldPresenceSaveParticipant
} from "@sugarmagic/runtime-core";
import type { WorldPresenceSlice, SaveSlice } from "@sugarmagic/runtime-core";

describe("WorldPresenceTracker", () => {
  describe("markCollected + shouldSkip", () => {
    it("shouldSkip returns true after markCollected for same region+presence", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", "presence:coin-1");
      expect(tracker.shouldSkip("region:hollow", "presence:coin-1")).toBe(true);
    });

    it("shouldSkip returns false for un-collected presence in known region", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", "presence:coin-1");
      expect(tracker.shouldSkip("region:hollow", "presence:key-1")).toBe(false);
    });

    it("shouldSkip returns false for unknown region", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", "presence:coin-1");
      expect(tracker.shouldSkip("region:elsewhere", "presence:coin-1")).toBe(
        false
      );
    });

    it("shouldSkip returns false for null regionId (no active region context)", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:hollow", "presence:coin-1");
      expect(tracker.shouldSkip(null, "presence:coin-1")).toBe(false);
    });

    it("markCollected with null regionId is a silent no-op", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected(null, "presence:coin-1");
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });
  });

  describe("region isolation", () => {
    it("collecting in region A doesn't affect region B", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", "presence:x");
      tracker.markCollected("region:b", "presence:y");
      expect(tracker.shouldSkip("region:a", "presence:y")).toBe(false);
      expect(tracker.shouldSkip("region:b", "presence:x")).toBe(false);
      expect(tracker.shouldSkip("region:a", "presence:x")).toBe(true);
      expect(tracker.shouldSkip("region:b", "presence:y")).toBe(true);
    });
  });

  describe("round-trip", () => {
    it("serialize + deserialize preserves all collected presences", () => {
      const source = new WorldPresenceTracker();
      source.markCollected("region:a", "presence:1");
      source.markCollected("region:a", "presence:2");
      source.markCollected("region:b", "presence:3");

      const slice = source.serializeSaveSlice();

      const restored = new WorldPresenceTracker();
      restored.deserializeSaveSlice({ schemaVersion: 1, data: slice });

      expect(restored.shouldSkip("region:a", "presence:1")).toBe(true);
      expect(restored.shouldSkip("region:a", "presence:2")).toBe(true);
      expect(restored.shouldSkip("region:b", "presence:3")).toBe(true);
      expect(restored.serializeSaveSlice()).toEqual(slice);
    });

    it("empty tracker returns empty slice", () => {
      const tracker = new WorldPresenceTracker();
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });
  });

  describe("deserialize edge cases", () => {
    it("deserialize(null) resets to empty (fresh player)", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", "presence:x");
      tracker.deserializeSaveSlice(null);
      expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
    });

    it("deserialize with slice clobbers existing state", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", "presence:stale");
      tracker.deserializeSaveSlice({
        schemaVersion: 1,
        data: { collectedByRegion: { "region:b": ["presence:fresh"] } }
      });
      expect(tracker.shouldSkip("region:a", "presence:stale")).toBe(false);
      expect(tracker.shouldSkip("region:b", "presence:fresh")).toBe(true);
    });
  });

  describe("reset()", () => {
    it("wipes every recorded collection", () => {
      const tracker = new WorldPresenceTracker();
      tracker.markCollected("region:a", "presence:x");
      tracker.markCollected("region:b", "presence:y");
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
    expect(p.schemaVersion).toBe(1);
  });

  it("serialize forwards to the tracker", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", "presence:x");
    const p = createWorldPresenceSaveParticipant({ tracker });
    expect(p.serialize()).toEqual({
      collectedByRegion: { "region:a": ["presence:x"] }
    });
  });

  it("deserialize forwards to the tracker (clobber)", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", "presence:stale");
    const p = createWorldPresenceSaveParticipant({ tracker });
    p.deserialize({
      schemaVersion: 1,
      data: {
        collectedByRegion: { "region:b": ["presence:fresh"] }
      }
    } as SaveSlice<WorldPresenceSlice>);
    expect(tracker.shouldSkip("region:a", "presence:stale")).toBe(false);
    expect(tracker.shouldSkip("region:b", "presence:fresh")).toBe(true);
  });

  it("deserialize(null) resets the tracker", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected("region:a", "presence:x");
    const p = createWorldPresenceSaveParticipant({ tracker });
    p.deserialize(null);
    expect(tracker.serializeSaveSlice()).toEqual({ collectedByRegion: {} });
  });
});
