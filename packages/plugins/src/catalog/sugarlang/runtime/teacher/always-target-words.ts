/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/always-target-words.ts
 *
 * Purpose: The words spoken in the target language at every level, however much
 *   of the line is in English.
 *
 * WHY THESE EXIST
 *   At anchored posture the sentence skeleton is English and target-language
 *   words are dropped into it. A noun drops in cleanly -- "I sell queso" still
 *   reads. A conjugated verb cannot: `vendo` already means "I sell", so
 *   "I vendo queso" says the subject twice, and a generator handed an English
 *   frame will back off to the dictionary form rather than write that.
 *
 *   Making the pronoun target-language moves the switch to the clause boundary,
 *   where it belongs: "Yo vendo queso" is a whole Spanish clause, and the verb
 *   finally has a subject to agree with.
 *
 * NOT TEACHABLES, AND DELIBERATELY NOT ON THE SLATE
 *   A slated word is a decision the Teacher makes for this turn and competes
 *   for a capped number of introduce slots. These are neither: they are always
 *   on, so routing them through the slate would let a pronoun consume a slot
 *   and then be cut by the cap. They reach the generator as a standing line,
 *   the same way posture and ratio do.
 *
 * SCOPED TO THE PHRASE, NOT THE WORD
 *   The first version of this said "always in Spanish, however English the rest
 *   of the line is", and the generator did exactly that: `yo sell cheese`,
 *   `tu must be tired`, `Tu like cheese?` -- and, worst, `yo am obsessed`.
 *   Fifteen of those against four good ones in a single conversation. None of
 *   them is Spanish or English, and a learner reading `yo am` learns something
 *   false about how the word works.
 *
 *   The rule is about the phrase these words sit in. `Yo vendo queso` is a
 *   Spanish clause and reads. `yo sell cheese` is an English clause with one
 *   word swapped, which is not a sentence in either language.
 *
 *   It also pushes the generator toward whole target-language phrases rather
 *   than single-word sprinkles, which is what made the verb conjugate in the
 *   first place: a verb needs a clause to agree with.
 *
 * WHAT BELONGS HERE
 *   Short, extremely frequent function words a learner meets constantly and
 *   needs no help decoding: subject pronouns, possessives, yes and no. Content
 *   words do not: `queso` is something to TEACH, and teaching it is the
 *   Teacher's call about this moment.
 *
 *   Single dictionary entries only. A fixed expression like `gracias` is an
 *   exponent of a competency rather than a lemma, and the competency path
 *   already handles it.
 *
 * Exports:
 *   - AlwaysTargetWords
 *   - loadAlwaysTargetWords
 *   - formatAlwaysTargetWords
 *
 * Relationships:
 *   - Data is hand-authored per language in data/languages/<lang>/always-target.json.
 *   - Rendered into both realization paths: the agent overlay and the variant
 *     bake, so a line does not depend on when it was written.
 *
 * Status: active
 */

import esAlwaysTarget from "../../data/languages/es/always-target.json";
import type { CEFRBand } from "../cefr";
import { saysSubjectPronounExplicitly } from "./band-envelope";

export interface AlwaysTargetWords {
  lang: string;
  lemmaIds: string[];
}

const DATA_BY_LANG: Partial<Record<string, AlwaysTargetWords>> = {
  es: esAlwaysTarget as AlwaysTargetWords
};

/**
 * The list for a language, or an empty one.
 *
 * Absent is a normal state -- a language may have no list authored yet -- and
 * it degrades to "nothing is forced", which is the behaviour that existed
 * before this file.
 */
export function loadAlwaysTargetWords(lang: string): AlwaysTargetWords {
  return DATA_BY_LANG[lang] ?? { lang, lemmaIds: [] };
}

/**
 * The standing prompt lines, or none when the language has no list.
 *
 * Returns an empty array rather than a "(none)" line: this is added to prompts
 * that are cached on their own text, so a language without a list must produce
 * byte-identical output to before.
 */
export function formatAlwaysTargetWords(
  lang: string,
  band: CEFRBand,
  targetLanguageName: string
): string[] {
  const words = loadAlwaysTargetWords(lang).lemmaIds;
  if (words.length === 0) {
    return [];
  }

  const lines = [
    `Inside a ${targetLanguageName} phrase, these are always ${targetLanguageName}, never English: ${words.join(", ")}.`,
    `Do NOT drop one into an otherwise English sentence -- write "I sell cheese", never "yo sell cheese". If you want one of these words, write the whole phrase around it in ${targetLanguageName}.`
  ];

  if (saysSubjectPronounExplicitly(band)) {
    // Also scoped to the phrase. Unscoped, this is the line that produced
    // "yo make cheese" -- it read as "put a pronoun in front of every verb",
    // and most of the verbs in an anchored line are English ones.
    lines.push(
      `When you do write a ${targetLanguageName} phrase, say its subject pronoun out loud rather than dropping it, even where a native speaker would leave it out, so the learner can see who is doing the action.`
    );
  }

  return lines;
}
