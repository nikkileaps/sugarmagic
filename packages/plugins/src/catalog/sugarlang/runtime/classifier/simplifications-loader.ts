/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/simplifications-loader.ts
 *
 * Purpose: Loads plugin-shipped simplification dictionaries and exposes deterministic lookup helpers.
 *
 * Exports:
 *   - SimplificationKind
 *   - SimplificationEntry
 *   - SimplificationsDataFile
 *   - SimplificationsLoader
 *   - loadSimplifications
 *   - getSimplification
 *
 * Relationships:
 *   - Depends on plugin-owned language data under data/languages/<lang>/simplifications.json.
 *   - Will be consumed by the auto-simplify fallback in Epic 5.
 *
 * Implements: Proposal 001 §Verification, Failure Modes, and Guardrails / Epic 4 Story 4.4
 *
 * Status: active
 */

import esSimplificationsData from "../../data/languages/es/simplifications.json";
import itSimplificationsData from "../../data/languages/it/simplifications.json";

export type SimplificationKind = "lemma-substitution" | "gloss-fallback";

export interface SimplificationEntry {
  kind: SimplificationKind;
  lemmaId?: string;
  gloss?: string;
  contextTags?: string[];
}

export interface SimplificationsDataFile {
  lang: string;
  entries: Record<string, SimplificationEntry[]>;
}

function assertValidSimplificationsData(
  data: unknown,
  lang: string
): asserts data is SimplificationsDataFile {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid simplifications data for "${lang}": expected object root.`
    );
  }

  const record = data as Record<string, unknown>;
  if (record.lang !== lang) {
    throw new Error(
      `Invalid simplifications data for "${lang}": lang mismatch.`
    );
  }
  if (typeof record.entries !== "object" || record.entries === null) {
    throw new Error(
      `Invalid simplifications data for "${lang}": missing entries map.`
    );
  }

  for (const [lemmaId, rawEntries] of Object.entries(record.entries)) {
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      throw new Error(
        `Invalid simplifications data for "${lang}": lemma "${lemmaId}" has no substitutions.`
      );
    }

    rawEntries.forEach((rawEntry, index) => {
      if (typeof rawEntry !== "object" || rawEntry === null) {
        throw new Error(
          `Invalid simplifications data for "${lang}": lemma "${lemmaId}" entry ${index} is not an object.`
        );
      }

      const entry = rawEntry as Record<string, unknown>;
      if (
        entry.kind !== "lemma-substitution" &&
        entry.kind !== "gloss-fallback"
      ) {
        throw new Error(
          `Invalid simplifications data for "${lang}": lemma "${lemmaId}" entry ${index} has invalid kind.`
        );
      }
      if (
        entry.kind === "lemma-substitution" &&
        (typeof entry.lemmaId !== "string" || entry.lemmaId.length === 0)
      ) {
        throw new Error(
          `Invalid simplifications data for "${lang}": lemma "${lemmaId}" entry ${index} is missing lemmaId.`
        );
      }
      if (
        entry.kind === "gloss-fallback" &&
        (typeof entry.gloss !== "string" || entry.gloss.length === 0)
      ) {
        throw new Error(
          `Invalid simplifications data for "${lang}": lemma "${lemmaId}" entry ${index} is missing gloss.`
        );
      }
    });
  }
}

const DEFAULT_SIMPLIFICATIONS_DATA: Record<string, SimplificationsDataFile> = {
  es: esSimplificationsData as SimplificationsDataFile,
  it: itSimplificationsData as SimplificationsDataFile
};

export class SimplificationsLoader {
  private readonly cache = new Map<string, SimplificationsDataFile>();

  constructor(
    private readonly dataByLang: Partial<
      Record<string, SimplificationsDataFile>
    > = DEFAULT_SIMPLIFICATIONS_DATA
  ) {}

  load(lang: string): SimplificationsDataFile {
    const cached = this.cache.get(lang);
    if (cached) {
      return cached;
    }

    const data = this.dataByLang[lang];
    if (!data) {
      throw new Error(`Missing sugarlang simplifications data for "${lang}".`);
    }

    assertValidSimplificationsData(data, lang);
    this.cache.set(lang, data);
    return data;
  }

  getSimplification(
    lemmaId: string,
    lang: string
  ): SimplificationEntry | undefined {
    return this.load(lang).entries[lemmaId]?.[0];
  }
}

const defaultSimplificationsLoader = new SimplificationsLoader();

export function loadSimplifications(lang: string): SimplificationsDataFile {
  return defaultSimplificationsLoader.load(lang);
}

export function getSimplification(
  lemmaId: string,
  lang: string
): SimplificationEntry | undefined {
  return defaultSimplificationsLoader.getSimplification(lemmaId, lang);
}
