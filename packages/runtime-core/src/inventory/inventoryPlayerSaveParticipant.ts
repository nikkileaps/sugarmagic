/**
 * packages/runtime-core/src/inventory/inventoryPlayerSaveParticipant.ts
 *
 * Purpose: `inventory.player` SaveParticipant factory. Bridges
 * the InventoryManager (whose lifetime is tied to
 * `gameplayAssembly`) to the SaveParticipantRegistry (whose
 * lifetime is the runtime host). Because InventoryManager doesn't
 * exist until partway through `host.start`, the factory takes a
 * nullable getter — the participant tolerates being called before
 * the assembly is ready by returning an empty slice (serialize)
 * or no-op'ing (deserialize).
 *
 * Implements: Plan 055 §055.5
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { InventoryManager, InventoryPlayerSlice } from "./index";

export const INVENTORY_PLAYER_PARTICIPANT_ID = "inventory.player";
export const INVENTORY_PLAYER_SLICE_SCHEMA_VERSION = 1;

export interface InventoryPlayerParticipantDeps {
  /** Returns the live InventoryManager, or null when
   *  `gameplayAssembly` hasn't been constructed yet. */
  getInventoryManager: () => InventoryManager | null;
}

function emptySlice(): InventoryPlayerSlice {
  return { entries: [] };
}

export function createInventoryPlayerSaveParticipant(
  deps: InventoryPlayerParticipantDeps
): SaveParticipant<InventoryPlayerSlice> {
  return {
    participantId: INVENTORY_PLAYER_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: INVENTORY_PLAYER_SLICE_SCHEMA_VERSION,
    serialize(): InventoryPlayerSlice {
      const manager = deps.getInventoryManager();
      if (!manager) return emptySlice();
      return manager.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<InventoryPlayerSlice> | null): void {
      const manager = deps.getInventoryManager();
      if (!manager) return;
      manager.deserializeSaveSlice(slice);
    }
  };
}
