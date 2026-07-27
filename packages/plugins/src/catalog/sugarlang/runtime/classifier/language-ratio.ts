/**
 * packages/plugins/src/catalog/sugarlang/runtime/classifier/language-ratio.ts
 *
 * Purpose: Deterministic target-language ratio verdict from a coverage profile.
 *
 * Exports:
 *   - MIN_RATIO_CHECK_DENOMINATOR
 *   - computeLanguageRatioVerdict
 *
 * Relationships:
 *   - Depends on CoverageProfile counters added in 083.1.
 *   - Consumed by EnvelopeClassifier.check() and by the 083.2 candidate scorer.
 *
 * Implements: Plan 083 story 083.1
 *
 * Status: active
 */

import type { CoverageProfile, LanguageRatioVerdict, RatioConformance } from "../contracts/envelope";
import type { SupportPosture } from "../contracts/pedagogy";

/** Below this many word-tokens in the ratio denominator the check is skipped. Handles short turns like "Si, Ana." */
export const MIN_RATIO_CHECK_DENOMINATOR = 4;

function resolveFailFloor(posture: SupportPosture, directedRatio: number): number {
  switch (posture) {
    case "anchored":
      return Math.max(0.1, directedRatio * 0.4);
    case "supported":
      return Math.max(0.2, directedRatio * 0.5);
    case "target-dominant":
      return Math.max(0.3, directedRatio * 0.6);
    case "target-only":
      // 1.0 is unreachable with OOV noise; use a fixed floor meaningfully below 1.0.
      return 0.7;
    default: {
      const _exhaustive: never = posture;
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Compute the language-ratio verdict from a coverage profile.
 *
 * measuredRatio = resolvedTargetLanguageTokens / ratioCheckTokens.
 * Returns conformance "skipped" below MIN_RATIO_CHECK_DENOMINATOR.
 * Returns "under-ratio" when measuredRatio is grossly below the directed target.
 */
export function computeLanguageRatioVerdict(
  profile: CoverageProfile,
  directedRatio: number,
  posture: SupportPosture
): LanguageRatioVerdict {
  const denominator = profile.ratioCheckTokens;
  const measuredRatio = denominator === 0 ? 1 : profile.resolvedTargetLanguageTokens / denominator;

  if (denominator < MIN_RATIO_CHECK_DENOMINATOR) {
    return { measuredRatio, directedRatio, posture, conformance: "skipped" };
  }

  const failFloor = resolveFailFloor(posture, directedRatio);
  const conformance: RatioConformance = measuredRatio < failFloor ? "under-ratio" : "conformant";

  return { measuredRatio, directedRatio, posture, conformance };
}
