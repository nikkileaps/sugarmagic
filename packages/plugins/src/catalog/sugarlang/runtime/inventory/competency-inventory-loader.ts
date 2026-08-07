/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/competency-inventory-loader.ts
 *
 * Purpose: Loads the generated competency inventory JSON data and exposes lookup helpers.
 *
 * Exports:
 *   - CompetencyInventoryLoader
 *   - loadCompetencyInventory
 *   - getAllInventoryExponents
 *   - getCompetencyForExponent
 *   - buildInterpretLexiconFromInventory
 *
 * Relationships:
 *   - Depends on data/languages/{lang}/competency-inventory.json.
 *   - Contracts defined in runtime/contracts/competency-inventory.ts.
 *   - Consumed by: sugar-lang-observe-middleware (085.3), competency-tag-resolver (085.4),
 *     teach-record store (085.5), sugar-lang-teacher-middleware (085.6).
 *
 * Implements: Plan 085 story 085.2
 *
 * Status: active
 */

import esInventoryData from "../../data/languages/es/competency-inventory.json";
import itInventoryData from "../../data/languages/it/competency-inventory.json";
import type {
  CompetencyInventory,
  Competency,
  Exponent
} from "../contracts/competency-inventory";
import { INTERPRET_LEXICON_CATEGORIES as CATEGORIES } from "../contracts/competency-inventory";

function assertValidInventory(
  data: unknown,
  lang: string
): asserts data is CompetencyInventory {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid competency inventory for "${lang}": expected object root.`
    );
  }
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== "2") {
    throw new Error(
      `Invalid competency inventory for "${lang}": unsupported schemaVersion "${record.schemaVersion}".`
    );
  }
  if (record.lang !== lang) {
    throw new Error(
      `Invalid competency inventory for "${lang}": lang mismatch ("${record.lang}").`
    );
  }
  if (!Array.isArray(record.competencies) || record.competencies.length === 0) {
    throw new Error(
      `Invalid competency inventory for "${lang}": missing or empty competencies array.`
    );
  }
  for (const competency of record.competencies as unknown[]) {
    if (typeof competency !== "object" || competency === null) {
      throw new Error(
        `Invalid competency inventory for "${lang}": competency entry is not an object.`
      );
    }
    const entry = competency as Record<string, unknown>;
    if (typeof entry.competencyId !== "string" || entry.competencyId.length === 0) {
      throw new Error(
        `Invalid competency inventory for "${lang}": competency entry missing competencyId.`
      );
    }
    if (typeof entry.exponents !== "object" || entry.exponents === null) {
      throw new Error(
        `Invalid competency inventory for "${lang}": competency "${entry.competencyId}" missing exponents map.`
      );
    }
  }
}

/**
 * Italian is authored a lesson at a time, so its inventory holds whatever has
 * been written so far -- one lesson today. That is a legitimate state, not a
 * half-built one: `buildCompetencyInventory` emits only the competencies a
 * language has exponents for, and only the lessons those fill.
 *
 * The consequence to know about: `prompt-builder` selects competencies by
 * EXACT band, so a learner placed above A1 sees none of these until the higher
 * bands are authored.
 */
const DEFAULT_INVENTORY_DATA: Partial<Record<string, unknown>> = {
  es: esInventoryData,
  it: itInventoryData
};

export class CompetencyInventoryLoader {
  private readonly cache = new Map<string, CompetencyInventory>();

  constructor(
    private readonly dataByLang: Partial<
      Record<string, unknown>
    > = DEFAULT_INVENTORY_DATA
  ) {}

  load(lang: string): CompetencyInventory {
    const cached = this.cache.get(lang);
    if (cached) return cached;

    const data = this.dataByLang[lang];
    if (!data) {
      throw new Error(`Missing sugarlang competency inventory for "${lang}".`);
    }
    assertValidInventory(data, lang);
    this.cache.set(lang, data);
    return data;
  }

  /** All Competency objects for a language, in declaration order. */
  getCompetencies(lang: string): Competency[] {
    return this.load(lang).competencies;
  }

  /** Exponents registered under a specific competencyId for a language. */
  getExponents(competencyId: string, lang: string): Exponent[] {
    const found = this.load(lang).competencies.find(
      (c) => c.competencyId === competencyId
    );
    return found?.exponents[lang] ?? [];
  }

  /**
   * Every exponent across all competencies for a language.
   * Used by the observe middleware to seed the detection pass.
   */
  getAllExponents(lang: string): Exponent[] {
    return this.load(lang).competencies.flatMap((c) => c.exponents[lang] ?? []);
  }

  /**
   * The Competency that owns the given exponent id for a language, or
   * undefined if it is not in the inventory. Used by the observe middleware to
   * find the competency for a first-teach event.
   */
  getCompetencyForExponent(
    exponentId: string,
    lang: string
  ): Competency | undefined {
    return this.load(lang).competencies.find((c) =>
      (c.exponents[lang] ?? []).some((e) => e.exponentId === exponentId)
    );
  }

  /**
   * Builds the interpretLexicon contribution from inventory data.
   * Returns a Record<category, surfaceForm[]> consumed by interpretation.ts
   * to classify social moves (farewell / greeting / gratitude / acknowledgement).
   * Only competencies with `interpretLexiconCategory` set contribute.
   */
  buildInterpretLexicon(lang: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const category of CATEGORIES) {
      result[category] = [];
    }

    for (const competency of this.load(lang).competencies) {
      if (!competency.interpretLexiconCategory) continue;
      const category = competency.interpretLexiconCategory;
      for (const exponent of competency.exponents[lang] ?? []) {
        for (const surface of exponent.surfaceForms) {
          if (!result[category].includes(surface)) {
            result[category].push(surface);
          }
        }
      }
    }

    return result;
  }
}

const defaultLoader = new CompetencyInventoryLoader();

export function loadCompetencyInventory(lang: string): CompetencyInventory {
  return defaultLoader.load(lang);
}

export function getAllInventoryExponents(lang: string): Exponent[] {
  return defaultLoader.getAllExponents(lang);
}

export function buildInterpretLexiconFromInventory(
  lang: string
): Record<string, string[]> {
  return defaultLoader.buildInterpretLexicon(lang);
}

export function getCompetencyForExponent(
  exponentId: string,
  lang: string
): Competency | undefined {
  try {
    return defaultLoader.getCompetencyForExponent(exponentId, lang);
  } catch {
    // Missing inventory for language -- not a fatal error at observation time.
    return undefined;
  }
}
