/**
 * scripts/data-prep/spanish-derivation.test.ts
 *
 * Purpose: Pins the Spanish forms the dictionary does not store but the
 *   morphology index derives -- and in particular the two respellings that
 *   were wrong and wrote non-words into the index.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";
import type { MorphologyFile } from "./competency-inventory";

const index = readJsonFile<MorphologyFile>(
  sugarlangDataPath("languages", "es", "morphology.json")
).forms;

const lemmaOf = (surface: string) => index[surface]?.lemmaId ?? null;

describe("derived Spanish forms are real words", () => {
  it("THE ONE THAT WAS WRONG: -car/-gar/-zar respell before an -e ending", () => {
    // Spanish keeps the consonant SOUND across the vowel change and respells
    // to do it. Taking the `yo` stem and appending -e gives `busce`, which is
    // not a word -- and the real form `busque` was missing entirely, including
    // as the polite imperative, which is ordinary language.
    for (const [surface, lemma] of [
      ["busque", "buscar"],
      ["llegue", "llegar"],
      ["pague", "pagar"],
      ["saque", "sacar"],
      ["empiece", "empezar"],
      ["juegue", "jugar"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }

    // ...and the non-words they replaced are not in the index.
    for (const nonWord of ["busce", "llege", "sace", "empieze", "juege"]) {
      expect(lemmaOf(nonWord), nonWord).toBeNull();
    }
  });

  it("THE OTHER ONE: the 1st-person-plural imperfect subjunctive is accented", () => {
    // `tuvieron` -> `tuviéramos`, not `tuvieramos`. It is the only form in the
    // set that shifts the written accent.
    for (const [surface, lemma] of [
      ["tuviéramos", "tener"],
      ["fuéramos", "ser"],
      ["pudiéramos", "poder"],
      ["habláramos", "hablar"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("keeps the tenses the dictionary never stored", () => {
    // Present subjunctive (also the usted imperative), conditional, future and
    // imperfect subjunctive. None are in cefrlex; all are derivable.
    for (const [surface, lemma] of [
      ["disculpe", "disculpar"],
      ["oiga", "oír"],
      ["diga", "decir"],
      ["quisiera", "querer"],
      ["podría", "poder"],
      ["gustaría", "gustar"],
      ["tendrá", "tener"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("keeps the forms A2 authoring found missing", () => {
    for (const [surface, lemma] of [
      ["ayudarme", "ayudar"],   // infinitive + enclitic
      ["verte", "ver"],
      ["preocupada", "preocupar"], // participle agreement
      ["pasada", "pasar"],
      ["finalmente", "final"],  // -mente, gender-invariable adjective
      ["rápidamente", "rápido"],
      ["ten", "tener"],         // irregular tu imperative
      ["pon", "poner"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });
});
