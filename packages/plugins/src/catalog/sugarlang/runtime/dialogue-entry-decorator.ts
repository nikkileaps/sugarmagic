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
import { termKey } from "./grading/highlight-terms";
import { getSugarlangTargetLanguage } from "./target-language-save-participant";

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
  /**
   * term -> what the player gets credit for touching it.
   *
   * A term is a SURFACE now (`hablo`), and a card is keyed by the thing it
   * teaches (`hablar`, or `exponent:<id>` for a phrase). Without this the surface
   * itself would be written as the card key, which nothing can read back --
   * observe rejects it and the hover is dropped.
   */
  let currentCreditByTerm: Record<string, string> = {};
  /**
   * The language a turn told us it was in, when one did.
   *
   * Null until an NPC turn carries a constraint, which is why the reader below
   * falls back to the game's language rather than this holding a guess. It
   * used to start at the literal "es": until the player's first annotated
   * turn, hovering a word and asking for a translation resolved against the
   * Spanish word list -- wrong for an Italian game whether the language was
   * picked or authored.
   */
  let constraintTargetLanguage: string | null = null;

  /** What language to read a word in: what the turn said, else this game's. */
  const targetLanguage = (): string =>
    constraintTargetLanguage ?? getSugarlangTargetLanguage() ?? "";

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
      currentCreditByTerm = highlight.creditByTerm ?? {};
    }

    // Track target language from NPC turn constraint annotations
    const constraint = turn.annotations?.["sugarlang.constraint"];
    if (
      typeof constraint === "object" &&
      constraint !== null &&
      typeof (constraint as Record<string, unknown>).targetLanguage === "string"
    ) {
      constraintTargetLanguage = (constraint as Record<string, unknown>)
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
          glosses: currentGlosses,
          // Carried, not rebuilt. This annotation is written fresh on the
          // PLAYER's turn, so a field left out here is gone for the one turn
          // celebrate runs on.
          creditByTerm: currentCreditByTerm
        };
      }
    }

    return turn;
  }

  function onTermHover(event: TermHoverEvent): void {
    // REPORT WHAT THE TERM TEACHES, not the term. The player hovered `hablo`;
    // the card belongs to `hablar`. Falling back to the term itself keeps the
    // old behaviour for anything with no credit recorded -- observe still
    // refuses it if the dictionary does not know it.
    const term = event.term;
    // One normalization, shared with the side that writes the map. Doing it
    // here with a local `toLowerCase` is what let the two drift: the writer
    // kept the line's casing, so `Hola` at the start of a sentence never
    // resolved and fell through to the raw term -- which, for a single-word
    // exponent, is a real dictionary word, so the hover silently graded the
    // WORD `hola` instead of the greeting it was teaching.
    const credit = currentCreditByTerm[termKey(term)] ?? term;
    pendingHover = {
      lemmaId: credit,
      lang: event.lang || targetLanguage(),
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
      targetLanguage: targetLanguage(),
      supportLanguage: "en",
      atlas: lookupAtlas,
      morphology: lookupMorphology
    });
    return result ? { surface: result.surface, gloss: result.gloss } : null;
  }

  return { decorate, onTermHover, lookupSelection: lookupSelectionForPanel };
}
