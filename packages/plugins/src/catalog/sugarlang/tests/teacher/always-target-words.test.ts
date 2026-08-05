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
  formatAlwaysTargetWords,
  loadAlwaysTargetWords
} from "../../runtime/teacher/always-target-words";
import { saysSubjectPronounExplicitly } from "../../runtime/teacher/band-envelope";
import cefrlex from "../../data/languages/es/cefrlex.json";
import type { CEFRBand } from "../../runtime/cefr";

const LEMMAS = (cefrlex as { lemmas: Record<string, { partsOfSpeech: string[] }> }).lemmas;

describe("words that are always in the target language", () => {
  it("THE ONE THAT MATTERS: the subject pronoun is there at every band", () => {
    // "I vender queso." The frame was English, so a conjugated verb had
    // nowhere grammatical to sit -- `vendo` already means "I sell", and
    // "I vendo queso" says the subject twice. Making the pronoun Spanish moves
    // the switch to the clause boundary, where "Yo vendo queso" is just a
    // Spanish sentence.
    for (const band of ["A1", "A2", "B1", "B2", "C1"] as const) {
      const lines = formatAlwaysTargetWords("es", band, "Spanish").join(" ");
      expect(lines, band).toContain("yo");
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
      expect(rendered, band).toBe(saysSubjectPronounExplicitly(band));
    }
  });

  it("contributes nothing for a language with no list", () => {
    // Must be zero characters, not a "(none)" line: these reach prompts that
    // are cached on their own text.
    expect(formatAlwaysTargetWords("it", "A1", "Italian")).toEqual([]);
    expect(loadAlwaysTargetWords("it").lemmaIds).toEqual([]);
  });

  it("every word is a real dictionary entry", () => {
    // The list names lemmas. One that does not resolve would be a word the
    // generator is told to always use and the atlas cannot gloss or highlight.
    for (const lemmaId of loadAlwaysTargetWords("es").lemmaIds) {
      expect(LEMMAS[lemmaId], lemmaId).toBeDefined();
    }
  });

  it("holds function words only, not things the Teacher should choose", () => {
    // A content word here would be taught to every learner forever, bypassing
    // the Teacher's judgement about whether this moment affords it.
    const allowed = new Set([
      "pronoun",
      "determiner",
      "adverb",
      "conjunction",
      "preposition",
      "noun"
    ]);
    for (const lemmaId of loadAlwaysTargetWords("es").lemmaIds) {
      const pos = LEMMAS[lemmaId].partsOfSpeech;
      expect(pos.some((p) => allowed.has(p)), `${lemmaId}: ${pos.join("/")}`).toBe(true);
    }
  });
});
