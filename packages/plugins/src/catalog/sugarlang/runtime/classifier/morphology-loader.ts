/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/morphology-loader.ts
 *
 * Purpose: Loads plugin-shipped morphology indexes and exposes a fail-fast lemma lookup helper.
 *
 * Exports:
 *   - MorphologyDataFile
 *   - MorphologyEntry
 *   - MorphologyLoader
 *   - loadMorphologyIndex
 *   - lemmatizeWithMorphology
 *
 * Relationships:
 *   - Depends on plugin-owned language data under data/languages/<lang>/morphology.json.
 *   - Is consumed by lemmatize.ts and Epic 4 loader tests.
 *
 * Implements: Proposal 001 §Multi-Language Handling / Epic 4 Story 4.4
 *
 * Status: active
 */

import esMorphologyData from "../../data/languages/es/morphology.json";
import itMorphologyData from "../../data/languages/it/morphology.json";

export interface MorphologyEntry {
  lemmaId: string;
  partsOfSpeech?: string[];
}

export interface MorphologyDataFile {
  lang: string;
  forms: Record<string, MorphologyEntry>;
}

function assertValidMorphologyData(
  data: unknown,
  lang: string
): asserts data is MorphologyDataFile {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid morphology data for "${lang}": expected object root.`
    );
  }

  const record = data as Record<string, unknown>;
  if (record.lang !== lang) {
    throw new Error(`Invalid morphology data for "${lang}": lang mismatch.`);
  }
  if (typeof record.forms !== "object" || record.forms === null) {
    throw new Error(
      `Invalid morphology data for "${lang}": missing forms map.`
    );
  }

  for (const [surfaceForm, rawEntry] of Object.entries(record.forms)) {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      throw new Error(
        `Invalid morphology data for "${lang}": form "${surfaceForm}" is not an object.`
      );
    }

    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.lemmaId !== "string" || entry.lemmaId.length === 0) {
      throw new Error(
        `Invalid morphology data for "${lang}": form "${surfaceForm}" is missing lemmaId.`
      );
    }
    if (
      entry.partsOfSpeech !== undefined &&
      (!Array.isArray(entry.partsOfSpeech) ||
        entry.partsOfSpeech.some((value) => typeof value !== "string"))
    ) {
      throw new Error(
        `Invalid morphology data for "${lang}": form "${surfaceForm}" has invalid partsOfSpeech.`
      );
    }
  }
}

const DEFAULT_MORPHOLOGY_DATA: Record<string, MorphologyDataFile> = {
  es: esMorphologyData as MorphologyDataFile,
  it: itMorphologyData as MorphologyDataFile
};

export class MorphologyLoader {
  private readonly cache = new Map<string, MorphologyDataFile>();

  constructor(
    private readonly dataByLang: Partial<
      Record<string, MorphologyDataFile>
    > = DEFAULT_MORPHOLOGY_DATA
  ) {}

  load(lang: string): MorphologyDataFile {
    const cached = this.cache.get(lang);
    if (cached) {
      return cached;
    }

    const data = this.dataByLang[lang];
    if (!data) {
      throw new Error(
        `Missing sugarlang morphology data for language "${lang}".`
      );
    }

    assertValidMorphologyData(data, lang);
    this.cache.set(lang, data);
    return data;
  }

  lemmatize(surfaceForm: string, lang: string): string | null {
    const normalized = surfaceForm.trim().toLowerCase();
    if (normalized.length === 0) {
      return null;
    }

    return this.load(lang).forms[normalized]?.lemmaId ?? null;
  }
}

const defaultMorphologyLoader = new MorphologyLoader();

export function loadMorphologyIndex(lang: string): MorphologyDataFile {
  return defaultMorphologyLoader.load(lang);
}

export function lemmatizeWithMorphology(
  surfaceForm: string,
  lang: string
): string | null {
  return defaultMorphologyLoader.lemmatize(surfaceForm, lang);
}
