/**
 * packages/plugins/src/catalog/sugarlang/tests/classifier/language-ratio.test.ts
 *
 * Purpose: Unit tests for the deterministic language-ratio verdict function.
 *
 * Exports:
 *   - none
 *
 * Relationships:
 *   - Depends on ../../runtime/classifier/language-ratio.
 *
 * Implements: Plan 083 story 083.1
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import {
  MIN_RATIO_CHECK_DENOMINATOR,
  computeLanguageRatioVerdict
} from "../../runtime/classifier/language-ratio";
import type { CoverageProfile } from "../../runtime/types";

function makeProfile(
  ratioCheckTokens: number,
  resolvedTargetLanguageTokens: number
): CoverageProfile {
  return {
    totalTokens: ratioCheckTokens,
    knownTokens: resolvedTargetLanguageTokens,
    inBandTokens: resolvedTargetLanguageTokens,
    unknownTokens: ratioCheckTokens - resolvedTargetLanguageTokens,
    bandHistogram: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
    outOfEnvelopeLemmas: [],
    ceilingExceededLemmas: [],
    questEssentialLemmasMatched: [],
    matchedChunks: [],
    matchedChunkTokens: [],
    coverageRatio: ratioCheckTokens === 0 ? 1 : resolvedTargetLanguageTokens / ratioCheckTokens,
    ratioCheckTokens,
    resolvedTargetLanguageTokens
  };
}

describe("computeLanguageRatioVerdict", () => {
  it("returns skipped below the minimum-denominator guard", () => {
    const profile = makeProfile(MIN_RATIO_CHECK_DENOMINATOR - 1, 0);
    const verdict = computeLanguageRatioVerdict(profile, 0.85, "target-dominant");
    expect(verdict.conformance).toBe("skipped");
  });

  it("returns skipped for empty turn (denominator = 0)", () => {
    const profile = makeProfile(0, 0);
    const verdict = computeLanguageRatioVerdict(profile, 0.85, "target-dominant");
    expect(verdict.conformance).toBe("skipped");
    expect(verdict.measuredRatio).toBe(1);
  });

  it("returns under-ratio for 100% English turn at target-dominant B2 (the playtest bug)", () => {
    // 8 word tokens, none resolve in Spanish -> measuredRatio = 0
    const profile = makeProfile(8, 0);
    const verdict = computeLanguageRatioVerdict(profile, 0.85, "target-dominant");
    expect(verdict.conformance).toBe("under-ratio");
    expect(verdict.measuredRatio).toBe(0);
    expect(verdict.directedRatio).toBe(0.85);
    expect(verdict.posture).toBe("target-dominant");
  });

  it("returns conformant for a 50/50 Spanish/English mix at supported posture", () => {
    // 10 tokens, 5 resolve in Spanish -> measuredRatio = 0.5
    // supported floor = max(0.2, 0.65 * 0.5) = 0.325 -> 0.5 >= 0.325 -> conformant
    const profile = makeProfile(10, 5);
    const verdict = computeLanguageRatioVerdict(profile, 0.65, "supported");
    expect(verdict.conformance).toBe("conformant");
    expect(verdict.measuredRatio).toBeCloseTo(0.5);
  });

  it("returns under-ratio for a mostly-English turn at supported posture", () => {
    // 10 tokens, 1 resolves in Spanish -> measuredRatio = 0.1
    // supported floor = max(0.2, 0.65 * 0.5) = 0.325 -> 0.1 < 0.325 -> under-ratio
    const profile = makeProfile(10, 1);
    const verdict = computeLanguageRatioVerdict(profile, 0.65, "supported");
    expect(verdict.conformance).toBe("under-ratio");
  });

  it("returns conformant for Spanish text with OOV noise at target-dominant", () => {
    // 10 tokens, 7 resolve in Spanish (3 OOV) -> measuredRatio = 0.7
    // target-dominant floor = max(0.3, 0.85 * 0.6) = 0.51 -> 0.7 >= 0.51 -> conformant
    const profile = makeProfile(10, 7);
    const verdict = computeLanguageRatioVerdict(profile, 0.85, "target-dominant");
    expect(verdict.conformance).toBe("conformant");
  });

  it("returns under-ratio for 0% target at target-only posture", () => {
    // target-only floor = 0.7; 0/10 = 0 < 0.7 -> under-ratio
    const profile = makeProfile(10, 0);
    const verdict = computeLanguageRatioVerdict(profile, 1.0, "target-only");
    expect(verdict.conformance).toBe("under-ratio");
  });

  it("returns conformant for Spanish-dominant text at target-only posture (floor allows for OOV)", () => {
    // target-only floor = 0.7; 8/10 = 0.8 >= 0.7 -> conformant
    const profile = makeProfile(10, 8);
    const verdict = computeLanguageRatioVerdict(profile, 1.0, "target-only");
    expect(verdict.conformance).toBe("conformant");
  });

  it("returns conformant for full Spanish at anchored posture", () => {
    // anchored floor = max(0.1, 0.3 * 0.4) = 0.12; 10/10 = 1.0 >= 0.12 -> conformant
    const profile = makeProfile(10, 10);
    const verdict = computeLanguageRatioVerdict(profile, 0.3, "anchored");
    expect(verdict.conformance).toBe("conformant");
  });

  it("returns under-ratio when all tokens are English at anchored posture", () => {
    // anchored floor = max(0.1, 0.3 * 0.4) = 0.12; 0/10 = 0 < 0.12 -> under-ratio
    const profile = makeProfile(10, 0);
    const verdict = computeLanguageRatioVerdict(profile, 0.3, "anchored");
    expect(verdict.conformance).toBe("under-ratio");
  });

  it("exact minimum-denominator boundary: at MIN resolves checks rather than skips", () => {
    const profile = makeProfile(MIN_RATIO_CHECK_DENOMINATOR, 0);
    const verdict = computeLanguageRatioVerdict(profile, 0.85, "target-dominant");
    expect(verdict.conformance).toBe("under-ratio");
  });
});
