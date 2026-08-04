/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/highlight-terms.ts
 *
 * Purpose: Given a slate and the text that realized it, which TERMS should the
 *   presentation layer light up, and what does each mean?
 *
 * ONE BUILDER, TWO MOMENTS -- which is the whole reason this is its own module.
 *   Agent turns compute this at runtime in the observe middleware. Scripted
 *   turns compute it at BUILD time and carry the result on the baked variant.
 *   Same question, same answer, so it must not be two implementations: the
 *   ratio tables and the variant content hash both drifted exactly this way,
 *   and this one would drift into "the same word highlights differently
 *   depending on whether the line was baked", which nobody would think to test.
 *
 * WHY BUILD TIME IS EVEN POSSIBLE
 *   Markup reaches the player as a TURN ANNOTATION -- `dialogueHighlight` ->
 *   `readDialogueHighlight` -> `findTermMatches(turn.text, ...)`. The
 *   presentation layer needs the text plus a list of terms; nothing requires the
 *   terms to be COMPUTED at render time, only to be ON the turn by then. So a
 *   variant can carry them and the scripted middleware can attach them.
 *
 * WHAT IS NOT HERE: `celebrateTerms`. That is set by the dialogue entry
 *   decorator on PLAYER turns when the player types a taught word, so it depends
 *   on what they typed and cannot be precomputed. Separate path, deliberately
 *   untouched.
 *
 * MATCHING IS NOT DONE HERE EITHER. This returns terms; `findTermMatches`
 *   decides where they occur, with its inflection tolerance and its
 *   longest-first occupancy map. A term that is not in the text simply does not
 *   match -- exactly as on the agent path. Adding a second matcher here would
 *   mean two answers to "is this word in this line".
 *
 * Exports:
 *   - HighlightTerms, buildHighlightTerms
 *
 * Implements: Plan 090 story rf6.5.2
 *
 * Status: active
 */

import type { ChunkMatcher } from "../classifier/chunk-matcher";
import type { Exponent } from "../contracts/competency-inventory";
import type { LexicalAtlasProvider } from "../types";
import type { TeachableRef } from "../contracts/teachable-ref";
import { competencyRefs, vocabularyRefs } from "../contracts/teachable-ref";
import { tokenize } from "../classifier/tokenize";
import { getCompetencyForExponent } from "../inventory/competency-inventory-loader";
import { allForms } from "../classifier/word-forms";

export interface HighlightTerms {
  /** NEW this turn. Drives gold vs blue. */
  introduceTerms: string[];
  /** Already met, being re-exposed. */
  reinforceTerms: string[];
  /** term -> gloss, for the hover tooltip. */
  glosses: Record<string, string>;
  /**
   * term -> what the player gets CREDIT for when they interact with it.
   *
   * A term is a surface now (`hablo`), not a citation form (`hablar`), and
   * several terms map to one teachable. Anything that identifies WHAT WAS
   * TAUGHT rather than where it is on screen needs this -- a hover writes a
   * persisted card, and cards live in two key spaces: an atlas lemma, or a
   * competency's chunk (`exponent:<id>`). Without it the surface itself becomes
   * the key, which nothing can read back.
   *
   * Deliberately NOT called `lemmaByTerm`: a `exponent:` id is not a lemma, and
   * `contracts/teachable-ref.ts` calls that prefix a lie told to a type. This
   * is the card key, and the name says so.
   */
  creditByTerm: Record<string, string>;
}

/**
 * The key `creditByTerm` and `glosses` are looked up by.
 *
 * Both maps are read with the hovered text, and a hover arrives lowercased. So
 * both must be WRITTEN lowercased, or a term appearing with the line's own
 * casing is never found. That is not a rare case: `Hola, senor.` puts the
 * commonest greeting in the language at the start of a sentence.
 *
 * Exported so the reader normalizes with this function rather than its own
 * `toLowerCase`. Two sides deciding independently is what broke it, and a
 * shared function is what stops it happening again the next time normalization
 * needs to handle something else -- accents, say, or a trailing punctuation
 * mark the matcher keeps.
 */
export function termKey(term: string): string {
  return term.toLowerCase();
}

/**
 * What `findTermMatches` scans for: the union, in introduce-then-reinforce
 * order.
 *
 * Kept as a function rather than a field on `HighlightTerms` because callers
 * may append to `introduceTerms` first -- the 085.5 first-teach beat does -- and
 * a precomputed union would silently go stale at exactly that moment.
 */
export function focusTermsOf(terms: HighlightTerms): string[] {
  return [...terms.introduceTerms, ...terms.reinforceTerms];
}

/**
 * Builds the highlight terms for one realized line.
 *
 * `chunkMatcher` is optional: without it, competencies on the slate contribute
 * nothing rather than contributing a guess. A competency has several exponents
 * and the line used at most one, so listing them from the inventory would name
 * phrases that are not on screen.
 */
