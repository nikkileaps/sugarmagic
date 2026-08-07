/**
 * scripts/data-prep/languages/language-rules.ts
 *
 * Purpose: What a language must supply for the shared data-prep pipeline to
 *   build its dictionary, morphology and placement bank.
 *
 * WHY THIS EXISTS
 *   Every rule here used to live in `sugarlang-language-data.ts` beside the
 *   shared pipeline, and one of them -- the function-word list -- lived inside
 *   the competency-inventory build. Both were written for Spanish and then
 *   applied to whatever language was passed. Italian inherited them and was
 *   wrong in both directions: its articles were counted as content words
 *   because they were not in the Spanish list, and `su` and `tu` were stripped
 *   because they were.
 *
 *   So the rule is: a language's rules live in that language's file, and shared
 *   code holds only what is true of every language. A new language is a new
 *   file plus a registry line; it does not edit anything here.
 *
 * WHAT COUNTS AS SHARED, FOR THE NEXT PERSON DECIDING
 *   Shared means true of every language, not true of the two we have. The
 *   dictionary's form SHAPES are shared -- verb/noun/adjective, checked against
 *   French before relying on it. `authoredSurfacesOf` is shared because it
 *   branches on that shape and never on the language. The three-pass ordering
 *   in `buildMorphologyData` is shared. Anything that names a word, an ending,
 *   an accent or a tense is not.
 *
 * Exports:
 *   - LanguageRules
 *
 * Status: active
 */

import type {
  AtlasLemmaEntry,
  MorphologyEntry,
  PlacementQuestionnaire
} from "../sugarlang-language-data";

export interface LanguageRules {
  readonly lang: string;

  /**
   * Lemma ids that carry no lexical content -- articles, clitic pronouns,
   * possessive determiners. An exponent does not count them among the words it
   * teaches, so leaving one in puts half the curriculum in envelope the moment
   * it is prescribed.
   *
   * LEMMA IDS, NOT SURFACES: the check runs after the token resolves. A surface
   * that never resolves cannot be excluded here, and listing it is inert.
   *
   * Prepositions do NOT belong here. They carry meaning a learner has to
   * acquire, and Italian `su` is the worked example -- it is in the Spanish
   * list as a possessive and is a preposition in Italian.
   */
  readonly functionWords: ReadonlySet<string>;

  /**
   * Expands a shortened written form into the word or words it stands for, or
   * returns null when the token is not one. Two spellings, one idea:
   *
   *   MARKED, with an apostrophe -- Italian `dov'e` is `dove` + `e`, `c'e` is
   *   `ci` + `e`; French `j'ai` is `je` + `ai`.
   *
   *   UNMARKED -- Italian also drops a final vowel before a vowel and writes
   *   nothing at all: `qual e`, not `qual'e`. `qual` stands for `quale`, and
   *   the same happens to `buon`, `gran`, `san`, `bel`.
   *
   * Both are one hook because a caller cannot tell them apart and should not
   * have to: it has a token that is not a word and wants the words it means.
   *
   * Spanish supplies neither, which is why the pipeline had no notion of this
   * at all and the build shredded `dov'e` into `dov` and `e` -- two fragments
   * no dictionary will ever hold.
   *
   * Return the FULL words, not stems. Whether the language marks the omission
   * is its business; the shared code only wants something it can look up.
   */
  expandWrittenForm?(token: string): string[] | null;

  /**
   * Second pass: every surface the dictionary already holds for this entry,
   * pointed at its lemma. A language with authored forms delegates to
   * `authoredSurfacesOf`; one that is still being authored may fall back to
   * guessing for entries that have none yet.
   */
  addMorphologyForms(
    forms: Record<string, MorphologyEntry>,
    entry: AtlasLemmaEntry
  ): void;

  /**
   * Third pass: forms the dictionary does not store but the language needs --
   * subjunctive, conditional, future, attached pronouns.
   *
   * Separate from the second pass because order decides ownership. A stored
   * form must outrank a derived one, and when both ran in a single pass the
   * winner was whichever lemma the loop reached first.
   */
  addDerivedForms?(
    forms: Record<string, MorphologyEntry>,
    entry: AtlasLemmaEntry
  ): void;

  /** The placement bank shipped for this language. */
  buildPlacementQuestionnaire(): PlacementQuestionnaire;
}
