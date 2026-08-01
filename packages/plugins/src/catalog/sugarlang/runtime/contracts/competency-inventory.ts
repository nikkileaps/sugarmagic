/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/competency-inventory.ts
 *
 * Purpose: Declares the hand-curated competency inventory types used by the curriculum spine.
 *
 * Exports:
 *   - INTERPRET_LEXICON_CATEGORIES
 *   - InterpretLexiconCategory
 *   - InventoryChunk
 *   - Competency
 *   - CompetencyInventory
 *
 * Relationships:
 *   - Consumed by competency-inventory-loader, competency-tag-resolver, and teacher middleware.
 *   - The inventory data lives in data/languages/{lang}/competency-inventory.json.
 *   - InventoryChunk mirrors LexicalChunk minus extraction metadata; the join field is normalizedForm.
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
 * A hand-curated formulaic sequence that realizes a competency.
 * Mirrors LexicalChunk but without LLM extraction metadata.
 * Join key to scene-extracted chunks: normalizedForm.
 */
export interface InventoryChunk {
  chunkId: string;
  /** Underscore-normalized lowercase form -- join key to SceneVocabularyModel.chunks. */
  normalizedForm: string;
  /** Human-readable surface variants (may include diacritics, punctuation). */
  surfaceForms: string[];
  cefrBand: CEFRBand;
  constituentLemmas: string[];
}

/**
 * One competency entry in the hand-curated inventory.
 */
export interface Competency {
  competencyId: string;
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
  /** Realizing chunks per language (BCP-47 key, e.g. "es"). */
  chunks: Record<string, InventoryChunk[]>;
}

/**
 * The full hand-curated competency inventory for one language.
 */
export interface CompetencyInventory {
  schemaVersion: "1";
  lang: string;
  competencies: Competency[];
}
