/**
 * packages/domain/src/scenes/index.test.ts
 *
 * Purpose: Pins the Scene domain type's defensive normalization —
 * malformed input collapses to safe defaults, overlays coerce
 * through the region-authoring factories, and a Scene list dedupes
 * by id while PRESERVING input order.
 *
 * The gate and the campaign resolvers live in `episodes/` and are
 * tested there: a Scene is ordered but not gated.
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
    expect(scene.environmentOverride).toBeNull();
    expect(scene.audioOverride).toBeNull();
    expect(scene.transitionConfig).toBeNull();
    expect(scene.regionOverlays).toEqual({});
  });

  it("has no order number and no gate of its own", () => {
    // Asserting a field is ABSENT means reading off-type, so the
    // double cast is the point rather than a checker workaround.
    const scene = createDefaultScene() as unknown as Record<string, unknown>;
    expect(scene.sceneOrder).toBeUndefined();
    expect(scene.unlockCondition).toBeUndefined();
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
      displayName: "",
      environmentOverride: { environmentId: "" },
      audioOverride: { backgroundMusicId: "", ambientSoundId: "" },
      transitionConfig: { titleText: "" },
      regionOverlays: "nope"
    });
    expect(scene).not.toBeNull();
    expect(scene!.sceneId).toBe("scene:x");
    expect(scene!.displayName).toBe("Scene");
    expect(scene!.environmentOverride).toBeNull();
    expect(scene!.audioOverride).toBeNull();
    expect(scene!.transitionConfig).toBeNull();
    expect(scene!.regionOverlays).toEqual({});
  });

  it("drops a pre-Episodes order number and gate rather than keeping them", () => {
    const scene = normalizeScene({
      sceneId: "s",
      sceneOrder: 4,
      unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
    }) as Record<string, unknown> | null;
    expect(scene).not.toBeNull();
    expect(scene!.sceneOrder).toBeUndefined();
    expect(scene!.unlockCondition).toBeUndefined();
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

  it("PRESERVES input order and never sorts", () => {
    // Order is list position now. A sort here would be the load
    // path quietly rewriting the narrative, and unlike a wrong
    // sort key that damage cannot be recovered from.
    const scenes = normalizeScenes([
      { sceneId: "s:third" },
      { sceneId: "s:first" },
      { sceneId: "s:second" }
    ]);
    expect(scenes.map((scene) => scene.sceneId)).toEqual([
      "s:third",
      "s:first",
      "s:second"
    ]);
  });

  it("ignores a stale sceneOrder when deciding order", () => {
    const scenes = normalizeScenes([
      { sceneId: "s:a", sceneOrder: 99 },
      { sceneId: "s:b", sceneOrder: 0 }
    ]);
    expect(scenes.map((scene) => scene.sceneId)).toEqual(["s:a", "s:b"]);
  });
});
