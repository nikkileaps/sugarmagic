/**
 * scripts/data-prep/italian-derivation.test.ts
 *
 * Purpose: Pins the Italian forms the dictionary does not store but the
 *   morphology index derives -- the polite command, the conditional, the
 *   future, and pronouns attached to a verb.
 *
 * The counterpart of spanish-derivation.test.ts, and it exists for the same
 * reason: derivation is where non-words get written into the index. Italian's
 * own history is the argument -- the guessing pass it still falls back to
 * produced `probleme` for `problemi` and `banci` for `banchi`.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import type { MorphologyFile } from "./competency-inventory";
import { languageRules } from "./languages/registry";
import { readJsonFile, sugarlangDataPath } from "./sugarlang-language-data";

const index = readJsonFile<MorphologyFile>(
  sugarlangDataPath("languages", "it", "morphology.json")
).forms;

const lemmaOf = (surface: string) => index[surface]?.lemmaId ?? null;

/** Runs the third pass alone, so a case can be checked without the word
 *  having to be in the shipped dictionary yet. */
function derive(entry: Record<string, unknown>): string[] {
  const forms: Record<string, { lemmaId: string }> = {};
  languageRules("it").addDerivedForms?.(forms as never, entry as never);
  return Object.keys(forms);
}

describe("the two forms lesson 1 could not resolve", () => {
  it("resolves the polite command", () => {
    // `senta` is the Lei command and the present subjunctive at once. A1
    // politeness is largely polite commands, so this class is not optional.
    expect(lemmaOf("senta")).toBe("sentire");
  });

  it("resolves a verb with a pronoun stuck on the end", () => {
    expect(lemmaOf("figurati")).toBe("figurare");
  });
});

describe("derived Italian forms are real words", () => {
  it("builds the subjunctive off the io stem", () => {
    for (const [surface, lemma] of [
      ["senta", "sentire"],
      ["chieda", "chiedere"],
      ["scusino", "scusare"],
      ["presentino", "presentare"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("takes the irregular subjunctives from the list, not the stem", () => {
    expect(lemmaOf("vada")).toBe("andare");
  });

  it("THE ONE THAT WOULD BE WRONG: -isc- verbs drop the infix in the plural", () => {
    // `capisco` gives `capisca`, but the plural is NOT built on that stem --
    // `capisciamo` is not a word. The real forms are `capiamo` and `capiate`.
    // capire has no stored forms yet, so this runs the pass directly.
    const out = derive({
      lemmaId: "capire",
      partsOfSpeech: ["verb"],
      forms: {
        pres: ["capisco", "capisci", "capisce", "capiamo", "capite", "capiscono"],
        pret: [null, null, null, null, null, null],
        imp: [null, null, null, null, null, null],
        ger: "capendo",
        part: "capito"
      }
    });
    expect(out).toContain("capisca");
    expect(out).toContain("capiamo");
    expect(out).toContain("capiate");
    expect(out).not.toContain("capisciamo");
    expect(out).not.toContain("capisciate");
  });

  it("builds the conditional and future, regular and irregular", () => {
    for (const [surface, lemma] of [
      ["sentirei", "sentire"],
      ["chiamerei", "chiamare"],
      ["sentirò", "sentire"],
      ["verrei", "venire"],
      ["verrò", "venire"],
      ["starei", "stare"]
    ] as const) {
      expect(lemmaOf(surface), surface).toBe(lemma);
    }
  });

  it("attaches pronouns to the infinitive, which drops its final -e", () => {
    // `dire` + `mi` is `dirmi`, never `diremi`.
    expect(lemmaOf("dirmi")).toBe("dire");
    expect(lemmaOf("farlo")).toBe("fare");
    expect(index["diremi"]).toBeUndefined();
    expect(index["farelo"]).toBeUndefined();
  });

  it("invents no TENSE for a word whose forms are not authored yet", () => {
    // Most of the Italian dictionary has no stored forms. Attaching a pronoun
    // needs only the infinitive, so that still happens -- but a tense cannot be
    // built without knowing the present, and guessing one is how `probleme`
    // and `banci` got written. The line is drawn here deliberately.
    const out = derive({ lemmaId: "temere", partsOfSpeech: ["verb"] });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("temermi");
    // No subjunctive, conditional or future: every form is the infinitive
    // stem plus one pronoun and nothing else.
    const clitics = ["mi", "ti", "si", "ci", "vi", "lo", "la", "li", "le", "ne"];
    for (const surface of out) {
      expect(
        clitics.some((clitic) => surface === `temer${clitic}`),
        surface
      ).toBe(true);
    }
  });

  it("a stored form still outranks a derived one", () => {
    // `sia` is a conjunction in its own right and keeps its own entry, even
    // though it is also the subjunctive of `essere`. Ordering, not accident.
    expect(lemmaOf("sia")).toBe("sia");
  });
});
