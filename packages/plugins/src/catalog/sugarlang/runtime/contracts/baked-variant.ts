/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/baked-variant.ts
 *
 * Purpose: Declares the baked line variant contract produced at variant-bake time.
 *
 * Exports:
 *   - VariantVerdict
 *   - BakedLineVariant
 *   - BakedVariantStore
 *
 * Implements: Epic 086 Story 086.3 -- bake-time variant generation + triple verification
 *
 * Status: active
 */

import type { CEFRBand } from "./learner-profile";

export interface VariantVerdict {
  /** applyMixedTextEnvelopePredicate leg */
  envelopePasses: boolean;
  /** computeLanguageRatioVerdict */
  ratioPasses: boolean;
  /** computeVoiceRetentionScore [0,1] */
  voiceRetentionScore: number;
  /** LLM-assisted must-convey fidelity check */
  fidelityPasses: boolean;
  /** all four pass */
  overallPasses: boolean;
}

export interface BakedLineVariant {
  nodeId: string;
  dialogueDefinitionId: string;
  lang: string;
  band: CEFRBand;
  text: string;
  verdict: VariantVerdict;
  reviewFlag: boolean;
  generatedAtMs: number;
  generatedByModel: string;
  /** hash of (authoredText + intent) that produced this */
  contentHash: string;
  promptVersion: string;
}

/** In-memory collection keyed lang -> band -> nodeId -> variant. */
export type BakedVariantStore = Map<string, Map<CEFRBand, Map<string, BakedLineVariant>>>;
