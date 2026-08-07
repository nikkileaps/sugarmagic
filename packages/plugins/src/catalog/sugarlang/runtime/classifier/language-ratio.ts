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
 * The ceiling above which a reply is carrying too MUCH target language.
 *
 * Deliberately looser than the floor and not posture-keyed. Overshoot is a
 * comprehensibility failure -- a beginner drowning -- and the tolerance should
 * scale with how much target language was asked for: 0.3 directed allows up to
 * 0.6, while 0.85 directed allows essentially anything, because at that posture
 * the learner is expected to swim.
 *
 * The absolute floor of 0.35 keeps a very low directed ratio from making the
 * ceiling so tight that ordinary lumpy prose trips it. Text is not smooth; one
 * Spanish clause in a short reply is a big fraction.
 */
function resolveFailCeiling(directedRatio: number): number {
  return Math.max(0.35, Math.min(1, directedRatio * 2));
}

/**
 * Compute the language-ratio verdict from a coverage profile.
 *
 * measuredRatio = resolvedTargetLanguageTokens / ratioCheckTokens.
 * Returns conformance "skipped" below MIN_RATIO_CHECK_DENOMINATOR.
 * Returns "under-ratio" when measuredRatio is grossly below the directed target,
 * and "over-ratio" when it is grossly above -- both directions are failures, and
 * only the first one used to exist.
 *
 * THIS NUMBER IS AN INSTRUMENT, NOT A BAR. Do not promote it to a gate or a
 * quality threshold without reading sugarmagic-latency-en3 first.
 *
 * Deciding how much of a MIXED line is target language keeps being wrong in a
 * new way each time the last way is fixed. Morphology homographs (too -> toar,
 * he -> haber) were fixed by the english-collisions guard; live play then
 * produced more of them (snack, fine); and then a different cause entirely --
 * `look` and `sandwich` are genuine Spanish LOANWORDS in the atlas, so English
 * text collides with a real Spanish lemma and no morphology fix touches it.
 * The set of failure classes has not closed.
 *
 * nikki deferred baselining it on 2026-08-06 for exactly that reason, and the
 * epic's principle is the general form: code MEASURES, the model JUDGES.
 * Whether a line suits this learner is the Judge's call (sugarmagic-latency-tsg).
 *
 * REVISIT TRIGGER: if the Judge-side language check ever produces a flag rate
 * that itself needs validating, a trustworthy ratio becomes worth building --
 * and it will need a real answer to loanwords, not another word list.
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
  const failCeiling = resolveFailCeiling(directedRatio);
  const conformance: RatioConformance =
    measuredRatio < failFloor
      ? "under-ratio"
      : measuredRatio > failCeiling
        ? "over-ratio"
        : "conformant";

  return { measuredRatio, directedRatio, posture, conformance };
}
