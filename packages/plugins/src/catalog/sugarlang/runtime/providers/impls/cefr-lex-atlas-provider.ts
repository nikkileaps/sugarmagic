/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/cefr-lex-atlas-provider.ts
 *
 * Purpose: Reserves the data-backed lexical atlas provider implementation for sugarlang.
 *
 * Exports:
 *   - CefrLexAtlasProvider
 *
 * Relationships:
 *   - Implements the LexicalAtlasProvider contract.
 *   - Will read plugin-shipped language assets once Epic 4 and Epic 5 land.
 *
 * Implements: Proposal 001 §Why This Proposal Exists / ADR 010 provider boundaries
 *
 * Status: active
 */

import esAtlasData from "../../../data/languages/es/cefrlex.json";
import itAtlasData from "../../../data/languages/it/cefrlex.json";
import type {
  AtlasLemmaEntry,
  CEFRBand,
  LemmaRef,
  LexicalAtlasProvider
} from "../../types";

export type AtlasPriorSource =
  | "cefrlex"
  | "frequency-derived"
  | "claude-classified"
  | "human-override"
  | "kelly";

export interface CefrLexDataFile {
  lang: string;
  atlasVersion: string;
  lemmas: Record<
    string,
    AtlasLemmaEntry & {
      cefrPriorSource: AtlasPriorSource;
      glosses?: Record<string, string>;
    }
  >;
}

const ATLAS_PRIOR_SOURCES = new Set<AtlasPriorSource>([
  "cefrlex",
  "frequency-derived",
  "claude-classified",
  "human-override",
  "kelly"
]);

function assertValidAtlasFile(
  data: unknown,
  lang: string
): asserts data is CefrLexDataFile {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Invalid cefrlex data for "${lang}": expected object root.`
    );
  }

  const record = data as Record<string, unknown>;
  if (record.lang !== lang) {
    throw new Error(`Invalid cefrlex data for "${lang}": lang mismatch.`);
  }
  if (
    typeof record.atlasVersion !== "string" ||
    record.atlasVersion.length === 0
  ) {
    throw new Error(
      `Invalid cefrlex data for "${lang}": missing atlasVersion.`
    );
  }
  if (typeof record.lemmas !== "object" || record.lemmas === null) {
    throw new Error(`Invalid cefrlex data for "${lang}": missing lemmas map.`);
  }

  for (const [lemmaId, rawEntry] of Object.entries(record.lemmas)) {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" is not an object.`
      );
    }

    const entry = rawEntry as Record<string, unknown>;
    if (entry.lemmaId !== lemmaId) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" key mismatch.`
      );
    }
    if (entry.lang !== lang) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" lang mismatch.`
      );
    }
    if (
      typeof entry.frequencyRank !== "number" ||
      !Number.isInteger(entry.frequencyRank) ||
      entry.frequencyRank < 1
    ) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" has invalid frequencyRank.`
      );
    }
    if (
      !Array.isArray(entry.partsOfSpeech) ||
      entry.partsOfSpeech.length === 0
    ) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" has no partsOfSpeech.`
      );
    }
    if (typeof entry.cefrPriorSource !== "string") {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" is missing cefrPriorSource.`
      );
    }
    if (!ATLAS_PRIOR_SOURCES.has(entry.cefrPriorSource as AtlasPriorSource)) {
      throw new Error(
        `Invalid cefrlex data for "${lang}": lemma "${lemmaId}" has unknown cefrPriorSource.`
      );
    }
  }
}

const DEFAULT_ATLAS_DATA: Record<string, CefrLexDataFile> = {
  es: esAtlasData as CefrLexDataFile,
  it: itAtlasData as CefrLexDataFile
};

/**
 * Reverse gloss index key: `${targetLang}:${supportLang}`.
 * Value: map from lowercase gloss word → array of target-language lemma IDs.
 */
type GlossReverseIndex = Map<string, Map<string, string[]>>;

function buildGlossReverseIndex(
  data: CefrLexDataFile,
  supportLang: string
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const entry of Object.values(data.lemmas)) {
    const glossString = entry.glosses?.[supportLang];
    if (!glossString) continue;

    // Only index the PRIMARY (first) gloss word for reverse lookup.
    // Secondary glosses after the comma are for tooltip display, not for
    // compiling English authored content to target-language lemmas.
    // This prevents "claim" → afirmar when afirmar's gloss is "affirm, claim"
    // (afirmar is a secondary meaning of "claim", not the primary one).
    const primary = glossString.split(",")[0]?.trim().toLowerCase();
    if (!primary || primary.length === 0) continue;

    const existing = index.get(primary);
    if (existing) {
      existing.push(entry.lemmaId);
    } else {
      index.set(primary, [entry.lemmaId]);
    }
  }
  return index;
}

export class CefrLexAtlasProvider implements LexicalAtlasProvider {
  private readonly cache = new Map<string, CefrLexDataFile>();
  private readonly glossIndexCache: GlossReverseIndex = new Map();

  constructor(
    private readonly dataByLang: Partial<
      Record<string, CefrLexDataFile>
    > = DEFAULT_ATLAS_DATA
  ) {}

  load(lang: string): CefrLexDataFile {
    const cached = this.cache.get(lang);
    if (cached) {
      return cached;
    }

    const data = this.dataByLang[lang];
    if (!data) {
      throw new Error(`Missing sugarlang cefrlex data for language "${lang}".`);
    }

    assertValidAtlasFile(data, lang);
    this.cache.set(lang, data);
    return data;
  }

  getLemma(lemmaId: string, lang: string): AtlasLemmaEntry | undefined {
    return this.load(lang).lemmas[lemmaId];
  }

  getBand(lemmaId: string, lang: string): CEFRBand | undefined {
    return this.getLemma(lemmaId, lang)?.cefrPriorBand;
  }

  getFrequencyRank(lemmaId: string, lang: string): number | undefined {
    return this.getLemma(lemmaId, lang)?.frequencyRank ?? undefined;
  }

  getGloss(lemmaId: string, lang: string, supportLang: string): string | undefined {
    return this.getLemma(lemmaId, lang)?.glosses?.[supportLang];
  }

  resolveFromGloss(glossWord: string, lang: string, supportLang: string): AtlasLemmaEntry[] {
    const index = this.getGlossIndex(lang, supportLang);
    const lemmaIds = index.get(glossWord.trim().toLowerCase());
    if (!lemmaIds) return [];

    const data = this.load(lang);
    return lemmaIds
      .map((id) => data.lemmas[id])
      .filter((entry) => entry !== undefined);
  }

  listLemmasAtBand(band: CEFRBand, lang: string): LemmaRef[] {
    return Object.values(this.load(lang).lemmas)
      .filter((entry) => entry.cefrPriorBand === band)
      .sort(
        (left, right) => (left.frequencyRank ?? 0) - (right.frequencyRank ?? 0)
      )
      .map((entry) => ({
        lemmaId: entry.lemmaId,
        lang: entry.lang
      }));
  }

  getAtlasVersion(lang: string): string {
    return this.load(lang).atlasVersion;
  }

  private getGlossIndex(lang: string, supportLang: string): Map<string, string[]> {
    const key = `${lang}:${supportLang}`;
    const cached = this.glossIndexCache.get(key);
    if (cached) return cached;

    const data = this.load(lang);
    const index = buildGlossReverseIndex(data, supportLang);
    this.glossIndexCache.set(key, index);
    return index;
  }
}
