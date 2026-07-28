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

import type { CEFRBand } from "../contracts/learner-profile";
import type { GradedTextSource } from "../contracts/graded-text";
import type { SugarlangVariantCache } from "../compile/variant-cache";
import { buildItemViewContentHash } from "./sources/item-view-source";

/** What the host passes in. Mirrors runtime-core's `DisplayTextRequest`. */
export interface DisplayTextResolveRequest {
  subjectKind: string;
  subjectId: string;
  field: string;
  text: string;
}

export interface DisplayTextResolverDeps {
  /** Null when there is no learner yet, or no studio workspace to cache in. */
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

      const cache = deps.getVariantCache();
      const lang = deps.getTargetLanguage();
      if (!cache || !lang) return request.text;

      const band = await deps.getLearnerBand();
      if (!band) return request.text;

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
