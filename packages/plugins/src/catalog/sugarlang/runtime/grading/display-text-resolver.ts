/**
 * packages/plugins/src/catalog/sugarlang/runtime/grading/display-text-resolver.ts
 *
 * Purpose: Runtime side of grading. Answers "is there a graded version of this
 * authored string for this learner?" for any surface that asks.
 *
 * Exports:
 *   - createDisplayTextResolver
 *   - toGradedTextSource
 *
 * Relationships:
 *   - Implements runtime-core's `displayText.resolver` contribution payload.
 *   - Reads the variant cache and the learner's band; writes nothing.
 *
 * Implements: Epic 086 Story 086.3 (runtime seam, 2026-07-28)
 *
 * Status: active
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT, AND WHY IT IS TOTAL
 *
 * `resolve` ALWAYS returns a string, and returns the authored text unchanged
 * whenever it cannot do better -- no learner, no cache, no band, no hit, a
 * thrown error, anything. It never throws and never returns empty.
 *
 * That is what makes the feature safe to be absent. runtime-core hands over the
 * authored text and renders whatever comes back, so the worst case is a no-op.
 * Disable sugarlang and no resolver is registered at all, so the same authored
 * text renders by a shorter path. Neither case needs a fallback branch in the
 * host, which is the point: "the game still works in plain English" is a
 * property of the shape, not a code path someone has to remember to test.
 *
 * WHY IT READS THE SAME CACHE AS DIALOGUE
 *
 * Grading is one pipeline. A graded item description is the same kind of thing
 * as a graded dialogue line -- same verdict gates, same cache key
 * (`promptVersion:lang:band:contentHash`), same storage. Only the
 * `GradedTextSource` differs. A second cache would mean a second eviction
 * policy, a second report and a second thing to invalidate.
 */

import type { CEFRBand } from "../cefr";
import type { GradedTextSource } from "../contracts/graded-text";
import type { SugarlangVariantCache } from "../compile/variant-cache";
import { buildItemViewContentHash } from "./sources/item-view-source";

/**
 * 090.8a DELETED `isWeaveBand`.
 *
 * It was a second copy of the band->posture split (`postureForBand`,
 * band-envelope.ts), which let this module choose its own strategy instead of
 * reading the posture. Callers now ask `postureForBand` directly.
 *
 * The reason the two had to agree is unchanged and still worth knowing: item
 * text and dialogue are graded by the same pipeline for the same learner, so if
 * they split at different bands you get a Spanish paragraph on an item and
 * marked-up English on the line right after it. Sharing one definition is how
 * that stays true rather than how it happens to be true.
 *
 * 2026-08-02: moot HERE now -- every band reads a baked variant and there is no
 * second strategy to keep in step. Beginner variants are baked at the anchored
 * ratio (ITEM_VARIANT_BANDS), which is what 090.11 promised and what made
 * runtime substitution unnecessary.
 */

/*
 * WHY ITEM TEXT DOES NOT GO THROUGH THE BUDGETER (nikki, 2026-07-28)
 *
 * This is a GAMEPLAY DECISION, not an oversight, and not a shortcut taken for
 * implementation convenience. Read this before "fixing" it.
 *
 * The budgeter answers a PACING question: given this scene and this learner,
 * what few words should we teach next, and how many. That is the right question
 * for a conversation, where turns arrive in sequence and the learner is being
 * walked somewhere.
 *
 * An item the player chose to examine is a different moment. They stopped, they
 * opened it, they are reading. There is no pacing budget to protect -- the
 * player is browsing, not being led -- and the interesting thing is how much of
 * the level's vocabulary this object can surface. So the pool here is EVERY
 * lemma at or below the learner's band, and dense substitution is a feature: a
 * wordy item should read as a wordy item in the target language.
 *
 * The mechanical reason it could not have worked the old way is worth keeping
 * too. Candidates used to come from the budgeter's top-N slate for the whole
 * SCENE, which almost never intersects one specific paragraph -- measured on a
 * real scene the slate was [estación, área, vuestro] while the item prose was
 * about travellers, heads and flying. Every substitution missed and items
 * rendered as plain English every single time.
 *
 * WHAT THIS STILL DOES NOT DO: it matches only words LITERALLY present in the
 * text. What a text is ABOUT but never says -- the Finnick/cheese case -- needs
 * Plan 090's situation/concept layer. This is the deterministic half only.
 *
 * REVISIT AFTER 090, AS A DECISION RATHER THAN A CLEANUP. Once 090 can say
 * "here is what is worth teaching at this moment", reconsider whether item text
 * should consult it -- and whether dense substitution still reads well once
 * concepts are being chosen deliberately. Depending on how 090 lands, the
 * answer may legitimately remain "items ignore the budgeter". Do not assume
 * this is scaffolding to be deleted; it is a position to re-evaluate.
 * See docs/plans/090-concept-opportunity-scanner-epic.md.
 */

/** What the host passes in. Mirrors runtime-core's `DisplayTextRequest`. */
export interface DisplayTextResolveRequest {
  subjectKind: string;
  subjectId: string;
  field: string;
  text: string;
}

export interface DisplayTextResolverDeps {
  /** Undefined with no studio workspace. Only the B1+ path needs it. */
  getVariantCache: () => SugarlangVariantCache | undefined;
  getTargetLanguage: () => string | null;
  getLearnerBand: () => Promise<CEFRBand | null>;
  promptVersion: string;
}

/**
 * Map a host request onto a graded-text source and its content hash.
 *
 * Returns null for subject kinds sugarlang does not grade, which is how the
 * resolver stays inert for content it has nothing to say about rather than
 * guessing at a hash that would never hit.
 */
export function toGradedTextSource(
  request: DisplayTextResolveRequest
): { source: GradedTextSource; contentHash: string } | null {
  if (request.subjectKind === "item-view") {
    if (request.field !== "title" && request.field !== "body") return null;
    return {
      source: {
        kind: "item-view",
        itemDefinitionId: request.subjectId,
        field: request.field
      },
      contentHash: buildItemViewContentHash(
        request.subjectId,
        request.field,
        request.text
      )
    };
  }
  return null;
}

export function createDisplayTextResolver(deps: DisplayTextResolverDeps) {
  return async function resolve(
    request: DisplayTextResolveRequest
  ): Promise<string> {
    try {
      const mapped = toGradedTextSource(request);
      if (!mapped) return request.text;

      const lang = deps.getTargetLanguage();
      if (!lang) return request.text;

      const band = await deps.getLearnerBand();
      if (!band) return request.text;

      // 2026-08-02: A1/A2 used to splice target words into the authored English
      // here rather than read a baked variant, because none were baked below B1.
      // Both halves are gone -- beginner item variants ARE baked now (see
      // ITEM_VARIANT_BANDS), and nothing in this system rewrites finished text.
      // Item text behaves exactly like dialogue: a baked variant if there is
      // one, the authored English if there is not.
      const cache = deps.getVariantCache();
      if (!cache) return request.text;

      const entry = await cache.get({
        lang,
        band,
        contentHash: mapped.contentHash,
        variantPromptVersion: deps.promptVersion
      });
      if (!entry) return request.text;

      // Flagged records (a failed verifier gate) still show. The flag is a
      // review aid for the author in Studio, not a runtime veto: the item
      // variants panel names the failing gates, and whatever the author
      // leaves baked is what the player reads. (Story #200 - the envelope
      // gate is calibrated for dialogue pacing and legitimately fails full
      // item translations.)
      return entry.variant.text || request.text;
    } catch {
      return request.text;
    }
  };
}

