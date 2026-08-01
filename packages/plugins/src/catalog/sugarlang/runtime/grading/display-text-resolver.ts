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
import { CEFR_BAND_ORDER as BAND_ORDER } from "../learner";
import type { GradedTextSource } from "../contracts/graded-text";
import type { SugarlangVariantCache } from "../compile/variant-cache";
import type { LexicalAtlasProvider } from "../types";
import { buildItemViewContentHash } from "./sources/item-view-source";
import { markGradedText } from "./graded-text-marker";
import { postureForBand } from "../teacher/band-envelope";
import { getAllInventoryChunks } from "../inventory/competency-inventory-loader";

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
 * Variants are deliberately not baked below B1 today -- a full target-language
 * paragraph is unreadable to a beginner. 090.11 changes that by baking
 * beginner-appropriate variants instead of substituting at runtime.
 */

// 090.9: was a local copy named BAND_ORDER, one of six.

/**
 * Every band at or below the learner's, so the pool is "all the vocabulary this
 * level admits" rather than a ranked shortlist.
 */
function bandsUpTo(band: CEFRBand): CEFRBand[] {
  const index = BAND_ORDER.indexOf(band);
  return index < 0 ? [band] : BAND_ORDER.slice(0, index + 1);
}

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

/** Everything the A1/A2 weave path needs, resolved lazily. */
export interface WeaveInputs {
  atlas: LexicalAtlasProvider;
  /** Learner's band -- the pool is every lemma at or below it. */
  band: CEFRBand;
  supportLanguage: string;
}

export interface DisplayTextResolverDeps {
  /** Undefined with no studio workspace. Only the B1+ path needs it. */
  getVariantCache: () => SugarlangVariantCache | undefined;
  getTargetLanguage: () => string | null;
  getLearnerBand: () => Promise<CEFRBand | null>;
  promptVersion: string;
  /**
   * Resolves the weave inputs, or null when they are unavailable (no learner,
   * no scene lexicon yet). Omitting it disables weaving entirely; the resolver
   * still answers, with authored text.
   */
  getWeaveInputs?: () => Promise<WeaveInputs | null>;
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

      // A1/A2 splice target words into the authored English rather than reading
      // a baked variant -- there are none below B1, by design. Without this
      // branch a beginner sees plain English on every item forever, which is
      // exactly the bug this fixes.
      const posture = postureForBand(band);
      if (posture === "anchored" || posture === "supported") {
        return (await markText(request.text, lang, deps)) ?? request.text;
      }

      const cache = deps.getVariantCache();
      if (!cache) return request.text;

      const entry = await cache.get({
        lang,
        band,
        contentHash: mapped.contentHash,
        variantPromptVersion: deps.promptVersion
      });
      if (!entry) return request.text;

      // A flagged record failed one of the four gates. Showing it would put
      // text in front of a learner that the verifiers already judged wrong for
      // their band -- worse than showing English.
      if (entry.variant.reviewFlag) return request.text;

      return entry.variant.text || request.text;
    } catch {
      return request.text;
    }
  };
}

/**
 * Splice target-language citation forms into authored English.
 *
 * The substitution pool is every lemma at or below the learner's band, straight
 * from the atlas. The budgeter is deliberately NOT consulted -- see the
 * "WHY ITEM TEXT DOES NOT GO THROUGH THE BUDGETER" block at the top of this
 * file for the reasoning and the 090 revisit.
 *
 * Returns null whenever anything is missing or nothing was substituted, and the
 * caller falls back to the authored text. Total, like the rest of the resolver.
 */
async function markText(
  text: string,
  targetLang: string,
  deps: DisplayTextResolverDeps
): Promise<string | null> {
  if (!deps.getWeaveInputs) return null;
  const inputs = await deps.getWeaveInputs();
  if (!inputs) return null;

  let inventoryChunks: ReturnType<typeof getAllInventoryChunks> = [];
  try {
    inventoryChunks = getAllInventoryChunks(targetLang);
  } catch {
    // No inventory for this language -- weave proceeds without chunk swaps.
  }

  // Every lemma the learner's level admits, as the substitution pool.
  const pool = bandsUpTo(inputs.band).flatMap((band) =>
    inputs.atlas.listLemmasAtBand(band, targetLang)
  );

  const result = markGradedText(
    text,
    pool,
    inventoryChunks,
    inputs.atlas,
    targetLang,
    inputs.supportLanguage
  );
  // No substitution is not a failure -- it means nothing prescribed appears in
  // this text. Returning null keeps the authored English rather than the
  // identical string the weave just handed back.
  return result.markedForms.length > 0 ? result.text : null;
}
