/**
 * VFX domain contract tests.
 *
 * Guards the content-library VFX source of truth, item bindings, and region
 * spawn normalization.
 */

import { describe, expect, it } from "vitest";
import {
  createAuthoringSession,
  createDefaultGameProject,
  createDefaultItemDefinition,
  createDefaultRegion,
  createEmptyContentLibrarySnapshot,
  createVFXBinding,
  createRegionVFXSpawn,
  normalizeContentLibrarySnapshot,
  findBuiltInVFXDefinition
} from "@sugarmagic/domain";

describe("VFX domain", () => {
  it("seeds built-in VFX definitions and preserves their ids during normalization", () => {
    const snapshot = createEmptyContentLibrarySnapshot("vfx-test");
    const flame = findBuiltInVFXDefinition(snapshot, "default-flame");
    const sparkle = findBuiltInVFXDefinition(snapshot, "default-sparkle");

    expect(flame?.displayName).toBe("Default Flame");
    expect(sparkle?.displayName).toBe("Default Sparkle");
    expect(flame?.definitionKind).toBe("vfx");

    const normalized = normalizeContentLibrarySnapshot(snapshot, "vfx-test");
    expect(
      findBuiltInVFXDefinition(normalized, "default-flame")?.definitionId
    ).toBe(flame?.definitionId);
  });

  it("normalizes absent item bindings and region vfx state to empty arrays", () => {
    const project = createDefaultGameProject("VFX Test", "vfx-test");
    const contentLibrary = createEmptyContentLibrarySnapshot(project.identity.id);
    const region = createDefaultRegion({
      regionId: "region:vfx",
      displayName: "VFX Region"
    });
    const item = createDefaultItemDefinition({
      definitionId: "item:vfx",
      displayName: "VFX Item"
    });

    const session = createAuthoringSession(
      {
        ...project,
        itemDefinitions: [
          {
            ...item,
            presentation: {
              modelAssetDefinitionId: null,
              thumbnailAssetPath: null
            }
          } as never
        ]
      },
      [{ ...region, vfx: undefined } as never],
      contentLibrary
    );

    expect(
      session.gameProject.itemDefinitions[0]?.presentation.vfxBindings
    ).toEqual([]);
    expect(session.regions.get("region:vfx")?.vfx?.spawns).toEqual([]);
  });

  it("round-trips item bindings and region spawns", () => {
    const binding = createVFXBinding({
      vfxDefinitionId: "vfx:one",
      localOffset: { x: 0, y: 0.2, z: 0 }
    });
    const spawn = createRegionVFXSpawn({
      vfxDefinitionId: "vfx:one",
      position: { x: 1, y: 2, z: 3 }
    });

    expect(binding.localOffset.y).toBe(0.2);
    expect(spawn.position).toEqual({ x: 1, y: 2, z: 3 });
  });
});
