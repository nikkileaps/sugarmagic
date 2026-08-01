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
import type { LexicalAtlasProvider } from "../types";
import type { TeachableRef } from "../contracts/teachable-ref";
import { competencyRefs, vocabularyRefs } from "../contracts/teachable-ref";
import { tokenize } from "../classifier/tokenize";
import { getCompetencyForChunk } from "../inventory/competency-inventory-loader";

export interface HighlightTerms {
  /** NEW this turn. Drives gold vs blue. */
  introduceTerms: string[];
  /** Already met, being re-exposed. */
  reinforceTerms: string[];
  /** term -> gloss, for the hover tooltip. */
  glosses: Record<string, string>;
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
  chunkMatcher?: ChunkMatcher | null;
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

  // Vocabulary is a WORD, and its surface is the lemma with underscores opened
  // out -- a multi-word lemma like `buenos_dias` is one term, not two.
  for (const lemma of vocabularyRefs(introduce)) {
    const surface = lemma.lemmaId.replace(/_/g, " ");
    introduceTerms.push(surface);
    const gloss = atlas.getGloss(lemma.lemmaId, targetLanguage, supportLanguage);
    if (gloss) glosses[surface] = gloss;
  }
  for (const lemma of vocabularyRefs(reinforce)) {
    const surface = lemma.lemmaId.replace(/_/g, " ");
    reinforceTerms.push(surface);
    const gloss = atlas.getGloss(lemma.lemmaId, targetLanguage, supportLanguage);
    if (gloss) glosses[surface] = gloss;
  }

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
        const competency = getCompetencyForChunk(
          chunkMatch.chunk.chunkId,
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

        target.push(surface);
        // The can-do descriptor, because what is being taught is the ACT. "Can
        // greet people in a simple way" is the useful hover for `buenos dias`;
        // a word gloss would not be.
        if (!glosses[surface]) glosses[surface] = competency.cefrDescriptor;
      }
    } catch {
      // Phrase detection is an affordance. A failure must not cost the line its
      // vocabulary terms, which are already built above.
    }
  }

  return { introduceTerms, reinforceTerms, glosses };
}
