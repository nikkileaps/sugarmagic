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
  normalizeScenes,
  resolveActiveScene,
  resolveUnlockedSceneIds
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

describe("resolveUnlockedSceneIds", () => {
  const NOW = Date.parse("2026-07-03T12:00:00Z");
  const scenes = [
    createDefaultScene({ sceneId: "s:always", sceneOrder: 0 }),
    createDefaultScene({
      sceneId: "s:manual",
      sceneOrder: 1,
      unlockCondition: { kind: "manual" }
    }),
    createDefaultScene({
      sceneId: "s:quest",
      sceneOrder: 2,
      unlockCondition: { kind: "questComplete", questDefinitionId: "q:1" }
    }),
    createDefaultScene({
      sceneId: "s:timed",
      sceneOrder: 3,
      unlockCondition: {
        kind: "wallClock",
        unlockAtIso: "2026-07-04T00:00:00Z"
      }
    })
  ];

  it("evaluates each condition kind against save state", () => {
    const unlocked = resolveUnlockedSceneIds({
      scenes,
      manuallyUnlockedSceneIds: [],
      completedQuestIds: [],
      now: NOW
    });
    expect([...unlocked]).toEqual(["s:always"]);
  });

  it("quest completion and manual unlocks open their Scenes", () => {
    const unlocked = resolveUnlockedSceneIds({
      scenes,
      manuallyUnlockedSceneIds: ["s:manual"],
      completedQuestIds: ["q:1"],
      now: NOW
    });
    expect(unlocked.has("s:manual")).toBe(true);
    expect(unlocked.has("s:quest")).toBe(true);
    expect(unlocked.has("s:timed")).toBe(false);
  });

  it("wall clock unlocks at the configured instant", () => {
    const unlocked = resolveUnlockedSceneIds({
      scenes,
      manuallyUnlockedSceneIds: [],
      completedQuestIds: [],
      now: Date.parse("2026-07-04T00:00:00Z")
    });
    expect(unlocked.has("s:timed")).toBe(true);
  });

  it("a manual unlock overrides any condition kind", () => {
    const unlocked = resolveUnlockedSceneIds({
      scenes,
      manuallyUnlockedSceneIds: ["s:quest", "s:timed"],
      completedQuestIds: [],
      now: NOW
    });
    expect(unlocked.has("s:quest")).toBe(true);
    expect(unlocked.has("s:timed")).toBe(true);
  });
});

describe("resolveActiveScene", () => {
  const scenes = [
    createDefaultScene({ sceneId: "s:1", sceneOrder: 0 }),
    createDefaultScene({ sceneId: "s:2", sceneOrder: 1 }),
    createDefaultScene({ sceneId: "s:3", sceneOrder: 2 })
  ];

  it("honors the requested Scene when unlocked", () => {
    const active = resolveActiveScene({
      scenes,
      unlockedSceneIds: new Set(["s:1", "s:2"]),
      requestedSceneId: "s:2"
    });
    expect(active?.sceneId).toBe("s:2");
  });

  it("falls back to the first unlocked Scene when the request is locked", () => {
    const active = resolveActiveScene({
      scenes,
      unlockedSceneIds: new Set(["s:2"]),
      requestedSceneId: "s:3"
    });
    expect(active?.sceneId).toBe("s:2");
  });

  it("boots the first Scene outright when everything is locked", () => {
    const active = resolveActiveScene({
      scenes,
      unlockedSceneIds: new Set(),
      requestedSceneId: null
    });
    expect(active?.sceneId).toBe("s:1");
  });
});
