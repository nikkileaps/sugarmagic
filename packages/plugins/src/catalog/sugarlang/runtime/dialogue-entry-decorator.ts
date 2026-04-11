/**
 * packages/plugins/src/catalog/sugarlang/runtime/dialogue-entry-decorator.ts
 *
 * Purpose: Decorates dialogue entries with focus-term highlighting and player celebration annotations.
 *
 * Exports:
 *   - createSugarlangEntryDecorator
 *
 * Relationships:
 *   - Registered as a dialogue.entryDecorator plugin contribution.
 *   - Reads the generic dialogueHighlight annotation written by the observe middleware.
 *   - Uses runtime-core's findTermMatches for word-boundary matching.
 *
 * Status: active
 */

import type { ConversationTurnEnvelope } from "@sugarmagic/runtime-core";
import {
  findTermMatches,
  readDialogueHighlight
} from "@sugarmagic/runtime-core";
import { PLAYER_SPEAKER, PLAYER_VO_SPEAKER } from "@sugarmagic/domain";

export function createSugarlangEntryDecorator(): (
  turn: ConversationTurnEnvelope
) => ConversationTurnEnvelope {
  let currentFocusTerms: string[] = [];

  return (turn) => {
    const highlight = readDialogueHighlight(turn.annotations);
    if (highlight && highlight.focusTerms.length > 0) {
      currentFocusTerms = highlight.focusTerms;
    }

    const isPlayer =
      turn.speakerId === PLAYER_SPEAKER.speakerId ||
      turn.speakerId === PLAYER_VO_SPEAKER.speakerId;

    if (isPlayer && currentFocusTerms.length > 0) {
      const matches = findTermMatches(turn.text, currentFocusTerms, []);
      if (matches.length > 0) {
        const matchedTerms = matches.map((m) => m.term.toLowerCase());
        if (!turn.annotations) turn.annotations = {};
        turn.annotations["dialogueHighlight"] = {
          focusTerms: matchedTerms,
          celebrateTerms: matchedTerms
        };
      }
    }

    return turn;
  };
}
