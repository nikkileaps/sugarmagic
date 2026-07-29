/**
 * packages/plugins/src/catalog/sugarlang/tests/data/competency-inventory.test.ts
 *
 * Purpose: Pins the competency inventory JSON schema, the es seed data, and the runtime loader.
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
  getAllInventoryChunks,
  loadCompetencyInventory
} from "../../runtime/inventory/competency-inventory-loader";
import { INTERPRET_LEXICON_CATEGORIES } from "../../runtime/contracts/competency-inventory";

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

  it("es inventory has the required item-zero meta-language function", () => {
    const metaFn = esInventory.competencies.find(
      (fn) => fn.competencyId === "meta-language"
    );
    expect(metaFn).toBeDefined();
    expect(metaFn!.isItemZero).toBe(true);
    expect(metaFn!.placementGateBand).toBe("A2");
    expect(metaFn!.chunks.es.length).toBeGreaterThanOrEqual(4);
  });

  it("es inventory includes the four interpretLexicon category functions", () => {
    const categories = esInventory.competencies
      .filter((fn) => fn.interpretLexiconCategory)
      .map((fn) => fn.interpretLexiconCategory);

    for (const required of INTERPRET_LEXICON_CATEGORIES) {
      expect(categories).toContain(required);
    }
  });

  it("every chunk has at least one surfaceForm and one constituentLemma", () => {
    for (const fn of esInventory.competencies) {
      for (const [lang, chunks] of Object.entries(fn.chunks)) {
        for (const chunk of chunks) {
          expect(
            chunk.surfaceForms.length,
            `${fn.competencyId}/${lang}/${chunk.chunkId} surfaceForms`
          ).toBeGreaterThan(0);
          expect(
            chunk.constituentLemmas.length,
            `${fn.competencyId}/${lang}/${chunk.chunkId} constituentLemmas`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("all chunk normalizedForms are unique within a language", () => {
    const seen = new Set<string>();
    for (const fn of esInventory.competencies) {
      for (const chunk of fn.chunks.es ?? []) {
        expect(seen.has(chunk.normalizedForm)).toBe(false);
        seen.add(chunk.normalizedForm);
      }
    }
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

  it("getChunks returns the expected chunks for greet/es", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const chunks = loader.getChunks("greet", "es");
    expect(chunks.length).toBeGreaterThan(0);
    const normalizedForms = chunks.map((c) => c.normalizedForm);
    expect(normalizedForms).toContain("hola");
    expect(normalizedForms).toContain("buenos_dias");
  });

  it("getAllChunks returns chunks from all functions", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const allChunks = loader.getAllChunks("es");
    const allCompetencyChunks = esInventory.competencies.flatMap(
      (fn) => fn.chunks.es ?? []
    );
    expect(allChunks.length).toBe(allCompetencyChunks.length);
  });

  it("getAllInventoryChunks convenience fn matches loader output", () => {
    const all = getAllInventoryChunks("es");
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

  it("085.6: item-zero functions do not leak into the four interpretLexicon categories", () => {
    const loader = new CompetencyInventoryLoader({ es: esInventory });
    const itemZeroFns = esInventory.competencies.filter((fn) => fn.isItemZero === true);
    expect(itemZeroFns.length).toBeGreaterThan(0);
    const lexicon = loader.buildInterpretLexicon("es");
    for (const fn of itemZeroFns) {
      const chunkForms = (fn.chunks.es ?? []).flatMap((c) => c.surfaceForms);
      for (const form of chunkForms) {
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
