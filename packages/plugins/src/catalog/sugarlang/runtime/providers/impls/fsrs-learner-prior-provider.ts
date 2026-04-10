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
  seedCefrPosteriorFromSelfReport
} from "../../learner/cefr-posterior";
import { seedCardFromAtlas } from "../../budgeter/fsrs-adapter";

export class FsrsLearnerPriorProvider implements LearnerPriorProvider {
  constructor(private readonly atlas: LexicalAtlasProvider) {}

  getInitialLemmaCard(
    lemmaId: string,
    lang: string,
    learnerBand: CEFRBand
  ): LemmaCard {
    const atlasEntry = this.atlas.getLemma(lemmaId, lang);

    return seedCardFromAtlas(
      lemmaId,
      lang,
      {
        cefrPriorBand: atlasEntry?.cefrPriorBand ?? learnerBand,
        cefrPriorSource: atlasEntry?.cefrPriorSource
      },
      learnerBand
    );
  }

  getCefrInitialPosterior(selfReportedBand?: CEFRBand): CefrPosterior {
    return selfReportedBand
      ? seedCefrPosteriorFromSelfReport(selfReportedBand)
      : createUniformCefrPosterior();
  }
}
