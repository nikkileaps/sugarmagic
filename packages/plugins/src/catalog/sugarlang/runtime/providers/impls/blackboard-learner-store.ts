/**
 * packages/plugins/src/catalog/sugarlang/runtime/providers/impls/blackboard-learner-store.ts
 *
 * Purpose: Implements the Blackboard-backed learner-state read model and learner-prior delegation for sugarlang.
 *
 * Exports:
 *   - BlackboardLearnerStore
 *
 * Relationships:
 *   - Depends on learner persistence, learner-prior provider, and blackboard fact ownership.
 *   - Is consumed by middleware and later runtime integration work as the read-side learner store.
 *
 * Implements: Proposal 001 §The Substrate (Untouched) / ADR 010 provider boundaries
 *
 * Status: active
 */

import type { RuntimeBlackboard } from "@sugarmagic/runtime-core";
import type {
  CEFRBand,
  CefrPosterior,
  LearnerId,
  LearnerPriorProvider,
  LearnerProfile,
  LemmaCard
} from "../../types";
import type { CardStore } from "../../learner";
import {
  cloneLearnerProfile,
  createEmptyLearnerProfile,
  loadLearnerProfile,
  type LearnerProfileCoreStore
} from "../../learner";

export interface BlackboardLearnerStoreOptions {
  blackboard: RuntimeBlackboard;
  playerEntityId: string;
  learnerId: LearnerId;
  targetLanguage: string;
  supportLanguage: string;
  cardStore: CardStore;
  /** Where the level and placement record durably live (Plan 092.6.4). */
  profileStore?: LearnerProfileCoreStore;
  learnerPriorProvider: LearnerPriorProvider;
}

export class BlackboardLearnerStore {
  constructor(private readonly options: BlackboardLearnerStoreOptions) {}

  async getCurrentProfile(): Promise<LearnerProfile> {
    const profile = await loadLearnerProfile({
      blackboard: this.options.blackboard,
      playerEntityId: this.options.playerEntityId,
      cardStore: this.options.cardStore,
      profileStore: this.options.profileStore,
      fallbackProfile: createEmptyLearnerProfile({
        learnerId: this.options.learnerId,
        targetLanguage: this.options.targetLanguage,
        supportLanguage: this.options.supportLanguage
      })
    });

    return cloneLearnerProfile(profile);
  }

  getInitialLemmaCard(
    lemmaId: string,
    lang: string,
    learnerBand: CEFRBand
  ): LemmaCard {
    return {
      ...this.options.learnerPriorProvider.getInitialLemmaCard(
        lemmaId,
        lang,
        learnerBand
      )
    };
  }

  getCefrInitialPosterior(selfReportedBand?: CEFRBand): CefrPosterior {
    return this.options.learnerPriorProvider.getCefrInitialPosterior(selfReportedBand);
  }
}
