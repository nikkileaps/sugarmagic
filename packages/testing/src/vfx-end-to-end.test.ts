/**
 * VFX end-to-end fixture test.
 *
 * Mirrors the Wordlarky resonance-point setup with generic data only: a built
 * in flame definition, an item binding, and a placed item presence.
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultGameProject,
  createDefaultItemDefinition,
  createDefaultRegion,
  createEmptyContentLibrarySnapshot,
  createVFXBinding,
  findBuiltInVFXDefinition
} from "@sugarmagic/domain";
import { VFXDispatcher, VFXManager } from "@sugarmagic/runtime-core";

describe("VFX end-to-end binding", () => {
  it("registers and ticks an item-bound built-in flame emitter", () => {
    const project = createDefaultGameProject("VFX Test", "vfx-test");
    const contentLibrary = createEmptyContentLibrarySnapshot(project.identity.id);
    const flame = findBuiltInVFXDefinition(contentLibrary, "default-flame");
    expect(flame).not.toBeNull();

    const item = createDefaultItemDefinition({
      definitionId: "item:resonance-like",
      displayName: "Resonance-Like Point"
    });
    const binding = createVFXBinding({
      vfxDefinitionId: flame!.definitionId,
      localOffset: { x: 0, y: 0.2, z: 0 }
    });
    const region = createDefaultRegion({
      regionId: "region:vfx",
      displayName: "VFX Region"
    });
    const manager = new VFXManager(contentLibrary);
    const dispatcher = new VFXDispatcher({
      manager,
      itemDefinitions: [
        {
          ...item,
          presentation: {
            ...item.presentation,
            vfxBindings: [binding]
          }
        }
      ],
      activeRegion: {
        ...region,
        scene: {
          ...region.scene,
          itemPresences: [
            {
              presenceId: "presence:resonance-like",
              itemDefinitionId: item.definitionId,
              quantity: 1,
              shaderOverrides: [],
              shaderParameterOverrides: [],
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ]
        }
      }
    });

    dispatcher.sync();
    manager.update(1);

    const snapshots = manager.getSnapshots();
    expect(snapshots).toHaveLength(1);
    const first = snapshots[0]!;
    expect(first.kind).toBe("particle-emitter");
    expect(first.definition.definitionId).toBe(flame!.definitionId);
    if (first.kind === "particle-emitter") {
      expect(first.particles.length).toBeGreaterThan(0);
    }
  });
});
