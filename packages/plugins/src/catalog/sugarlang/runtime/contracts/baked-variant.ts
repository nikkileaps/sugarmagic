/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/baked-variant.ts
 *
 * Purpose: Re-exports the generalised graded-text contracts under the names the
 * dialogue-era call sites still use.
 *
 * Exports:
 *   - VariantVerdict
 *   - BakedLineVariant (alias of GradedTextRecord)
 *   - BakedVariantStore
 *
 * Relationships:
 *   - Everything real now lives in ./graded-text. This file exists so dialogue
 *     call sites keep reading naturally.
 *
 * Implements: Epic 086 Story 086.3
 *
 * Status: active
 *
 * WHY THIS IS NOW AN ALIAS (2026-07-28)
 *
 * `BakedLineVariant` required `nodeId` and `dialogueDefinitionId` at the top
 * level, which kept the STORAGE contract dialogue-shaped even after the grading
 * algorithm had been generalised -- item text has neither field and would have
 * had to invent them.
 *
 * The record is now `GradedTextRecord`, whose `source` is a discriminated union
 * over content kinds. `BakedLineVariant` survives only as a spelling of it.
 *
 * The migration cost nothing: `promptVersion` is a leg of the variant cache key
 * and was bumped in the same change, so every previously stored record was
 * already unreachable. Old rows linger as garbage until eviction and are never
 * read.
 */

import type { CEFRBand } from "../cefr";
import type { GradedTextRecord } from "./graded-text";

export type {
  GradedTextRecord as BakedLineVariant,
  VariantVerdict
} from "./graded-text";

/**
 * In-memory collection keyed lang -> band -> source key -> record.
 *
 * The innermost key was `nodeId`; it is now `gradedTextSourceKey(record.source)`
 * so item and spell records fit the same shape. Contract-side only -- the live
 * path uses the flat variant cache.
 */
export type BakedVariantStore = Map<
  string,
  Map<CEFRBand, Map<string, GradedTextRecord>>
>;

/**
 * 090.11: the bands that get a baked variant, and the single source of truth
 * for it.
 *
 * This list existed in THREE places -- the authoring client, the dialogue
 * variants popover, and the item-view variants panel -- all spelling
 * `["B1","B2","C1","C2"]` independently. Turning A1/A2 on meant editing one and
 * silently leaving two: the bake produced beginner variants that no Studio
 * surface would show, which reads as "the feature did not work" rather than
 * "one list disagreed with another".
 *
 * A1 and A2 are included as of 090.11. Beginner lines were the last ones
 * realized at runtime by token substitution; they are baked like every other
 * band now.
 */
export const VARIANT_BANDS: readonly CEFRBand[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2"
] as const;
