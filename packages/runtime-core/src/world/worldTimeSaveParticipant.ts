import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { TimeOfDayBand, WorldTimeStore } from "./time-store";

export const WORLD_TIME_PARTICIPANT_ID = "world.time";
export const WORLD_TIME_SLICE_SCHEMA_VERSION = 1;

export interface WorldTimeSlice {
  day: number;
  band: TimeOfDayBand;
}

export interface WorldTimeParticipantDeps {
  getWorldTimeStore: () => WorldTimeStore | null;
}

function emptySlice(): WorldTimeSlice {
  return { day: 1, band: "morning" };
}

export function createWorldTimeSaveParticipant(
  deps: WorldTimeParticipantDeps
): SaveParticipant<WorldTimeSlice> {
  return {
    participantId: WORLD_TIME_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: WORLD_TIME_SLICE_SCHEMA_VERSION,
    serialize(): WorldTimeSlice {
      const store = deps.getWorldTimeStore();
      if (!store) return emptySlice();
      return store.getState();
    },
    deserialize(slice: SaveSlice<WorldTimeSlice> | null): void {
      const store = deps.getWorldTimeStore();
      if (!store) return;
      store.restore(slice?.data ?? emptySlice());
    }
  };
}
