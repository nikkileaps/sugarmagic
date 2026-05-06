/**
 * VFXDispatcher.
 *
 * Translates authored item bindings and region spawns into runtime VFX hosts.
 * It reads existing scene truth only; it does not own a parallel scene model.
 */

import type {
  ItemDefinition,
  RegionDocument,
  VFXVector3
} from "@sugarmagic/domain";
import { VFXManager } from "./VFXManager";

function addVector(a: VFXVector3, b: VFXVector3): VFXVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function tupleToVector(tuple: [number, number, number]): VFXVector3 {
  return { x: tuple[0], y: tuple[1], z: tuple[2] };
}

export class VFXDispatcher {
  private readonly manager: VFXManager;
  private itemDefinitions: ItemDefinition[];
  private activeRegion: RegionDocument | null;

  constructor(options: {
    manager: VFXManager;
    itemDefinitions: ItemDefinition[];
    activeRegion: RegionDocument | null;
  }) {
    this.manager = options.manager;
    this.itemDefinitions = options.itemDefinitions;
    this.activeRegion = options.activeRegion;
  }

  setSceneState(options: {
    itemDefinitions?: ItemDefinition[];
    activeRegion?: RegionDocument | null;
  }): void {
    if (options.itemDefinitions) {
      this.itemDefinitions = options.itemDefinitions;
    }
    if (options.activeRegion !== undefined) {
      this.activeRegion = options.activeRegion;
    }
  }

  sync(): void {
    const region = this.activeRegion;
    if (!region) {
      this.manager.syncHosts([]);
      return;
    }
    const itemsById = new Map(
      this.itemDefinitions.map((definition) => [
        definition.definitionId,
        definition
      ])
    );
    const hosts: Array<{
      hostId: string;
      definitionId: string;
      position: VFXVector3;
    }> = [];

    for (const presence of region.scene.itemPresences ?? []) {
      const definition = itemsById.get(presence.itemDefinitionId);
      if (!definition) continue;
      const basePosition = tupleToVector(presence.transform.position);
      for (const binding of definition.presentation.vfxBindings ?? []) {
        hosts.push({
          hostId: `item:${presence.presenceId}:vfx:${binding.bindingId}`,
          definitionId: binding.vfxDefinitionId,
          position: addVector(basePosition, binding.localOffset)
        });
      }
    }

    for (const spawn of region.vfx?.spawns ?? []) {
      hosts.push({
        hostId: `region:${region.identity.id}:vfx:${spawn.spawnId}`,
        definitionId: spawn.vfxDefinitionId,
        position: spawn.position
      });
    }

    this.manager.syncHosts(hosts);
  }
}
