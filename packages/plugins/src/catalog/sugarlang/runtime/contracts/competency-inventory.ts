/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/competency-inventory.ts
 *
 * Purpose: Declares the competency inventory types used by the curriculum spine.
 *
 * Exports:
 *   - INTERPRET_LEXICON_CATEGORIES
 *   - InterpretLexiconCategory
 *   - Exponent
 *   - Lesson
 *   - Competency
 *   - CompetencyInventory
 *
 * Relationships:
 *   - Consumed by competency-inventory-loader, competency-tag-resolver, and teacher middleware.
 *   - The inventory data lives in data/languages/{lang}/competency-inventory.json.
 *   - An Exponent joins to a scene-extracted LexicalChunk on normalizedForm.
 *
 * Implements: Plan 085 story 085.2
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";

/** Four interpretLexicon categories consumed by interpretation.ts's detectSocialMove. */
export const INTERPRET_LEXICON_CATEGORIES = [
  "farewell",
  "greeting",
  "gratitude",
  "acknowledgement"
] as const;

export type InterpretLexiconCategory = (typeof INTERPRET_LEXICON_CATEGORIES)[number];

/**
 * A phrase that performs a competency in one language.
 *
 * Not the same thing as a chunk. A chunk is any multi-word expression the
 * scene extractor found in text; an exponent is specifically a phrase that
 * performs THIS competency. The two share a shape and a join key
 * (normalizedForm) because the same matcher scans text for both.
 */
export interface Exponent {
  exponentId: string;
  /** Underscore-normalized lowercase form -- join key to SceneVocabularyModel.chunks. */
  normalizedForm: string;
  /** Human-readable surface variants (may include diacritics, punctuation). */
  surfaceForms: string[];
  cefrBand: CEFRBand;
  constituentLemmas: string[];
  /**
   * Every spelling to what it means, per support language. Keyed by surface
   * form so a hover answers from the text it matched: `qué significa` reads
   * "what does it mean" though it shares an exponent with `qué es`.
   */
  glossBySurface: Record<string, Record<string, string>>;
}

/** One topic within a band. `A1.5` is band plus ordinal, derived and not stored. */
export interface Lesson {
  lessonId: string;
  band: CEFRBand;
  ordinal: number;
  displayName: string;
}

/**
 * One competency entry in the hand-curated inventory.
 */
export interface Competency {
  competencyId: string;
  /** The lesson this belongs to. Exactly one. */
  lessonId: string;
  displayName: string;
  /** CEFR can-do descriptor (human-readable, not machine-actionable). */
  cefrDescriptor: string;
  band: CEFRBand;
  /**
   * If set, this function is taught only to learners at or above this band.
   * "Gated below A2" means: if evaluatedCefrBand < A2, the station manager
   * introduces these chunks; they are not left for encounter discovery.
   * The gate is a band threshold, not per-chunk placement evidence.
   */
  placementGateBand?: CEFRBand;
  /**
   * True for meta-language (item-zero) chunks:
   * "Que es?", "No entiendo", "Mas despacio", "Como se dice?".
   * These are always taught regardless of CEFR level.
   */
  isItemZero?: boolean;
  /**
   * When set, this function's chunk surface forms feed the interpretLexicon
   * contribution for the named category. Only the four categories consumed
   * by interpretation.ts are valid. Item-zero recognition waits for epic F.
   */
  interpretLexiconCategory?: InterpretLexiconCategory;
  /** Performing phrases per language (BCP-47 key, e.g. "es"). */
  exponents: Record<string, Exponent[]>;
}

/**
 * The competency inventory for one language.
 *
 * GENERATED. Built from data/curriculum/<band>.json and
 * data/languages/<lang>/exponents.json by
 * scripts/data-prep/build-competency-inventory.ts. Do not hand-edit.
 */
export interface CompetencyInventory {
  schemaVersion: "2";
  lang: string;
  lessons: Lesson[];
  competencies: Competency[];
}
