/**
 * Collections with no Scene active (epic #226 story 6).
 *
 * A region can be entered with nothing dressing it -- that is what free
 * roam is. Those collections need their own memory: the bucket a null
 * Scene used to fall back to was `scene:default`, which is a REAL Scene in
 * a live project, so free-roam pickups and that Scene's pickups shared one
 * set in both directions.
 *
 * The composition half of the resolution rule is pinned in
 * `two-layer-composition.test.ts`; this covers what the runtime remembers.
 */

import { describe, expect, it } from "vitest";
import {
  NO_SCENE_COLLECTION_BUCKET,
  WORLD_PRESENCE_SLICE_SCHEMA_VERSION,
  WorldPresenceTracker
} from "@sugarmagic/runtime-core";
import { DEFAULT_SCENE_ID } from "@sugarmagic/domain";

const REGION = "region:hollow";
const COIN = "presence:coin-1";

describe("collections with no Scene active", () => {
  it("the bucket can never be a Scene id", () => {
    // Scene ids are `scene:<uuid>` or the literal `scene:default`, so a
    // bucket that does not start with `scene:` cannot collide with one.
    expect(NO_SCENE_COLLECTION_BUCKET.startsWith("scene:")).toBe(false);
    expect(NO_SCENE_COLLECTION_BUCKET).not.toBe(DEFAULT_SCENE_ID);
  });

  it("free roam and a Scene keep separate memories, both directions", () => {
    const tracker = new WorldPresenceTracker();

    tracker.markCollected(REGION, null, COIN);
    expect(tracker.shouldSkip(REGION, DEFAULT_SCENE_ID, COIN)).toBe(false);

    const other = new WorldPresenceTracker();
    other.markCollected(REGION, DEFAULT_SCENE_ID, COIN);
    expect(other.shouldSkip(REGION, null, COIN)).toBe(false);
  });

  it("a no-Scene collection survives save and load", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected(REGION, null, COIN);

    const restored = new WorldPresenceTracker();
    restored.deserializeSaveSlice({
      schemaVersion: WORLD_PRESENCE_SLICE_SCHEMA_VERSION,
      data: tracker.serializeSaveSlice()
    });

    expect(restored.shouldSkip(REGION, null, COIN)).toBe(true);
    expect(restored.shouldSkip(REGION, DEFAULT_SCENE_ID, COIN)).toBe(false);
  });

  it("it lands in its own bucket on the wire", () => {
    const tracker = new WorldPresenceTracker();
    tracker.markCollected(REGION, null, COIN);

    const slice = tracker.serializeSaveSlice();
    expect(slice.collectedByRegion[REGION]).toEqual({
      [NO_SCENE_COLLECTION_BUCKET]: [COIN]
    });
  });

  it("a v2 save carries across unchanged", () => {
    // Deliberately identity: a v2 save cannot say which of its
    // `scene:default` entries were collected with no Scene active, and
    // re-keying them would move real Scene collections into the free-roam
    // bucket. Leaving them where the player earned them cannot be wrong.
    const restored = new WorldPresenceTracker();
    restored.deserializeSaveSlice({
      schemaVersion: 2,
      data: { collectedByRegion: { [REGION]: { [DEFAULT_SCENE_ID]: [COIN] } } }
    });

    expect(restored.shouldSkip(REGION, DEFAULT_SCENE_ID, COIN)).toBe(true);
    expect(restored.shouldSkip(REGION, null, COIN)).toBe(false);
  });

  it("a v1 save still upgrades into the default Scene", () => {
    // Pre-Scenes saves were implicitly playing the default Scene, so they
    // belong there and NOT in the free-roam bucket.
    const restored = new WorldPresenceTracker();
    restored.deserializeSaveSlice({
      schemaVersion: 1,
      data: { collectedByRegion: { [REGION]: [COIN] } } as never
    });

    expect(restored.shouldSkip(REGION, DEFAULT_SCENE_ID, COIN)).toBe(true);
    expect(restored.shouldSkip(REGION, null, COIN)).toBe(false);
  });
});
