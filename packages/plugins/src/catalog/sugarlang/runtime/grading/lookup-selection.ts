/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/lookup-selection.ts
 *
 * Purpose: Resolve a span the PLAYER selected to an English gloss.
 *
 * THE GESTURE IS SELECTION, NOT HOVER (nikki, 2026-07-30)
 *   Drag across a word the way you would with a highlighter, get its meaning.
 *   Hover was rejected on purpose: at B2+ most of the line is target language,
 *   so hovering fires constantly on words the player is not asking about.
 *   Selection is deliberate -- it only happens when someone wants to know.
 *
 *   Taught words keep their hover gloss. This is the second, player-initiated
 *   way in, and it works on ANY target-language span rather than only the ones
 *   the Teacher chose. One rule -- "select target language to look it up" --
 *   beats carving out exceptions.
 *
 * ATLAS ONLY, DELIBERATELY
 *   Resolution is: normalize -> lemmatize (morphology already handles
 *   inflection) -> `atlas.getGloss`. Free, instant, offline. The hit rate
 *   should be high because the generator is fenced to A1+1 and told never to
 *   invent words, so ambient target language is overwhelmingly atlas vocabulary.
 *
 *   Everything past the atlas is docs/backlog/011: an MT call for single words
 *   (cheap per character, no per-call overhead) and an LLM call for phrases
 *   (whose meaning is not compositional), both cached. Not built here.
 *
 * A MISS RETURNS null, AND THE CALLER SHOWS NOTHING
 *   No "translation unavailable" card. Silence reads as "nothing here"; an error
 *   card reads as broken, and the difference matters when the miss is expected
 *   (English words, names, punctuation) rather than exceptional.
 *
 * MULTI-WORD SELECTIONS RESOLVE ONLY IF THEY REDUCE TO ONE WORD
 *   Sloppy drags -- trailing punctuation, surrounding whitespace, a swallowed
 *   space -- normalize down to a single token and resolve normally, which is the
 *   common case. A genuine phrase (`buenos dias`) does NOT resolve: the atlas
 *   glosses lemmas, the inventory carries no English for its chunks, and
 *   "good" + "day" is not what the phrase means. That is backlog 011's LLM
 *   tier. What must never happen is TWO cards for one selection -- a phrase is
 *   one thing the player pointed at, so it gets one answer or none.
 *
 * Exports:
 *   - SelectionLookup, lookupSelection
 *
 * Relationships:
 *   - Pure. Reads text + atlas + morphology; no I/O, no store, no clock.
 *
 * Implements: Plan 090 story 090.12
 *
 * Status: active
 */

import { tokenize } from "../classifier/tokenize";
import { lemmatize } from "../classifier/lemmatize";
import type { MorphologyLoader } from "../classifier/morphology-loader";
import type { LexicalAtlasProvider } from "../contracts/providers";

export interface SelectionLookup {
  /** The word as the player selected it, trimmed of punctuation and space. */
  surface: string;
  /** Atlas lemma it resolved to -- the citation form, which may differ. */
  lemmaId: string;
  /** Support-language meaning. */
  gloss: string;
}

export interface LookupSelectionArgs {
  /** Raw selected text, straight from the DOM selection. */
  selection: string;
  targetLanguage: string;
  supportLanguage: string;
  atlas: LexicalAtlasProvider;
  morphology: MorphologyLoader;
  /**
   * Authored proper nouns. A name is not a word the player failed to learn, and
   * offering a translation for one is worse than offering nothing.
   */
  properNouns?: string[];
}

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

/**
 * The English for a selected span, or null when there is nothing honest to say.
 *
 * Null covers every expected miss: support-language words, names, punctuation,
 * genuine phrases, and words outside the atlas. The caller shows no card for
 * all of them, because from the player's side they are the same event --
 * "there is nothing to look up here".
 */
export function lookupSelection(args: LookupSelectionArgs): SelectionLookup | null {
  const { selection, targetLanguage, supportLanguage, atlas, morphology } = args;
  if (!selection || !selection.trim()) {
    return null;
  }

  // Tokenizing rather than trimming by hand: it already knows what a word is in
  // this language, including which marks belong to it. A selection is a word
  // selection when exactly one word token survives, however sloppy the drag.
  const words = tokenize(selection, targetLanguage).filter(
    (token) => token.kind === "word"
  );
  if (words.length !== 1) {
    return null;
  }

  const token = words[0]!;
  const surface = normalize(token.surface);

  if ((args.properNouns ?? []).some((noun) => normalize(noun) === surface)) {
    return null;
  }

  const lemmaRef = lemmatize(token, targetLanguage, morphology);
  if (!lemmaRef) {
    return null;
  }

  const gloss = atlas.getGloss(lemmaRef.lemmaId, targetLanguage, supportLanguage);
  if (!gloss) {
    return null;
  }

  return {
    surface: token.surface,
    lemmaId: lemmaRef.lemmaId,
    gloss
  };
}
