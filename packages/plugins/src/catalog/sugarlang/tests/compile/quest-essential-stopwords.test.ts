/**
 * packages/plugins/src/catalog/sugarlang/tests/compile/quest-essential-stopwords.test.ts
 *
 * Purpose: Pins that the dictionary's own part-of-speech tags are enough to
 *   keep function words out of quest-essential vocabulary -- which is why
 *   `compile-sugarlang-scene.ts` no longer carries a hand-written stopword
 *   list per language.
 *
 * WHAT WAS DELETED AND WHY
 *   `QUEST_ESSENTIAL_STOPWORDS` held a word list for `en`, `es` and `it` in
 *   shared compile code, so adding a language meant editing that file. Every
 *   reachable entry was already excluded by the part-of-speech check sitting
 *   directly beneath it: the caller passes `atlasEntry.lemmaId` for an entry
 *   it has already resolved, so only real dictionary lemmas ever arrive.
 *
 *   The three entries NOT covered by part of speech -- `las`, `al`, `nel` --
 *   are not dictionary lemmas at all and so could never be passed. The `en`
 *   list was unreachable for a different reason: the language argument is
 *   `scene.targetLanguage`, which is only ever a target language.
 *
 *   This test is the guard on that reasoning. If a word below stops being
 *   tagged functional in its dictionary, it starts being taught as quest
 *   vocabulary, and this fails rather than the change going unnoticed.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import esCefrlex from "../../data/languages/es/cefrlex.json";
import itCefrlex from "../../data/languages/it/cefrlex.json";
import { FUNCTIONAL_PARTS_OF_SPEECH } from "../../runtime/compile/compile-sugarlang-scene";

// Imported, not copied. This guard exists to prove the parts of speech are
// sufficient on their own; a second copy of them here could drift from the
// real one and the guard would go on passing against a list nothing uses.
const FUNCTIONAL = FUNCTIONAL_PARTS_OF_SPEECH;

type Lemmas = Record<string, { partsOfSpeech: string[] }>;
const LEMMAS: Record<string, Lemmas> = {
  es: (esCefrlex as { lemmas: Lemmas }).lemmas,
  it: (itCefrlex as { lemmas: Lemmas }).lemmas
};

/** Verbatim from the deleted table, minus the entries that are not lemmas. */
const FORMERLY_LISTED: Record<string, string[]> = {
  es: [
    "el", "la", "los", "un", "una", "y", "o", "de", "del", "a", "al", "en",
    "con", "por", "para", "que"
  ],
  it: [
    "il", "lo", "la", "gli", "le", "un", "una", "e", "o", "di", "a", "con",
    "per", "che"
  ]
};

describe("function words stay out of quest vocabulary without a hand-written list", () => {
  for (const [lang, words] of Object.entries(FORMERLY_LISTED)) {
    it(`${lang}: every formerly-listed word is tagged functional in the dictionary`, () => {
      for (const lemmaId of words) {
        const entry = LEMMAS[lang]![lemmaId];
        expect(entry, `${lang}: ${lemmaId} is not in the dictionary`).toBeDefined();
        const pos = entry!.partsOfSpeech.map((part) => part.toLowerCase());
        expect(
          pos.some((part) => FUNCTIONAL.has(part)),
          `${lang}: ${lemmaId} is ${pos.join("/")}, none of them functional`
        ).toBe(true);
      }
    });
  }

  it("the entries that were NOT covered are not dictionary lemmas at all", () => {
    // So they could never reach the check, whatever their part of speech
    // would have been. This is the other half of why deleting was safe.
    expect(LEMMAS.es!["las"]).toBeUndefined();
    expect(LEMMAS.it!["al"]).toBeUndefined();
    expect(LEMMAS.it!["nel"]).toBeUndefined();
  });
});