export function buildHighlightTerms(args: {
  text: string;
  introduce: readonly TeachableRef[];
  reinforce: readonly TeachableRef[];
  atlas: LexicalAtlasProvider;
  targetLanguage: string;
  supportLanguage: string;
  chunkMatcher?: ChunkMatcher<Exponent> | null;
}): HighlightTerms {
  const {
    text,
    introduce,
    reinforce,
    atlas,
    targetLanguage,
    supportLanguage,
    chunkMatcher
  } = args;

  const introduceTerms: string[] = [];
  const reinforceTerms: string[] = [];
  const glosses: Record<string, string> = {};
  const creditByTerm: Record<string, string> = {};

  /**
   * EVERY FORM OF THE WORD, not just its citation form.
   *
   * The Teacher slates a LEMMA and realization writes whatever form the
   * sentence needs, so `hablar` on the slate reaches the page as `hablo`.
   * Listing only the lemma meant a slated verb never lit up.
   *
   * All the forms go in, and `findTermMatches` lights up whichever one is
   * actually present -- so this file still does no matching, and there is still
   * one answer to "is this word in this line". A form that is not in the text
   * simply does not match, exactly as before.
   *
   * A word with no stored paradigm contributes its citation form, which is
   * today's behaviour and the right fallback: 584 higher-band verbs and every
   * closed-class word have none.
   */
  const addVocabulary = (
    lemma: { lemmaId: string },
    target: string[]
  ): void => {
    const gloss = atlas.getGloss(lemma.lemmaId, targetLanguage, supportLanguage);
    // A multi-word lemma like `buenos_dias` is ONE term, not two.
    const citation = lemma.lemmaId.replace(/_/g, " ");
    // The citation form is ALWAYS a valid surface and is never a paradigm slot
    // -- a verb's infinitive is the lemma itself, and `voy a hablar` puts it on
    // the page verbatim. Include it alongside whatever the paradigm holds.
    const terms = [
      citation,
      ...allForms(atlas.getForms(lemma.lemmaId, targetLanguage))
    ];
    for (const term of terms) {
      if (!target.includes(term)) target.push(term);
      const key = termKey(term);
      if (gloss && !glosses[key]) glosses[key] = gloss;
      creditByTerm[key] = lemma.lemmaId;
    }
  };

  for (const lemma of vocabularyRefs(introduce)) addVocabulary(lemma, introduceTerms);
  for (const lemma of vocabularyRefs(reinforce)) addVocabulary(lemma, reinforceTerms);

  // SPANS, NOT WORDS. A competency is an ACT and its exponent is a PHRASE, so
  // `buenos dias` has to be ONE term with one hover -- two lit words read as two
  // unrelated items and offer two tooltips for one idea.
  //
  // MATCHED AGAINST THE TEXT, not listed from the inventory, so only the
  // exponent actually used is named. The matcher's longest-match trie settles
  // overlaps between exponents; `findTermMatches` downstream sorts by length so
  // the phrase claims its characters before any word inside it can.
  const introduceCompetencyIds = new Set(
    competencyRefs(introduce).map((ref) => ref.competencyId)
  );
  const reinforceCompetencyIds = new Set(
    competencyRefs(reinforce).map((ref) => ref.competencyId)
  );

  if (
    chunkMatcher &&
    (introduceCompetencyIds.size > 0 || reinforceCompetencyIds.size > 0)
  ) {
    try {
      const tokens = tokenize(text, targetLanguage);
      for (const chunkMatch of chunkMatcher.match(tokens, text)) {
        const competency = getCompetencyForExponent(
          chunkMatch.item.exponentId,
          targetLanguage
        );
        if (!competency) continue;

        const target = introduceCompetencyIds.has(competency.competencyId)
          ? introduceTerms
          : reinforceCompetencyIds.has(competency.competencyId)
            ? reinforceTerms
            : null;
        // A chunk the Teacher did not ask for is not a focus term. It may still
        // be ambient, which is the right home for target language nobody asked
        // to teach.
        if (!target) continue;

        const surface = chunkMatch.surfaceMatched.trim();
        if (surface.length === 0 || target.includes(surface)) continue;

        // The TERM keeps the line's own casing, because it is displayed and
        // because span matching is case-insensitive anyway.
        target.push(surface);
        // The KEYS do not. A hover arrives lowercased, so a key carrying the
        // line's casing is never found -- and `Hola` at the start of a sentence
        // is the common case, not an edge one. The word branch above is keyed
        // by lemma, which is lowercase by construction, so this side was the
        // only one that disagreed.
        const key = termKey(surface);
        // What the phrase MEANS. A hover answers the player's question, which
        // is "what did they just say" -- not which competency it belongs to.
        // Keyed by the surface that matched, so `qué significa` reads "what
        // does it mean" even though it shares an exponent with `qué es`.
        const gloss =
          chunkMatch.item.glossBySurface[surface.toLowerCase()]?.[
            supportLanguage
          ];
        if (gloss && !glosses[key]) glosses[key] = gloss;
        // The ACT is what was taught, so the credit goes to the competency's
        // chunk rather than to any word inside the phrase. This is the key the
        // card store already uses.
        creditByTerm[key] = `exponent:${chunkMatch.item.exponentId}`;
      }
    } catch {
      // Phrase detection is an affordance. A failure must not cost the line its
      // vocabulary terms, which are already built above.
    }
  }

  return { introduceTerms, reinforceTerms, glosses, creditByTerm };
}
