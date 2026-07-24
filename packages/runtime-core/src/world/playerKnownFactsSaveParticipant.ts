import type { SaveSlice } from "@sugarmagic/domain";
import type { SaveParticipant } from "../save/participant";
import type { PlayerKnownFact, PlayerKnownFactsStore } from "./playerKnownFactsStore";

export const PLAYER_KNOWN_FACTS_PARTICIPANT_ID = "player.known-facts";
export const PLAYER_KNOWN_FACTS_SLICE_SCHEMA_VERSION = 1;

export interface PlayerKnownFactsSlice {
  facts: PlayerKnownFact[];
}

export interface PlayerKnownFactsParticipantDeps {
  getPlayerKnownFactsStore: () => PlayerKnownFactsStore | null;
}

function emptySlice(): PlayerKnownFactsSlice {
  return { facts: [] };
}

export function createPlayerKnownFactsSaveParticipant(
  deps: PlayerKnownFactsParticipantDeps
): SaveParticipant<PlayerKnownFactsSlice> {
  return {
    participantId: PLAYER_KNOWN_FACTS_PARTICIPANT_ID,
    tier: "default",
    schemaVersion: PLAYER_KNOWN_FACTS_SLICE_SCHEMA_VERSION,
    serialize(): PlayerKnownFactsSlice {
      const store = deps.getPlayerKnownFactsStore();
      if (!store) return emptySlice();
      return { facts: store.getFacts() };
    },
    deserialize(slice: SaveSlice<PlayerKnownFactsSlice> | null): void {
      const store = deps.getPlayerKnownFactsStore();
      if (!store) return;
      store.restore(slice?.data?.facts ?? []);
    }
  };
}
