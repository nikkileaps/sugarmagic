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

import type { CEFRBand, LearnerProfile } from "../contracts/learner-profile";
import type { GradedTextSource } from "../contracts/graded-text";
import type { SugarlangVariantCache } from "../compile/variant-cache";
import type { LexicalPrescription } from "../contracts/lexical-prescription";
import type { CompiledSceneLexicon, LexicalAtlasProvider } from "../types";
import { buildItemViewContentHash } from "./sources/item-view-source";
import { diglotWeave } from "../classifier/diglot-weave";
import { getAllInventoryChunks } from "../inventory/function-inventory-loader";

/**
 * Which bands weave instead of reading a baked variant.
 *
 * MIRRORS the scripted dialogue split exactly (sugar-lang-teacher-middleware:
 * A1 -> anchored, A2 -> supported, else target-dominant). It has to: item text
 * and dialogue are graded by the same pipeline for the same learner, so if they
 * split at different bands you get a Spanish paragraph on an item and woven
 * English on the line right after it.
 *
 * Variants are deliberately not baked below B1 -- a full target-language
 * paragraph is unreadable to a beginner, which is the whole reason the weave
 * exists.
 */
function isWeaveBand(band: CEFRBand): boolean {
  return band === "A1" || band === "A2";
}

/**
 * How many of the budgeter's scored survivors the weave may draw from.
 *
 * Not a teaching budget -- these are candidates for SUBSTITUTION in one piece
 * of text, and only the ones that actually appear get used. Too small and the
 * pool misses the text entirely (the bug this constant exists to fix); too
 * large and an anchored A1 paragraph comes back mostly Spanish, since
 * diglotWeave swaps every match and has no ratio control of its own.
 */
const WEAVE_POOL_SIZE = 20;

/** What the host passes in. Mirrors runtime-core's `DisplayTextRequest`. */
export interface DisplayTextResolveRequest {
  subjectKind: string;
  subjectId: string;
  field: string;
  text: string;
}

/** Everything the A1/A2 weave path needs, resolved lazily. */
export interface WeaveInputs {
  learner: LearnerProfile;
  sceneLexicon: CompiledSceneLexicon;
  atlas: LexicalAtlasProvider;
  prescribe: (input: {
    learner: LearnerProfile;
    sceneLexicon: CompiledSceneLexicon;
    conversationState: Record<string, unknown>;
  }) => Promise<LexicalPrescription>;
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
      if (isWeaveBand(band)) {
        return (await weaveText(request.text, lang, deps)) ?? request.text;
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
 * Splice target-language citation forms into authored English, using the SAME
 * budgeter prescription the dialogue weave uses -- so an item teaches the same
 * words the conversation is teaching, rather than a second opinion.
 *
 * Returns null whenever anything is missing or nothing was substituted, and the
 * caller falls back to the authored text. Total, like the rest of the resolver.
 */
async function weaveText(
  text: string,
  targetLang: string,
  deps: DisplayTextResolverDeps
): Promise<string | null> {
  if (!deps.getWeaveInputs) return null;
  const inputs = await deps.getWeaveInputs();
  if (!inputs) return null;

  const prescription = await inputs.prescribe({
    learner: inputs.learner,
    sceneLexicon: inputs.sceneLexicon,
    conversationState: { nowMs: Date.now() }
  });

  let inventoryChunks: ReturnType<typeof getAllInventoryChunks> = [];
  try {
    inventoryChunks = getAllInventoryChunks(targetLang);
  } catch {
    // No inventory for this language -- weave proceeds without chunk swaps.
  }

  // WEAVE FROM THE ELIGIBLE POOL, NOT THE TEACHING SLATE.
  //
  // `prescription.introduce` is the top `levelCap` (3-5) words the budgeter
  // wants to TEACH next across the whole scene. The weave asks a different
  // question: which band-appropriate words happen to appear in THIS text? Those
  // rarely intersect -- measured on a real scene, `introduce` was
  // [estación, área, vuestro] while the item's prose was about travellers,
  // heads and flying, so every substitution missed and the item rendered as
  // plain English.
  //
  // `rationale.priorityScores` is the full envelope-survivor set (~49 there),
  // already band-filtered and quest-essential-filtered by the budgeter, ordered
  // by score. Drawing from it is what makes a weave actually land.
  //
  // Capped because diglotWeave substitutes EVERY match it finds and has no
  // ratio control: an uncapped pool turns an anchored A1 paragraph mostly
  // Spanish, which is the opposite of the posture. Top-N by score keeps the
  // best-scoring words while holding substitutions to a handful per paragraph.
  const pool = (prescription.rationale?.priorityScores ?? [])
    .slice(0, WEAVE_POOL_SIZE)
    .map((score) => score.lemmaRef);

  const result = diglotWeave(
    text,
    pool.length > 0 ? pool : prescription.introduce,
    inventoryChunks,
    inputs.atlas,
    targetLang,
    inputs.supportLanguage
  );
  // No substitution is not a failure -- it means nothing prescribed appears in
  // this text. Returning null keeps the authored English rather than the
  // identical string the weave just handed back.
  return result.weavedForms.length > 0 ? result.text : null;
}
