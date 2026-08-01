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
import { isPlayerSpeaker, resolveDialogueSpeaker } from "@sugarmagic/domain";
import { lookupSelection } from "./grading/lookup-selection";
import { CefrLexAtlasProvider } from "./providers/impls/cefr-lex-atlas-provider";
import { MorphologyLoader } from "./classifier/morphology-loader";

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
  lookupSelection: (
    selection: string
  ) => { surface: string; gloss: string } | null;
} {
  let currentFocusTerms: string[] = [];
  let currentIntroduceTerms: string[] = [];
  let currentGlosses: Record<string, string> = {};
  let currentTargetLanguage = "es";

  // 090.12: the lookup resolver owns its atlas and morphology rather than
  // taking them from the async service graph. Both are lazy and cache
  // internally, and the resolver must be SYNCHRONOUS -- it answers a mouseup,
  // and a card that arrives after the player has moved on is worse than none.
  const lookupAtlas = new CefrLexAtlasProvider();
  const lookupMorphology = new MorphologyLoader();

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

    const isPlayer = isPlayerSpeaker(
      resolveDialogueSpeaker(turn.speakerId, null)
    );

    if (isPlayer && currentFocusTerms.length > 0) {
      const matches = findTermMatches(turn.text, currentFocusTerms, []);
      if (matches.length > 0) {
        const matchedTerms = matches.map((m) => m.term.toLowerCase());
        const introduceSet = new Set(
          currentIntroduceTerms.map((t) => t.toLowerCase())
        );
        // Celebrate ALL player-produced focus terms. The star animation is the
        // core reward loop — withholding it from new learners (who only have
        // introduce words) kills engagement right when they need it most.
        const celebrateTerms = matchedTerms;
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

  /**
   * 090.12: what the player gets for selecting a span.
   *
   * Atlas-only by design (see grading/lookup-selection.ts). Returns null for
   * every expected miss -- support-language words, names, punctuation, genuine
   * phrases -- and the panel shows nothing rather than an error, because from
   * the player's side those are all the same event: nothing to look up here.
   */
  function lookupSelectionForPanel(
    selection: string
  ): { surface: string; gloss: string } | null {
    const result = lookupSelection({
      selection,
      targetLanguage: currentTargetLanguage,
      supportLanguage: "en",
      atlas: lookupAtlas,
      morphology: lookupMorphology
    });
    return result ? { surface: result.surface, gloss: result.gloss } : null;
  }

  return { decorate, onTermHover, lookupSelection: lookupSelectionForPanel };
}
