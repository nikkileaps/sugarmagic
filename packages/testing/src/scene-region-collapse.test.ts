/**
 * A Scene names exactly one region (epic #226 story 4).
 *
 * The old shape let a Scene dress several regions and carried a separate
 * `startingRegionId` -- two answers to "where does this happen". These pin
 * the collapse: which region survives, what happens to the content that
 * had nowhere to go, and how a Scene that named nowhere gets a region.
 */

import { describe, expect, it } from "vitest";
import {
  createEmptyContentLibrarySnapshot,
  createDefaultRegion,
  migrateToScenes,
  normalizeScenes,
  takeSceneRegionCollapseNotes,
  validateProjectContent,
  createDefaultGameProject,
  type Scene
} from "@sugarmagic/domain";

/** Nothing here is about textures, so an empty library is the right
 *  answer: no texture reference can dangle against it. */
const VALIDATION_CONTENT_LIBRARY = createEmptyContentLibrarySnapshot("test");

/** A pre-#226 Scene as it appears on disk. */
function legacyScene(overrides: Record<string, unknown>): unknown {
  return {
    sceneId: "scene:one",
    displayName: "Scene One",
    description: "",
    notes: "",
    environmentOverride: null,
    audioOverride: null,
    transitionConfig: null,
    ...overrides
  };
}

function overlayWith(npcCount: number): Record<string, unknown> {
  return {
    npcPresences: Array.from({ length: npcCount }, (_, index) => ({
      presenceId: `presence:npc-${index}`,
      npcDefinitionId: "npc:someone"
    })),
    itemPresences: [],
    playerPresence: null,
    placedAssets: [],
    folders: [],
    assetAppearanceOverrides: {}
  };
}

describe("collapsing a Scene onto one region", () => {
  it("keeps the region the author named as the start", () => {
    takeSceneRegionCollapseNotes();
    const scenes = normalizeScenes([
      legacyScene({
        startingRegionId: "region:harbour",
        regionOverlays: {
          "region:village": overlayWith(1),
          "region:harbour": overlayWith(2)
        }
      })
    ]);

    expect(scenes[0]!.regionId).toBe("region:harbour");
    expect(scenes[0]!.overlay.npcPresences).toHaveLength(2);
  });

  it("keeps the only region when the Scene named no start", () => {
    takeSceneRegionCollapseNotes();
    const scenes = normalizeScenes([
      legacyScene({ regionOverlays: { "region:village": overlayWith(3) } })
    ]);

    expect(scenes[0]!.regionId).toBe("region:village");
    expect(scenes[0]!.overlay.npcPresences).toHaveLength(3);
  });

  it("reports the content it could not carry over instead of dropping it silently", () => {
    takeSceneRegionCollapseNotes();
    normalizeScenes([
      legacyScene({
        startingRegionId: "region:harbour",
        regionOverlays: {
          "region:village": overlayWith(4),
          "region:harbour": overlayWith(1)
        }
      })
    ]);

    const notes = takeSceneRegionCollapseNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      sceneId: "scene:one",
      regionId: "region:village",
      npcPresences: 4
    });
  });

  it("a Scene that named nowhere continues where the story was", () => {
    takeSceneRegionCollapseNotes();
    const scenes = normalizeScenes([
      legacyScene({
        sceneId: "scene:one",
        startingRegionId: "region:harbour",
        regionOverlays: { "region:harbour": overlayWith(0) }
      }),
      legacyScene({ sceneId: "scene:two" }),
      legacyScene({ sceneId: "scene:three" })
    ]);

    // Not "the project's first region" -- that is an unrelated list's
    // order, and picking from it lands a Scene in a region nobody uses.
    expect(scenes.map((scene: Scene) => scene.regionId)).toEqual([
      "region:harbour",
      "region:harbour",
      "region:harbour"
    ]);
  });

  it("a leading Scene with nothing to inherit falls back to the first region", () => {
    takeSceneRegionCollapseNotes();
    const migrated = migrateToScenes({
      scenes: normalizeScenes([legacyScene({ sceneId: "scene:one" })]),
      regions: [
        createDefaultRegion({ regionId: "region:only", displayName: "Only" })
      ]
    });

    expect(migrated.scenes[0]!.regionId).toBe("region:only");
  });

  it("a Scene naming nowhere loads, and refuses the save", () => {
    takeSceneRegionCollapseNotes();
    const base = createDefaultGameProject("Test", "test");
    const project = {
      ...base,
      episodes: base.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => ({ ...scene, regionId: "" }))
      }))
    };
    const region = createDefaultRegion({
      regionId: "region:only",
      displayName: "Only"
    });

    // Studio has to open so the author can fix it; validation is the refusal.
    const result = validateProjectContent(
      project,
      [region],
      VALIDATION_CONTENT_LIBRARY
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("region")
      )
    ).toBe(true);
  });

  it("a Scene naming a region that does not exist refuses the save", () => {
    takeSceneRegionCollapseNotes();
    const base = createDefaultGameProject("Test", "test");
    const project = {
      ...base,
      episodes: base.episodes.map((episode) => ({
        ...episode,
        scenes: episode.scenes.map((scene) => ({
          ...scene,
          regionId: "region:deleted"
        }))
      }))
    };
    const region = createDefaultRegion({
      regionId: "region:only",
      displayName: "Only"
    });

    expect(
      validateProjectContent(project, [region], VALIDATION_CONTENT_LIBRARY)
        .valid
    ).toBe(false);
  });
});
