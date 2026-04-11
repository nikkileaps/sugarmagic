/**
 * packages/plugins/src/catalog/sugarlang/runtime/dialogue-entry-decorator.ts
 *
 * Purpose: Decorates dialogue entries with focus-term highlighting and player
 *          celebration annotations. Also handles hover tracking for the
 *          sugarlang observation pipeline.
 *
 * Exports:
 *   - createSugarlangDialogueContribution
 *
 * Relationships:
 *   - Registered as a dialogue.entryDecorator plugin contribution.
 *   - Reads the generic dialogueHighlight annotation written by the observe middleware.
 *   - Uses runtime-core's findTermMatches for word-boundary matching.
 *   - Hover events are buffered and consumed by the context middleware.
 *
 * Status: active
 */

import type { ConversationTurnEnvelope, TermHoverEvent } from "@sugarmagic/runtime-core";
import {
  findTermMatches,
  readDialogueHighlight
} from "@sugarmagic/runtime-core";
import { PLAYER_SPEAKER, PLAYER_VO_SPEAKER } from "@sugarmagic/domain";

export interface PendingHover {
  lemmaId: string;
  lang: string;
  dwellMs: number;
  hoveredAtMs: number;
}

let pendingHover: PendingHover | null = null;

/**
 * Called by the context middleware to drain the most recent hover.
 * Returns and clears the pending hover, or null if none.
 */
export function drainPendingHover(): PendingHover | null {
  const hover = pendingHover;
  pendingHover = null;
  return hover;
}

export function createSugarlangDialogueContribution(): {
  decorate: (turn: ConversationTurnEnvelope) => ConversationTurnEnvelope;
  onTermHover: (event: TermHoverEvent) => void;
} {
  let currentFocusTerms: string[] = [];
  let currentIntroduceTerms: string[] = [];
  let currentGlosses: Record<string, string> = {};
  let currentTargetLanguage = "es";

  function decorate(turn: ConversationTurnEnvelope): ConversationTurnEnvelope {
    const highlight = readDialogueHighlight(turn.annotations);
    if (highlight && highlight.focusTerms.length > 0) {
      currentFocusTerms = highlight.focusTerms;
      currentIntroduceTerms = highlight.introduceTerms;
      currentGlosses = highlight.glosses ?? {};
    }

    // Track target language from NPC turn constraint annotations
    const constraint = turn.annotations?.["sugarlang.constraint"];
    if (
      typeof constraint === "object" &&
      constraint !== null &&
      typeof (constraint as Record<string, unknown>).targetLanguage === "string"
    ) {
      currentTargetLanguage = (constraint as Record<string, unknown>)
        .targetLanguage as string;
    }

    const isPlayer =
      turn.speakerId === PLAYER_SPEAKER.speakerId ||
      turn.speakerId === PLAYER_VO_SPEAKER.speakerId;

    if (isPlayer && currentFocusTerms.length > 0) {
      const matches = findTermMatches(turn.text, currentFocusTerms, []);
      if (matches.length > 0) {
        const matchedTerms = matches.map((m) => m.term.toLowerCase());
        const introduceSet = new Set(
          currentIntroduceTerms.map((t) => t.toLowerCase())
        );
        // Only celebrate reinforce terms — producing an introduce word the
        // player just saw with a gloss isn't strong retention evidence.
        const celebrateTerms = matchedTerms.filter(
          (t) => !introduceSet.has(t)
        );
        if (!turn.annotations) turn.annotations = {};
        turn.annotations["dialogueHighlight"] = {
          focusTerms: matchedTerms,
          introduceTerms: matchedTerms.filter((t) => introduceSet.has(t)),
          celebrateTerms,
          glosses: currentGlosses
        };
      }
    }

    return turn;
  }

  function onTermHover(event: TermHoverEvent): void {
    pendingHover = {
      lemmaId: event.term,
      lang: event.lang || currentTargetLanguage,
      dwellMs: event.dwellMs,
      hoveredAtMs: Date.now()
    };
  }

  return { decorate, onTermHover };
}
