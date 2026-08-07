/**
 * scripts/data-prep/language-rules.test.ts
 *
 * Purpose: Pins that each language's rules are its own -- that the Spanish
 *   function-word list is not applied to Italian, and that Italian's written
 *   short forms expand to real words.
 *
 * WHY THIS FILE EXISTS
 *   Both rules used to be one Spanish rule used for every language. Italian
 *   inherited them and was wrong in both directions at once: its articles and
 *   clitics counted as words an exponent teaches because they were not in the
 *   Spanish list, and `su` and `tu` were stripped because they were. The build
 *   was green throughout -- nothing about a wrong function-word list fails.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { MorphologyFile } from "./competency-inventory";
import { languageRules, registeredLanguages } from "./languages/registry";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

const morphology = (lang: string) =>
  readJsonFile<MorphologyFile>(
    sugarlangDataPath("languages", lang, "morphology.json")
  ).forms;

describe("function words are per language", () => {
  it("Spanish and Italian do not share a list", () => {
    const es = languageRules("es").functionWords;
    const it = languageRules("it").functionWords;
    expect([...it].sort()).not.toEqual([...es].sort());
  });

  it("the words Italian was wrongly inheriting are not in its list", () => {
    // `su` is a preposition in Italian ("on"), and the Spanish list has it as a
    // possessive. `tu` is Italian's subject pronoun, which the always-target
    // rule wants said out loud rather than treated as filler.
    const it = languageRules("it").functionWords;
    expect(it.has("su")).toBe(false);
    expect(it.has("tu")).toBe(false);
  });

  it("the words Italian was missing are in its list", () => {
    // Measured in lesson 1 before the split: `come ti chiami` counted `ti` and
    // `si` among the words it teaches, and `il mio nome e` counted `il`.
    const it = languageRules("it").functionWords;
    for (const lemma of ["il", "gli", "ti", "ci", "ne", "si"]) {
      expect(it.has(lemma), lemma).toBe(true);
    }
  });

  it("every function word is a real lemma in its own language", () => {
    // A lemma id that does not resolve can never be reached by the check, so
    // listing it is inert and hides the fact that the real one is missing.
    for (const lang of registeredLanguages()) {
      const index = morphology(lang);
      for (const lemma of languageRules(lang).functionWords) {
        expect(index[lemma]?.lemmaId, `${lang}: ${lemma}`).toBe(lemma);
      }
    }
  });
});

describe("Italian written short forms expand to real words", () => {
  const expand = (token: string) =>
    languageRules("it").expandWrittenForm?.(token) ?? null;

  it("expands the apostrophe kind", () => {
    expect(expand("dov'è")).toEqual(["dove", "è"]);
    expect(expand("c'è")).toEqual(["ci", "è"]);
    expect(expand("un'amica")).toEqual(["una", "amica"]);
  });

  it("expands the kind Italian writes with NO apostrophe", () => {
    // `qual è` is correct and `qual'è` is not, so an apostrophe-triggered rule
    // cannot see this one. It is the case that survived the first fix.
    expect(expand("qual")).toEqual(["quale"]);
    expect(expand("buon")).toEqual(["buono"]);
  });

  it("leaves ordinary words alone", () => {
    expect(expand("grazie")).toBeNull();
    expect(expand("dove")).toBeNull();
  });

  it("every expansion lands on a word the dictionary holds", () => {
    const index = morphology("it");
    for (const token of ["dov'è", "c'è", "un'amica", "qual", "buon", "gran"]) {
      for (const word of expand(token) ?? []) {
        expect(index[word]?.lemmaId, `${token} -> ${word}`).toBeTruthy();
      }
    }
  });

  it("Spanish supplies no expansion, and that is not an oversight", () => {
    // Spanish writes neither kind. `del` and `al` are single words the
    // dictionary already holds.
    expect(languageRules("es").expandWrittenForm).toBeUndefined();
  });
});
