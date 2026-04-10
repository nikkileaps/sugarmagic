/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/fsrs-learner-prior-provider.ts
 *
 * Purpose: Implements the learner-prior provider that seeds FSRS-aligned lemma cards from atlas priors.
 *
 * Exports:
 *   - FsrsLearnerPriorProvider
 *
 * Relationships:
 *   - Implements the LearnerPriorProvider contract.
 *   - Depends on the lexical-atlas provider plus the CEFR posterior helper functions.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / ADR 010 provider boundaries
 *
 * Status: active
 */

import type {
  CEFRBand,
  CefrPosterior,
  LearnerPriorProvider,
  LemmaCard,
  LexicalAtlasProvider
} from "../../types";
import {
  createUniformCefrPosterior,
  seedCefrPosteriorFromSelfReport,
  CEFR_BAND_ORDER
} from "../../learner/cefr-posterior";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getBandIndex(band: CEFRBand): number {
  return CEFR_BAND_ORDER.indexOf(band);
}

export class FsrsLearnerPriorProvider implements LearnerPriorProvider {
  constructor(private readonly atlas: LexicalAtlasProvider) {}

  getInitialLemmaCard(
    lemmaId: string,
    lang: string,
    learnerBand: CEFRBand
  ): LemmaCard {
    const atlasEntry = this.atlas.getLemma(lemmaId, lang);
    const cefrPriorBand = atlasEntry?.cefrPriorBand ?? learnerBand;
    const bandDelta = getBandIndex(cefrPriorBand) - getBandIndex(learnerBand);

    return {
      lemmaId,
      difficulty: clamp(3 + bandDelta * 0.75, 1, 8),
      stability: clamp(2.4 - bandDelta * 0.35, 0.4, 5),
      retrievability: clamp(0.82 - bandDelta * 0.08, 0.2, 0.97),
      lastReviewedAt: null,
      reviewCount: 0,
      lapseCount: 0,
      cefrPriorBand,
      priorWeight: atlasEntry?.cefrPriorSource === "frequency-derived" ? 0.8 : 1,
      productiveStrength: 0,
      lastProducedAtMs: null,
      provisionalEvidence: 0,
      provisionalEvidenceFirstSeenTurn: null
    };
  }

  getCefrInitialPosterior(selfReportedBand?: CEFRBand): CefrPosterior {
    return selfReportedBand
      ? seedCefrPosteriorFromSelfReport(selfReportedBand)
      : createUniformCefrPosterior();
  }
}
