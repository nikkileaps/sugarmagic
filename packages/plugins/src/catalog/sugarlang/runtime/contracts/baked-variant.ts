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
 * A1 and A2 are included as of 090.11 -- for DIALOGUE. Beginner dialogue lines
 * were the last ones realized at runtime by token substitution; they are baked
 * like every other band now.
 *
 * ITEMS USED TO BE DIFFERENT ON PURPOSE (until 2026-08-02). The resolver
 * short-circuited A1/A2 item text to a runtime SUBSTITUTION before it ever
 * consulted the variant cache, so a baked beginner item variant would have been
 * generated, stored, billed -- and never read. That substitution is deleted and
 * the item bake now passes posture, so both lists are the same set.
 *
 * THEY ARE STILL TWO CONSTANTS, deliberately. They were one decision each, not
 * one shared decision, and an earlier attempt to collapse them made items sprout
 * empty rows in the Studio panel and bake variants nothing would display. Keep
 * them separable so items can diverge again without a merge conflict of
 * meaning.
 */
export const DIALOGUE_VARIANT_BANDS: readonly CEFRBand[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2"
] as const;

/**
 * Bands that get a baked ITEM variant -- every band, matching
 * `DIALOGUE_VARIANT_BANDS`.
 *
 * THE POSTURE PREREQUISITE IS DONE (2026-08-02). This list stopped at B1 with a
 * warning: the item bake called `GradedTextService.adapt` WITHOUT a posture, so
 * it fell to `DEFAULT_POSTURE` (`target-dominant`, ~85% target language), and a
 * beginner item would have been written almost entirely in the target language
 * then measured against the anchored envelope it was never shown.
 * `ui/shell/editor-support.ts` now passes `postureForBand(band)` and its
 * directed ratio, as the dialogue bake has since 090.11.
 *
 * Beginner item text used to be SUBSTITUTED at runtime instead of baked. That
 * mechanism is deleted: item text reads a baked variant and falls back to the
 * authored English, exactly as dialogue does.
 */
export const ITEM_VARIANT_BANDS: readonly CEFRBand[] = DIALOGUE_VARIANT_BANDS;
