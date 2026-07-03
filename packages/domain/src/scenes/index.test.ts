/**
 * packages/domain/src/scenes/index.test.ts
 *
 * Purpose: Pins the Scene domain type's defensive normalization
 * (Plan 058 §058.1) — malformed input collapses to safe defaults,
 * overlays coerce through the region-authoring factories, scenes
 * dedupe by id and sort by sceneOrder.
 *
 * Implements: Plan 058 §058.1 tests
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_ID,
  createDefaultScene,
  createRegionSceneOverlay,
  normalizeScene,
  normalizeScenes
} from "./index";

describe("createDefaultScene", () => {
  it("fills safe defaults and accepts overrides", () => {
    const scene = createDefaultScene({
      sceneId: DEFAULT_SCENE_ID,
      displayName: "The Founding"
    });
    expect(scene.sceneId).toBe("scene:default");
    expect(scene.displayName).toBe("The Founding");
    expect(scene.sceneOrder).toBe(0);
    expect(scene.unlockCondition).toBe("always");
    expect(scene.environmentOverride).toBeNull();
    expect(scene.audioOverride).toBeNull();
    expect(scene.transitionConfig).toBeNull();
    expect(scene.regionOverlays).toEqual({});
  });

  it("generates a unique sceneId when none is supplied", () => {
    const first = createDefaultScene();
    const second = createDefaultScene();
    expect(first.sceneId).not.toBe(second.sceneId);
  });
});

describe("normalizeScene", () => {
  it("returns null for non-objects and missing sceneId", () => {
    expect(normalizeScene(null)).toBeNull();
    expect(normalizeScene("scene:1")).toBeNull();
    expect(normalizeScene({})).toBeNull();
    expect(normalizeScene({ sceneId: "  " })).toBeNull();
  });

  it("coerces malformed fields to defaults", () => {
    const scene = normalizeScene({
      sceneId: " scene:x ",
      sceneOrder: "three",
      displayName: "",
      unlockCondition: { kind: "bogus" },
      environmentOverride: { environmentId: "" },
      audioOverride: { backgroundMusicId: "", ambientSoundId: "" },
      transitionConfig: { titleText: "" },
      regionOverlays: "nope"
    });
    expect(scene).not.toBeNull();
    expect(scene!.sceneId).toBe("scene:x");
    expect(scene!.sceneOrder).toBe(0);
    expect(scene!.displayName).toBe("Scene");
    expect(scene!.unlockCondition).toBe("always");
    expect(scene!.environmentOverride).toBeNull();
    expect(scene!.audioOverride).toBeNull();
    expect(scene!.transitionConfig).toBeNull();
    expect(scene!.regionOverlays).toEqual({});
  });

  it("preserves valid unlock conditions", () => {
    expect(
      normalizeScene({
        sceneId: "s",
        unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
      })!.unlockCondition
    ).toEqual({ kind: "questComplete", questDefinitionId: "q:1" });
    expect(
      normalizeScene({
        sceneId: "s",
        unlockCondition: { kind: "wallClock", unlockAtIso: "2026-09-15T00:00:00Z" }
      })!.unlockCondition
    ).toEqual({ kind: "wallClock", unlockAtIso: "2026-09-15T00:00:00Z" });
    expect(
      normalizeScene({ sceneId: "s", unlockCondition: { kind: "manual" } })!
        .unlockCondition
    ).toEqual({ kind: "manual" });
  });

  it("normalizes transition config with clamped defaults", () => {
    const scene = normalizeScene({
      sceneId: "s",
      transitionConfig: {
        titleText: "  CHAPTER 3  ",
        subtitleText: "The Reckoning",
        durationMs: -5,
        fadeStyle: "sparkle"
      }
    });
    expect(scene!.transitionConfig).toEqual({
      titleText: "CHAPTER 3",
      subtitleText: "The Reckoning",
      durationMs: 2500,
      fadeStyle: "black"
    });
  });

  it("normalizes region overlays through the presence factories", () => {
    const scene = normalizeScene({
      sceneId: "s",
      regionOverlays: {
        "region:town": {
          itemPresences: [
            { presenceId: "p:1", itemDefinitionId: "item:coin", quantity: 0 }
          ],
          npcPresences: [],
          playerPresence: null,
          placedAssets: [],
          folders: []
        }
      }
    });
    const overlay = scene!.regionOverlays["region:town"]!;
    // Factory clamps quantity to >= 1 — proves the coercion ran.
    expect(overlay.itemPresences[0]!.quantity).toBe(1);
    expect(overlay.itemPresences[0]!.presenceId).toBe("p:1");
  });

  it("treats a partial overlay object as coercible, not droppable", () => {
    const scene = normalizeScene({
      sceneId: "s",
      regionOverlays: { "region:town": {} }
    });
    expect(scene!.regionOverlays["region:town"]).toEqual(
      createRegionSceneOverlay()
    );
  });
});

describe("normalizeScenes", () => {
  it("returns empty for non-arrays", () => {
    expect(normalizeScenes(undefined)).toEqual([]);
    expect(normalizeScenes({})).toEqual([]);
  });

  it("drops malformed entries and dedupes by sceneId (first wins)", () => {
    const scenes = normalizeScenes([
      { sceneId: "s:1", displayName: "One" },
      null,
      { noSceneId: true },
      { sceneId: "s:1", displayName: "Duplicate" },
      { sceneId: "s:2", displayName: "Two" }
    ]);
    expect(scenes.map((scene) => scene.sceneId)).toEqual(["s:1", "s:2"]);
    expect(scenes[0]!.displayName).toBe("One");
  });

  it("sorts by sceneOrder", () => {
    const scenes = normalizeScenes([
      { sceneId: "s:late", sceneOrder: 5 },
      { sceneId: "s:early", sceneOrder: 1 },
      { sceneId: "s:mid", sceneOrder: 3 }
    ]);
    expect(scenes.map((scene) => scene.sceneId)).toEqual([
      "s:early",
      "s:mid",
      "s:late"
    ]);
  });
});
