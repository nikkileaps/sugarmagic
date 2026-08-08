/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/word-forms.test.ts
 *
 * Purpose: Pins the verb-forms contract against the SHIPPED dictionary --
 *   slot order, null handling, and the accessors that exist so nothing indexes
 *   a forms array by hand.
 *
 * Relationships:
 *   - Exercises runtime/classifier/word-forms.ts against every shipped
 *     dictionary under data/languages/.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import esAtlas from "../../data/languages/es/cefrlex.json";
import itAtlas from "../../data/languages/it/cefrlex.json";
import {
  PERSON_SLOT,
  allForms,
  formAt,
  isVerbForms,
  type VerbForms,
  type WordForms
} from "../../runtime/classifier/word-forms";

const lemmas = (esAtlas as { lemmas: Record<string, { forms?: WordForms }> })
  .lemmas;

function formsOf(lemmaId: string): VerbForms {
  const forms = lemmas[lemmaId]?.forms;
  if (!isVerbForms(forms)) throw new Error(`${lemmaId} has no verb forms`);
  return forms;
}

describe("word forms, against the shipped dictionary", () => {
  it("reads a slot by person rather than by index", () => {
    const pedir = formsOf("pedir");
    expect(formAt(pedir, "present", "firstSingular")).toBe("pido");
    expect(formAt(pedir, "present", "thirdPlural")).toBe("piden");
    expect(formAt(pedir, "preterite", "thirdSingular")).toBe("pidió");
    expect(formAt(pedir, "imperfect", "firstPlural")).toBe("pedíamos");
  });

  it("stores slots in PERSON_SLOT order", () => {
    // The whole point of the named slots: if the stored order ever changes,
    // this fails instead of every lookup silently returning the wrong person.
    const hablar = formsOf("hablar");
    expect(hablar.pres[PERSON_SLOT.firstSingular]).toBe("hablo");
    expect(hablar.pres[PERSON_SLOT.secondSingular]).toBe("hablas");
    expect(hablar.pres[PERSON_SLOT.thirdSingular]).toBe("habla");
    expect(hablar.pres[PERSON_SLOT.firstPlural]).toBe("hablamos");
    expect(hablar.pres[PERSON_SLOT.secondPlural]).toBe("habláis");
    expect(hablar.pres[PERSON_SLOT.thirdPlural]).toBe("hablan");
  });

  it("returns null for a person the verb does not have", () => {
    // `llover` is impersonal -- "I rain" is not a thing anyone says. Null is a
    // claim that the form does not exist, not a gap in the data.
    const llover = formsOf("llover");
    expect(formAt(llover, "present", "firstSingular")).toBeNull();
    expect(formAt(llover, "present", "thirdSingular")).toBe("llueve");
  });

  it("collects every surface, deduplicated and without nulls", () => {
    const llover = allForms(formsOf("llover"));
    expect(llover).toContain("llueve");
    expect(llover).not.toContain(null);

    // hablamos is BOTH present and preterite first-plural; it appears once.
    const hablar = allForms(formsOf("hablar"));
    expect(hablar.filter((f) => f === "hablamos")).toHaveLength(1);
  });

  it("keeps every tense six slots wide", () => {
    const wrong: string[] = [];
    for (const [lemmaId, entry] of Object.entries(lemmas)) {
      if (!isVerbForms(entry.forms)) continue;
      for (const tense of ["pres", "pret", "imp"] as const) {
        if (entry.forms[tense].length !== 6) wrong.push(`${lemmaId}.${tense}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("uses only Spanish orthography", () => {
    // A Cyrillic 'e' (U+0435) once reached four `desplegar` forms. It is
    // invisible on inspection and would simply never have matched.
    const allowed = /^[a-záéíóúüñ]+$/;
    const wrong: string[] = [];
    for (const [lemmaId, entry] of Object.entries(lemmas)) {
      if (!entry.forms) continue;
      for (const form of allForms(entry.forms)) {
        if (!allowed.test(form.toLowerCase())) wrong.push(`${lemmaId}: ${form}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("marks provenance on every set of forms", () => {
    const missing = Object.entries(
      lemmas as Record<string, { forms?: VerbForms; formsSource?: string }>
    )
      .filter(([, e]) => e.forms && !e.formsSource)
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });
});

/**
 * The same contract over every shipped dictionary. Italian was authored to 405
 * sets of forms while this file checked Spanish only, and the one error found
 * in them -- a doubled `i` from using the wrong -are helper -- was caught by a
 * hand-run sweep rather than by anything that would run again.
 */
describe.each([
  { lang: "es", atlas: esAtlas, allowed: /^[a-záéíóúüñ]+$/ },
  // Italian takes grave and acute accents and no tilde or diaeresis.
  { lang: "it", atlas: itAtlas, allowed: /^[a-zàèéìíîòóùú]+$/ }
])("the shipped $lang dictionary keeps the forms contract", ({ atlas, allowed }) => {
  const entries = (
    atlas as { lemmas: Record<string, { forms?: WordForms; formsSource?: string }> }
  ).lemmas;

  it("keeps every tense six slots wide", () => {
    const wrong: string[] = [];
    for (const [lemmaId, entry] of Object.entries(entries)) {
      if (!isVerbForms(entry.forms)) continue;
      for (const tense of ["pres", "pret", "imp"] as const) {
        if (entry.forms[tense].length !== 6) wrong.push(`${lemmaId}.${tense}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("uses only that language's orthography", () => {
    // A Cyrillic 'e' (U+0435) once reached four `desplegar` forms. It is
    // invisible on inspection and would simply never have matched.
    const wrong: string[] = [];
    for (const [lemmaId, entry] of Object.entries(entries)) {
      if (!entry.forms) continue;
      for (const form of allForms(entry.forms)) {
        if (!allowed.test(form.toLowerCase())) wrong.push(`${lemmaId}: ${form}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("marks provenance on every set of forms", () => {
    const missing = Object.entries(entries)
      .filter(([, e]) => e.forms && !e.formsSource)
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });
});
