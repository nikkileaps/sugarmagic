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

export class CefrLexAtlasProvider implements LexicalAtlasProvider {
  private readonly cache = new Map<string, CefrLexDataFile>();

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

  getLemma(_lemmaId: string, _lang: string): AtlasLemmaEntry | undefined {
    return this.load(_lang).lemmas[_lemmaId];
  }

  getBand(_lemmaId: string, _lang: string): CEFRBand | undefined {
    return this.getLemma(_lemmaId, _lang)?.cefrPriorBand;
  }

  getFrequencyRank(_lemmaId: string, _lang: string): number | undefined {
    return this.getLemma(_lemmaId, _lang)?.frequencyRank ?? undefined;
  }

  listLemmasAtBand(_band: CEFRBand, _lang: string): LemmaRef[] {
    return Object.values(this.load(_lang).lemmas)
      .filter((entry) => entry.cefrPriorBand === _band)
      .sort(
        (left, right) => (left.frequencyRank ?? 0) - (right.frequencyRank ?? 0)
      )
      .map((entry) => ({
        lemmaId: entry.lemmaId,
        lang: entry.lang
      }));
  }

  getAtlasVersion(_lang: string): string {
    return this.load(_lang).atlasVersion;
  }
}
