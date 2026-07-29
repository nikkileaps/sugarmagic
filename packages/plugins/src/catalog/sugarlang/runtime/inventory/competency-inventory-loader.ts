/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/competency-inventory-loader.ts
 *
 * Purpose: Loads the hand-curated competency inventory JSON data and exposes lookup helpers.
 *
 * Exports:
 *   - CompetencyInventoryLoader
 *   - loadCompetencyInventory
 *   - getAllInventoryChunks
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
import type {
  CompetencyInventory,
  Competency,
  InventoryChunk
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
  if (record.schemaVersion !== "1") {
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
      `Invalid competency inventory for "${lang}": missing or empty functions array.`
    );
  }
  for (const fn of record.competencies as unknown[]) {
    if (typeof fn !== "object" || fn === null) {
      throw new Error(
        `Invalid competency inventory for "${lang}": function entry is not an object.`
      );
    }
    const entry = fn as Record<string, unknown>;
    if (typeof entry.competencyId !== "string" || entry.competencyId.length === 0) {
      throw new Error(
        `Invalid competency inventory for "${lang}": function entry missing competencyId.`
      );
    }
    if (typeof entry.chunks !== "object" || entry.chunks === null) {
      throw new Error(
        `Invalid competency inventory for "${lang}": function "${entry.competencyId}" missing chunks map.`
      );
    }
  }
}

const DEFAULT_INVENTORY_DATA: Partial<Record<string, unknown>> = {
  es: esInventoryData
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

  /** Chunks registered under a specific competencyId for a language. */
  getChunks(competencyId: string, lang: string): InventoryChunk[] {
    const fn = this.load(lang).competencies.find(
      (f) => f.competencyId === competencyId
    );
    return fn?.chunks[lang] ?? [];
  }

  /**
   * All InventoryChunk objects across all functions for a language.
   * Used by the observe middleware to seed the chunk detection pass.
   */
  getAllChunks(lang: string): InventoryChunk[] {
    return this.load(lang).competencies.flatMap((fn) => fn.chunks[lang] ?? []);
  }

  /**
   * Returns the Competency that owns the given chunkId for a language,
   * or undefined if the chunk is not in the inventory.
   * Used by the observe middleware to find the function for a first-teach event.
   */
  getCompetencyForChunk(
    chunkId: string,
    lang: string
  ): import("../contracts/competency-inventory").Competency | undefined {
    return this.load(lang).competencies.find((fn) =>
      (fn.chunks[lang] ?? []).some((c) => c.chunkId === chunkId)
    );
  }

  /**
   * Builds the interpretLexicon contribution from inventory data.
   * Returns a Record<category, surfaceForm[]> consumed by interpretation.ts
   * to classify social moves (farewell / greeting / gratitude / acknowledgement).
   * Only functions with `interpretLexiconCategory` set contribute.
   */
  buildInterpretLexicon(lang: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const category of CATEGORIES) {
      result[category] = [];
    }

    for (const fn of this.load(lang).competencies) {
      if (!fn.interpretLexiconCategory) continue;
      const category = fn.interpretLexiconCategory;
      const chunks = fn.chunks[lang] ?? [];
      for (const chunk of chunks) {
        for (const surface of chunk.surfaceForms) {
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

export function getAllInventoryChunks(lang: string): InventoryChunk[] {
  return defaultLoader.getAllChunks(lang);
}

export function buildInterpretLexiconFromInventory(
  lang: string
): Record<string, string[]> {
  return defaultLoader.buildInterpretLexicon(lang);
}

export function getCompetencyForChunk(
  chunkId: string,
  lang: string
): import("../contracts/competency-inventory").Competency | undefined {
  try {
    return defaultLoader.getCompetencyForChunk(chunkId, lang);
  } catch {
    // Missing inventory for language -- not a fatal error at observation time.
    return undefined;
  }
}
