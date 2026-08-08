/**
 * packages/plugins/src/catalog/sugarlang/tests/teacher/always-target-words.test.ts
 *
 * Purpose: Pins the words that are spoken in the target language at every
 *   level, and the band rule for whether the subject pronoun is said or
 *   dropped.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  formatAlwaysTargetLines,
  formatAlwaysTargetWords,
  loadAlwaysTargetWords,
  type AlwaysTargetWords
} from "../../runtime/teacher/always-target-words";
import { forcesSubjectPronounAtBand } from "../../runtime/teacher/band-envelope";
import esCefrlex from "../../data/languages/es/cefrlex.json";
import frCefrlex from "../../data/languages/fr/cefrlex.json";
import itCefrlex from "../../data/languages/it/cefrlex.json";
import type { CEFRBand } from "../../runtime/cefr";

type Lemmas = Record<string, { partsOfSpeech: string[] }>;
const LEMMAS_BY_LANG: Record<string, Lemmas> = {
  es: (esCefrlex as { lemmas: Lemmas }).lemmas,
  it: (itCefrlex as { lemmas: Lemmas }).lemmas,
  fr: (frCefrlex as { lemmas: Lemmas }).lemmas
};

/** Every language that ships a list. Adding one extends the guards below
 *  without anyone having to remember to. */
const AUTHORED = ["es", "it", "fr"];

/** The ones that leave the subject out of an ordinary sentence, and the one
 *  that does not. French is not playable; it is here because it is the only
 *  shipped list on the second side. */
const DROPS_SUBJECT = ["es", "it"];
const KEEPS_SUBJECT = ["fr"];

