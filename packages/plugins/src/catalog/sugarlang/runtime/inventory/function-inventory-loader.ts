/**
 * packages/plugins/src/catalog/sugarlang/runtime/inventory/function-inventory-loader.ts
 *
 * Purpose: Loads the hand-curated function inventory JSON data and exposes lookup helpers.
 *
 * Exports:
 *   - FunctionInventoryLoader
 *   - loadFunctionInventory
 *   - getAllInventoryChunks
 *   - buildInterpretLexiconFromInventory
 *
 * Relationships:
 *   - Depends on data/languages/{lang}/function-inventory.json.
 *   - Contracts defined in runtime/contracts/function-inventory.ts.
 *   - Consumed by: sugar-lang-observe-middleware (085.3), function-tag-resolver (085.4),
 *     teach-record store (085.5), sugar-lang-teacher-middleware (085.6).
 *
 * Implements: Plan 085 story 085.2
 *
 * Status: active
 */

import esInventoryData from "../../data/languages/es/function-inventory.json";
import type {
  FunctionInventory,
  FunctionEntry,
  InventoryChunk
} from "../contracts/function-inventory";
import { INTERPRET_LEXICON_CATEGORIES as CATEGORIES } from "../contracts/function-inventory";

function assertValidInventory(
  data: unknown,
  lang: string
): asserts data is FunctionInventory {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid function inventory for "${lang}": expected object root.`
    );
  }
  const record = data as Record<string, unknown>;
  if (record.schemaVersion !== "1") {
    throw new Error(
      `Invalid function inventory for "${lang}": unsupported schemaVersion "${record.schemaVersion}".`
    );
  }
  if (record.lang !== lang) {
    throw new Error(
      `Invalid function inventory for "${lang}": lang mismatch ("${record.lang}").`
    );
  }
  if (!Array.isArray(record.functions) || record.functions.length === 0) {
    throw new Error(
      `Invalid function inventory for "${lang}": missing or empty functions array.`
    );
  }
  for (const fn of record.functions as unknown[]) {
    if (typeof fn !== "object" || fn === null) {
      throw new Error(
        `Invalid function inventory for "${lang}": function entry is not an object.`
      );
    }
    const entry = fn as Record<string, unknown>;
    if (typeof entry.functionId !== "string" || entry.functionId.length === 0) {
      throw new Error(
        `Invalid function inventory for "${lang}": function entry missing functionId.`
      );
    }
    if (typeof entry.chunks !== "object" || entry.chunks === null) {
      throw new Error(
        `Invalid function inventory for "${lang}": function "${entry.functionId}" missing chunks map.`
      );
    }
  }
}

const DEFAULT_INVENTORY_DATA: Partial<Record<string, unknown>> = {
  es: esInventoryData
};

export class FunctionInventoryLoader {
  private readonly cache = new Map<string, FunctionInventory>();

  constructor(
    private readonly dataByLang: Partial<
      Record<string, unknown>
    > = DEFAULT_INVENTORY_DATA
  ) {}

  load(lang: string): FunctionInventory {
    const cached = this.cache.get(lang);
    if (cached) return cached;

    const data = this.dataByLang[lang];
    if (!data) {
      throw new Error(`Missing sugarlang function inventory for "${lang}".`);
    }
    assertValidInventory(data, lang);
    this.cache.set(lang, data);
    return data;
  }

  /** All FunctionEntry objects for a language, in declaration order. */
  getFunctions(lang: string): FunctionEntry[] {
    return this.load(lang).functions;
  }

  /** Chunks registered under a specific functionId for a language. */
  getChunks(functionId: string, lang: string): InventoryChunk[] {
    const fn = this.load(lang).functions.find(
      (f) => f.functionId === functionId
    );
    return fn?.chunks[lang] ?? [];
  }

  /**
   * All InventoryChunk objects across all functions for a language.
   * Used by the observe middleware to seed the chunk detection pass.
   */
  getAllChunks(lang: string): InventoryChunk[] {
    return this.load(lang).functions.flatMap((fn) => fn.chunks[lang] ?? []);
  }

  /**
   * Returns the FunctionEntry that owns the given chunkId for a language,
   * or undefined if the chunk is not in the inventory.
   * Used by the observe middleware to find the function for a first-teach event.
   */
  getFunctionForChunk(
    chunkId: string,
    lang: string
  ): import("../contracts/function-inventory").FunctionEntry | undefined {
    return this.load(lang).functions.find((fn) =>
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

    for (const fn of this.load(lang).functions) {
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

const defaultLoader = new FunctionInventoryLoader();

export function loadFunctionInventory(lang: string): FunctionInventory {
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

export function getFunctionForChunk(
  chunkId: string,
  lang: string
): import("../contracts/function-inventory").FunctionEntry | undefined {
  try {
    return defaultLoader.getFunctionForChunk(chunkId, lang);
  } catch {
    // Missing inventory for language -- not a fatal error at observation time.
    return undefined;
  }
}
