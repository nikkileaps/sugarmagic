/**
 * packages/plugins/src/catalog/sugarlang/tests/data/competency-inventory.test.ts
 *
 * Purpose: Pins the competency inventory JSON schema, the generated es data, and the runtime loader.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../data/schemas/competency-inventory.schema.json and
 *     ../../data/languages/es/competency-inventory.json as checked-in source of truth.
 *   - Exercises ../../runtime/inventory/competency-inventory-loader.
 *   - Uses ajv/dist/2020.js for JSON Schema Draft 2020-12 validation.
 *
 * Implements: Plan 085 story 085.2
 *
 * Status: active
 */

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import esInventory from "../../data/languages/es/competency-inventory.json";
import competencyInventorySchema from "../../data/schemas/competency-inventory.schema.json";
import {
  CompetencyInventoryLoader,
  buildInterpretLexiconFromInventory,
  getAllInventoryExponents,
  loadCompetencyInventory
} from "../../runtime/inventory/competency-inventory-loader";
import { INTERPRET_LEXICON_CATEGORIES } from "../../runtime/contracts/competency-inventory";
import { createChunkMatcher } from "../../runtime/classifier/chunk-matcher";
import { tokenize } from "../../runtime/classifier/tokenize";

describe("competency-inventory schema + data", () => {
  const ajv = new Ajv2020({ strict: true });

  it("es inventory validates against the schema", () => {
    const validate = ajv.compile(competencyInventorySchema);
    const valid = validate(esInventory);
    if (!valid) {
      throw new Error(
        `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`
      );
    }
    expect(valid).toBe(true);
  });

  it("es inventory has the required item-zero meta-language competency", () => {
    const meta = esInventory.competencies.find(
      (c) => c.competencyId === "meta-language"
    );
    expect(meta).toBeDefined();
    expect(meta!.isItemZero).toBe(true);
    expect(meta!.placementGateBand).toBe("A2");
    expect(meta!.exponents.es.length).toBeGreaterThanOrEqual(4);
  });

  it("every competency names a lesson the inventory carries", () => {
    const known = new Set(esInventory.lessons.map((l) => l.lessonId));
    const orphans = esInventory.competencies
      .filter((c) => !known.has(c.lessonId))
      .map((c) => `${c.competencyId} -> ${c.lessonId}`);
    expect(orphans).toEqual([]);
  });

  it("es inventory includes the four interpretLexicon category competencies", () => {
    const categories = esInventory.competencies
      .filter((c) => c.interpretLexiconCategory)
      .map((c) => c.interpretLexiconCategory);

    for (const required of INTERPRET_LEXICON_CATEGORIES) {
      expect(categories).toContain(required);
    }
  });

  it("every exponent has at least one surfaceForm and one constituentLemma", () => {
    for (const competency of esInventory.competencies) {
      for (const [lang, exponents] of Object.entries(competency.exponents)) {
        for (const exponent of exponents) {
          expect(
            exponent.surfaceForms.length,
            `${competency.competencyId}/${lang}/${exponent.exponentId} surfaceForms`
          ).toBeGreaterThan(0);
          expect(
            exponent.constituentLemmas.length,
            `${competency.competencyId}/${lang}/${exponent.exponentId} constituentLemmas`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("all exponent normalizedForms are unique within a language", () => {
    const seen = new Set<string>();
    for (const competency of esInventory.competencies) {
      for (const exponent of competency.exponents.es ?? []) {
        expect(seen.has(exponent.normalizedForm)).toBe(false);
        seen.add(exponent.normalizedForm);
      }
    }
  });

  it("every accented wording also ships deaccented, because players type without accents", () => {
    const strip = (v: string) =>
      v.normalize("NFD").replace(/\p{Diacritic}/gu, "").normalize("NFC");
    for (const competency of esInventory.competencies) {
      for (const exponent of competency.exponents.es ?? []) {
        for (const surface of exponent.surfaceForms) {
          expect(
            exponent.surfaceForms,
            `${exponent.exponentId} is missing the deaccented "${strip(surface)}"`
          ).toContain(strip(surface));
        }
      }
    }
  });
});

describe("the matcher can actually find what was authored", () => {
  it("THE ONE THAT MATTERS: every surface form finds its own exponent", () => {
    // Authoring a phrase is not the same as the matcher being able to reach
    // it. Two exponents sharing a surface form both validate -- their ids
    // differ, so the uniqueness check passes -- but longest-match means only
    // the longer one is ever returned, and the shorter one lists a spelling it
    // can never earn credit for. That is how `qué es esto` ended up on both
    // `meta-language` and `ask-meaning`, and `no me gusta nada` on both
    // `state-dislike` and `state-food-dislikes`.
    const exponents = getAllInventoryExponents("es");
    const matcher = createChunkMatcher(exponents, "es");
    const unreachable: string[] = [];
    for (const exponent of exponents) {
      for (const surface of exponent.surfaceForms) {
        const hits = matcher.match(tokenize(surface, "es"), surface);
        if (!hits.some((hit) => hit.item.exponentId === exponent.exponentId)) {
          unreachable.push(
            `${exponent.exponentId}: "${surface}" matched ${
              hits.map((h) => h.item.exponentId).join(", ") || "nothing"
            }`
          );
        }
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("no phrase is authored under two competencies", () => {
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const competency of esInventory.competencies) {
      for (const exponent of competency.exponents.es ?? []) {
        for (const surface of exponent.surfaceForms) {
          const prior = owner.get(surface);
          if (prior && prior !== competency.competencyId) {
            shared.push(`"${surface}": ${prior} and ${competency.competencyId}`);
          } else {
            owner.set(surface, competency.competencyId);
          }
        }
      }
    }
    expect(shared).toEqual([]);
  });
});

describe("CompetencyInventoryLoader", () => {
  it("loads es inventory without throwing", () => {
    expect(() => loadCompetencyInventory("es")).not.toThrow();
  });

  it("throws for an unknown language", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    expect(() => loader.load("fr")).toThrow(/Missing sugarlang competency inventory for "fr"/);
  });

  it("throws when injected data has a lang mismatch", () => {
    const mangled = { ...esInventory, lang: "it" };
    const loader = new CompetencyInventoryLoader({ es: mangled });
    expect(() => loader.load("es")).toThrow(/lang mismatch/);
  });

  it("getExponents returns the expected exponents for greet/es", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const exponents = loader.getExponents("greet", "es");
    expect(exponents.length).toBeGreaterThan(0);
    const normalizedForms = exponents.map((e) => e.normalizedForm);
    expect(normalizedForms).toContain("hola");
    expect(normalizedForms).toContain("buenos_dias");
  });

  it("getAllExponents returns exponents from every competency", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const all = loader.getAllExponents("es");
    const expected = esInventory.competencies.reduce(
      (count, c) => count + (c.exponents.es?.length ?? 0),
      0
    );
    expect(all.length).toBe(expected);
  });

  it("getAllInventoryExponents convenience fn matches loader output", () => {
    const all = getAllInventoryExponents("es");
    expect(all.length).toBeGreaterThan(0);
  });

  it("buildInterpretLexicon returns all four categories with non-empty arrays", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const lexicon = loader.buildInterpretLexicon("es");
    for (const category of INTERPRET_LEXICON_CATEGORIES) {
      expect(lexicon[category], category).toBeDefined();
      expect(lexicon[category].length, category).toBeGreaterThan(0);
    }
  });

  it("buildInterpretLexicon greeting includes hola and buenos dias variants", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const lexicon = loader.buildInterpretLexicon("es");
    expect(lexicon.greeting).toContain("hola");
    expect(lexicon.greeting.some((f) => f.includes("buenos"))).toBe(true);
  });

  it("buildInterpretLexicon matches the existing SPANISH_INTERPRET_LEXICON surface forms for farewell", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const lexicon = loader.buildInterpretLexicon("es");
    // Forms from the pre-085 hardcoded constant that must remain covered.
    const legacyFarewells = [
      "adiós",
      "adios",
      "hasta luego",
      "hasta pronto",
      "chao"
    ];
    for (const form of legacyFarewells) {
      expect(lexicon.farewell, `farewell must include "${form}"`).toContain(
        form
      );
    }
  });

  it("buildInterpretLexiconFromInventory convenience fn works for es", () => {
    const lexicon = buildInterpretLexiconFromInventory("es");
    expect(Object.keys(lexicon)).toEqual(expect.arrayContaining(["farewell", "greeting", "gratitude", "acknowledgement"]));
  });

  it("085.6: buildInterpretLexiconFromInventory includes gracias in gratitude (inventory replaces curated constant)", () => {
    const lexicon = buildInterpretLexiconFromInventory("es");
    expect(lexicon.gratitude).toContain("gracias");
  });

  it("085.6: item-zero competencies do not leak into the four interpretLexicon categories", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const itemZero = esInventory.competencies.filter((c) => c.isItemZero === true);
    expect(itemZero.length).toBeGreaterThan(0);
    const lexicon = loader.buildInterpretLexicon("es");
    for (const competency of itemZero) {
      const forms = (competency.exponents.es ?? []).flatMap((e) => e.surfaceForms);
      for (const form of forms) {
        for (const category of Object.keys(lexicon)) {
          expect(lexicon[category], `item-zero form "${form}" must not appear in category "${category}"`).not.toContain(form);
        }
      }
    }
  });

  it("caches the parsed inventory -- second load returns same reference", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const first = loader.load("es");
    const second = loader.load("es");
    expect(first).toBe(second);
  });
});