describe("words that are always in the target language", () => {
  it("THE ONE THAT MATTERS: the subject pronoun is there at every band", () => {
    // "I vender queso." The frame was English, so a conjugated verb had
    // nowhere grammatical to sit -- `vendo` already means "I sell", and
    // "I vendo queso" says the subject twice. Making the pronoun Spanish moves
    // the switch to the clause boundary, where "Yo vendo queso" is just a
    // Spanish sentence.
    for (const band of ["A1", "A2", "B1", "B2", "C1"] as const) {
      // Assert against the LIST line only. The line below it contains the
      // worked example `never "yo sell cheese"`, so searching the whole block
      // for "yo" passes even with an empty list -- which is what the first
      // version of this test did.
      const listLine = formatAlwaysTargetWords("es", band, "Spanish")[0];
      expect(listLine, band).toMatch(/never English: .*\byo\b/);
    }
  });

  it("THE ONE THAT MATTERS: the rule is scoped to the phrase, not the word", () => {
    // The first version said "always in Spanish, however English the rest of
    // the line is", and the generator obliged: `yo sell cheese`, `tu must be
    // tired`, `Tu like cheese?` and -- the one that proves it -- `yo am
    // obsessed`. Fifteen of those against four good ones in one conversation.
    // None is a sentence in either language.
    //
    // `Yo vendo queso` reads because it is a whole Spanish clause. The
    // difference is the phrase around the word, which is what this must say.
    const lines = formatAlwaysTargetWords("es", "A1", "Spanish").join(" ");

    expect(lines).toContain("Inside a Spanish phrase");
    expect(lines).toMatch(/never "yo sell cheese"/);
    // The unscoped wording must not come back.
    expect(lines).not.toContain("however English the rest of the line is");
  });

  it("does not tell it to put a pronoun in front of every verb", () => {
    // The subject-pronoun line needs the same scoping. Unscoped it read as
    // "every verb gets a pronoun", and at anchored posture most of the verbs
    // in a line are English ones -- which is where `yo make cheese` came from.
    const lines = formatAlwaysTargetWords("es", "A1", "Spanish").join(" ");
    expect(lines).toContain("When you do write a Spanish phrase");
  });

  it("says the subject out loud for beginners and stops after A2", () => {
    // Spanish drops it -- `Vendo queso` is the natural sentence. Forcing it
    // early is the trade: a beginner cannot yet hear the person inside the
    // verb ending, so without the pronoun the line reads as "sell cheese"
    // with nobody in it.
    const saidAt = (band: CEFRBand) =>
      formatAlwaysTargetWords("es", band, "Spanish").some((line) =>
        line.includes("subject pronoun out loud")
      );

    expect(saidAt("A1")).toBe(true);
    expect(saidAt("A2")).toBe(true);
    expect(saidAt("B1")).toBe(false);
    expect(saidAt("C1")).toBe(false);
  });

  it("the band rule and the rendered lines cannot disagree", () => {
    // Two answers to "does this band say the pronoun" is exactly the drift
    // band-envelope exists to prevent, so the renderer must ask rather than
    // re-decide.
    for (const band of ["A1", "A2", "B1", "B2", "C1", "C2"] as const) {
      const rendered = formatAlwaysTargetWords("es", band, "Spanish").some((line) =>
        line.includes("subject pronoun out loud")
      );
      expect(rendered, band).toBe(forcesSubjectPronounAtBand(band));
    }
  });

  it("contributes nothing for a language with no list", () => {
    // Must be zero characters, not a "(none)" line: these reach prompts that
    // are cached on their own text.
    //
    // Repointed from "it", which now HAS a list. The replacement has to be a
    // code the game cannot be set to -- VALID_TARGET_LANGUAGES is exactly
    // {es, it} -- so this asserts the shape of the fallback rather than any
    // real language's behaviour. German is the example because it is also the
    // case the pronoun rule below exists to get right.
    expect(formatAlwaysTargetWords("de", "A1", "German")).toEqual([]);
    expect(loadAlwaysTargetWords("de").lemmaIds).toEqual([]);
  });

  it("every word is a real dictionary entry, in ITS OWN language", () => {
    // The list names lemmas. One that does not resolve would be a word the
    // generator is told to always use and the atlas cannot gloss or highlight.
    //
    // Per language, because checking Italian against the Spanish dictionary
    // would pass for the wrong reason on any shared spelling -- `no` and `mi`
    // are in both.
    for (const lang of AUTHORED) {
      const lemmas = LEMMAS_BY_LANG[lang]!;
      for (const lemmaId of loadAlwaysTargetWords(lang).lemmaIds) {
        expect(lemmas[lemmaId], `${lang}: ${lemmaId}`).toBeDefined();
      }
    }
  });

  it("holds function words only, not things the Teacher should choose", () => {
    // A content word here would be taught to every learner forever, bypassing
    // the Teacher's judgement about whether this moment affords it.
    // NOUN IS NOT ALLOWED, and that is the point. `queso` is a noun, and a
    // noun on this list is a content word taught to every learner forever.
    // An earlier version of this guard allowed "noun" and therefore guarded
    // nothing.
    //
    // A word may carry several parts of speech and only needs one allowed:
    // Spanish `no` is adverb/noun/verb and Italian `no` is adverb/noun.
    const allowed = new Set([
      "pronoun",
      "determiner",
      "adverb",
      "conjunction",
      "preposition"
    ]);
    for (const lang of AUTHORED) {
      const lemmas = LEMMAS_BY_LANG[lang]!;
      for (const lemmaId of loadAlwaysTargetWords(lang).lemmaIds) {
        const pos = lemmas[lemmaId]!.partsOfSpeech;
        expect(
          pos.some((p) => allowed.has(p)),
          `${lang}: ${lemmaId}: ${pos.join("/")}`
        ).toBe(true);
      }
    }
  });

  it("a language that drops its subject gets the pronoun line", () => {
    // The decision 091.8 settled: the instruction needs the BAND to be early
    // AND the language to actually drop the subject.
    for (const lang of DROPS_SUBJECT) {
      const lines = formatAlwaysTargetWords(lang, "A1", "The Language");
      expect(
        lines.some((line) => /say its subject pronoun out loud/.test(line)),
        lang
      ).toBe(true);
    }
  });

  it("THE ONE THAT MATTERS: a language that KEEPS its subject gets no pronoun line", () => {
    // The half of the gate that was wrong before 091.8. Handed in directly
    // rather than through the registry, because a hand-made list is the only
    // way to check the shape without a shipped file -- which is what this was
    // before French existed, and is kept as the unit-level guard.
    const keepsSubject: AlwaysTargetWords = {
      lang: "de",
      lemmaIds: ["ich", "du"],
      dropsSubjectPronouns: false
    };
    const lines = formatAlwaysTargetLines(keepsSubject, "A1", "German");

    // It still gets the list lines -- the words are still always German.
    expect(lines.length).toBeGreaterThan(0);
    // But not the instruction to say a pronoun its speakers never drop.
    expect(lines.some((line) => /say its subject pronoun out loud/.test(line))).toBe(
      false
    );
  });

  it("THE SAME THING FROM A SHIPPED FILE: French keeps its subject", () => {
    // The test above proves the function reads the flag. This proves a real
    // language's file can carry `false` and travel the whole path -- load,
    // gate, render -- without anyone re-deciding it on the way. That was the
    // gap 091.8 left open, because both languages it could reach said `true`.
    for (const lang of KEEPS_SUBJECT) {
      const lines = formatAlwaysTargetWords(lang, "A1", "The Language");
      expect(lines.length, lang).toBeGreaterThan(0);
      expect(
        lines.some((line) => /say its subject pronoun out loud/.test(line)),
        lang
      ).toBe(false);
    }
  });

  it("the flag is declared, not defaulted", () => {
    // The gate is `=== true`, so a list that forgets the flag silently loses
    // the instruction. Every shipped list must say so out loud -- and the
    // reason this is asserted rather than defaulted is that the safe default
    // differs by language, and guessing it is what 091.8 removed.
    for (const lang of AUTHORED) {
      expect(
        typeof loadAlwaysTargetWords(lang).dropsSubjectPronouns,
        lang
      ).toBe("boolean");
    }
    for (const lang of DROPS_SUBJECT) {
      expect(loadAlwaysTargetWords(lang).dropsSubjectPronouns, lang).toBe(true);
    }
    for (const lang of KEEPS_SUBJECT) {
      expect(loadAlwaysTargetWords(lang).dropsSubjectPronouns, lang).toBe(false);
    }
  });

  it("the band still gates it: no pronoun line at B1 and above", () => {
    for (const band of ["B1", "B2", "C1"] as const) {
      const lines = formatAlwaysTargetWords("it", band, "Italian");
      expect(
        lines.some((line) => /say its subject pronoun out loud/.test(line)),
        band
      ).toBe(false);
    }
  });

});
