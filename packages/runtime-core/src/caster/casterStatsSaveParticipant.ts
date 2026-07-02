/**
 * packages/runtime-core/src/caster/casterStatsSaveParticipant.ts
 *
 * Purpose: `caster.stats` SaveParticipant factory. Bridges the
 * CasterManager (whose lifetime is tied to `gameplayAssembly`)
 * to the SaveParticipantRegistry (whose lifetime is the runtime
 * host). Same nullable-getter pattern as `quest.manager` and
 * `inventory.player`.
 *
 * Implements: Plan 056 §056.1
 *
 * Status: active
 */

import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { CasterManager, CasterStatsSlice } from "./CasterManager";

export const CASTER_STATS_PARTICIPANT_ID = "caster.stats";
export const CASTER_STATS_SLICE_SCHEMA_VERSION = 1;

export interface CasterStatsParticipantDeps {
  /** Returns the live CasterManager, or null when
   *  `gameplayAssembly` hasn't been constructed yet. */
  getCasterManager: () => CasterManager | null;
}

function emptySlice(): CasterStatsSlice {
  return { casters: {} };
}

export function createCasterStatsSaveParticipant(
  deps: CasterStatsParticipantDeps
): SaveParticipant<CasterStatsSlice> {
  return {
    participantId: CASTER_STATS_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: CASTER_STATS_SLICE_SCHEMA_VERSION,
    serialize(): CasterStatsSlice {
      const manager = deps.getCasterManager();
      if (!manager) return emptySlice();
      return manager.serializeSaveSlice();
    },
    deserialize(slice: SaveSlice<CasterStatsSlice> | null): void {
      const manager = deps.getCasterManager();
      if (!manager) return;
      manager.deserializeSaveSlice(slice);
    }
  };
}
