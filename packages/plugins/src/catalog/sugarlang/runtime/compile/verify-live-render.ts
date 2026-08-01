/**
 * packages/plugins/src/catalog/sugarlang/runtime/compile/verify-live-render.ts
 *
 * Purpose: Deterministic verification for live-rendered scripted lines.
 *          Runs only the structural/deterministic gates -- NO LLM fidelity
 *          judge on the turn path (bake-only per design).
 *
 *          Gate 1: applyMixedTextEnvelopePredicate (allowance + ceiling legs)
 *          Gate 2: computeLanguageRatioVerdict
 *          Gate 3: computeVoiceRetentionScore (voiceSpec null -> 1.0)
 *          Gate 4: Deterministic fidelity floor -- at least half the introduce
 *                  lemmaIds appear as substrings in the lowercased text.
 *                  Empty introduce list -> trivially passes.
 *
 * Exports:
 *   - VerifyLiveRenderInput
 *   - verifyLiveRender
 *
 * Implements: Epic 086 Story 086.5 -- directed live render path (dormant stub)
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";
import type { SupportPosture } from "../contracts/pedagogy";
import type { VariantVerdict } from "../contracts/baked-variant";
import type { InventoryChunk } from "../contracts/competency-inventory";
import type { LexicalAtlasProvider } from "../types";
import { applyMixedTextEnvelopePredicate } from "../classifier/envelope-rule";
import { computeLanguageRatioVerdict } from "../classifier/language-ratio";
import { computeVoiceRetentionScore } from "../classifier/envelope-classifier";
import { VOICE_RETENTION_PASS_THRESHOLD } from "./generate-variant";
import { computeCoverage } from "../classifier/coverage";
import { createChunkMatcher } from "../classifier/chunk-matcher";
import { tokenize } from "../classifier/tokenize";
import { MorphologyLoader } from "../classifier/morphology-loader";
import type { LearnerId } from "../learner";

const morphologyLoader = new MorphologyLoader();

export interface VerifyLiveRenderInput {
  text: string;
  targetLang: string;
  band: CEFRBand;
  posture: SupportPosture;
  directedRatio: number;
  /** Required lemmas/chunks -- deterministic fidelity floor (>= half must appear in text). */
  introduce: Array<{ lemmaId: string; lang: string }>;
  inventoryChunks: InventoryChunk[];
  atlas: LexicalAtlasProvider;
}

/**
 * Runs the four deterministic gates over a live-rendered line.
 * No LLM calls -- the LLM fidelity judge is bake-only.
 */
export function verifyLiveRender(input: VerifyLiveRenderInput): VariantVerdict {
  const { text, targetLang, band, posture, directedRatio, introduce, inventoryChunks, atlas } =
    input;

  // Build a synthetic learner profile for this band (same pattern as generate-variant.ts).
  const syntheticLearner = {
    learnerId: "__live-render__" as LearnerId,
    targetLanguage: targetLang,
    supportLanguage: "en",
    assessment: {
      status: "unassessed" as const,
      evaluatedCefrBand: null,
      cefrConfidence: 0,
      evaluatedAtMs: null
    },
    estimatedCefrBand: band,
    cefrPosterior: {
      A1: { alpha: 1, beta: 1 },
      A2: { alpha: 1, beta: 1 },
      B1: { alpha: 1, beta: 1 },
      B2: { alpha: 1, beta: 1 },
      C1: { alpha: 1, beta: 1 },
      C2: { alpha: 1, beta: 1 }
    },
    lemmaCards: {},
    currentSession: null,
    sessionHistory: []
  };

  // Coverage profile shared by gates 1 and 2.
  const chunkMatcher = createChunkMatcher(inventoryChunks, targetLang);
  const tokens = tokenize(text, targetLang);
  const profile = computeCoverage(
    tokens,
    syntheticLearner,
    atlas,
    new Set(),
    morphologyLoader,
    new Set(),
    chunkMatcher,
    undefined,
    text
  );

  // Gate 1: Mixed-text envelope predicate (allowance + ceiling; no coverage floor).
  const envelopeResult = applyMixedTextEnvelopePredicate(profile, band, {
    taughtLemmaIds: null
  });
  const envelopePasses = envelopeResult.passes;

  // Gate 2: Language ratio.
  const ratioVerdict = computeLanguageRatioVerdict(profile, directedRatio, posture);
  const ratioPasses =
    ratioVerdict.conformance === "conformant" || ratioVerdict.conformance === "skipped";

  // Gate 3: Voice retention (voiceSpec null at runtime -> always 1.0).
  const voiceRetentionScore = computeVoiceRetentionScore(text, null);

  // Gate 4: Deterministic fidelity floor.
  // Check that at least half of the introduce lemmaIds appear as substrings in the
  // lowercased text. Empty introduce list -> trivially passes. No LLM call.
  let fidelityPasses: boolean;
  if (introduce.length === 0) {
    fidelityPasses = true;
  } else {
    const lowerText = text.normalize("NFC").toLocaleLowerCase();
    const matchCount = introduce.filter((item) =>
      lowerText.includes(item.lemmaId.normalize("NFC").toLocaleLowerCase())
    ).length;
    fidelityPasses = matchCount >= Math.ceil(introduce.length / 2);
  }

  const overallPasses = envelopePasses && ratioPasses && voiceRetentionScore >= VOICE_RETENTION_PASS_THRESHOLD && fidelityPasses;

  return {
    envelopePasses,
    ratioPasses,
    voiceRetentionScore,
    fidelityPasses,
    overallPasses
  };
}
