/**
 * VFX runtime tests.
 *
 * Verifies runtime-core owns particle simulation, host lifecycle, and cleanup
 * independent from render targets.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createDefaultVFXDefinition,
  createEmptyContentLibrarySnapshot,
  createDefaultItemDefinition,
  createDefaultRegion,
  createVFXBinding
} from "@sugarmagic/domain";
import { VFXDispatcher, VFXEmitter, VFXManager } from "@sugarmagic/runtime-core";

describe("runtime VFX", () => {
  it("emits particles from a fixed-size pool without growing past maxParticles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const definition = createDefaultVFXDefinition({
      emissionRatePerSecond: 10,
      maxParticles: 5,
      lifetimeMinSeconds: 1,
      lifetimeMaxSeconds: 1
    });
    const emitter = new VFXEmitter({
      emitterId: "emitter",
      hostId: "host",
      definition,
      position: { x: 0, y: 0, z: 0 }
    });

    for (let frame = 0; frame < 4; frame += 1) {
      emitter.update(0.25);
    }

    expect(emitter.getPoolSize()).toBe(5);
    expect(emitter.getActiveParticleCount()).toBe(5);
    expect(emitter.snapshot().particles).toHaveLength(5);
    vi.mocked(Math.random).mockRestore();
  });

  it("syncs item bindings and region spawns into manager hosts", () => {
    const definition = createDefaultVFXDefinition({ definitionId: "vfx:test" });
    const contentLibrary = {
      ...createEmptyContentLibrarySnapshot("vfx-test"),
      vfxDefinitions: [definition]
    };
    const manager = new VFXManager(contentLibrary);
    const binding = createVFXBinding({
      vfxDefinitionId: definition.definitionId,
      localOffset: { x: 0, y: 0.5, z: 0 }
    });
    const item = createDefaultItemDefinition({
      definitionId: "item:test",
      displayName: "VFX Item"
    });
    const region = createDefaultRegion({
      regionId: "region:test",
      displayName: "Region"
    });
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
              presenceId: "presence:item",
              itemDefinitionId: item.definitionId,
              quantity: 1,
              shaderOverrides: [],
              shaderParameterOverrides: [],
              transform: {
                position: [1, 2, 3],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
              }
            }
          ]
        },
        vfx: {
          spawns: [
            {
              spawnId: "spawn:one",
              vfxDefinitionId: definition.definitionId,
              position: { x: 4, y: 5, z: 6 }
            }
          ]
        }
      }
    });

    dispatcher.sync();
    manager.update(1);

    expect(manager.getEmitterCount()).toBe(2);
    expect(manager.getSnapshots()).toHaveLength(2);

    dispatcher.setSceneState({ activeRegion: null });
    dispatcher.sync();
    expect(manager.getEmitterCount()).toBe(0);
  });
});
