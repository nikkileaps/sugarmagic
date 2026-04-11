/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/scoring.ts
 *
 * Purpose: Implements the transparent lemma-priority scoring function used by the Budgeter.
 *
 * Exports:
 *   - SCORING_WEIGHTS
 *   - LemmaScoreComponents
 *   - LemmaScore
 *   - ScoringContext
 *   - scoreLemma
 *   - scoreBatch
 *   - computeLemmaPriority
 *
 * Relationships:
 *   - Depends on scene-lexicon and learner-profile contract types plus the FSRS adapter decay helpers.
 *   - Is consumed by LexicalBudgeter and rationale tracing.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter
 *
 * Status: active
 */

import type {
  CompiledSceneLexicon,
  LearnerProfile,
  LemmaCard,
  SceneLemmaInfo
} from "../types";
import {
  decayProductiveStrength,
  decayProvisionalEvidence
} from "./fsrs-adapter";

export const SCORING_WEIGHTS = {
  w_due: 1.0,
  w_new: 0.7,
  w_anchor: 0.8,
  w_freq: 0.4,
  /** Scene relevance: how often/prominently the lemma appears in this scene's
   *  authored content. A word mentioned 5 times in NPC lore outranks a word
   *  that appears once in a ground layer label. */
  w_scene: 0.6,
  w_prodgap: 0.6,
  w_lapse: 0.3
} as const;

export interface LemmaScoreComponents {
  due: number;
  new: number;
  anchor: number;
  /** Frequency bonus: higher-frequency words score higher, pushing common
   *  everyday vocabulary ahead of obscure words for beginners. */
  freq: number;
  /** Scene relevance: normalized weight from authored content occurrences. */
  scene: number;
  prodgap: number;
  lapse: number;
}

export interface LemmaScore {
  lemmaId: string;
  score: number;
  components: LemmaScoreComponents;
  reasons: string[];
}

export interface ScoringContext {
  nowMs: number;
  currentSessionTurn: number;
}

function createFallbackCard(lemma: SceneLemmaInfo): LemmaCard {
  return {
    lemmaId: lemma.lemmaId,
    difficulty: 3,
    stability: 1.5,
    retrievability: 0.7,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    cefrPriorBand: lemma.cefrPriorBand,
    priorWeight: 1,
    productiveStrength: 0,
    lastProducedAtMs: null,
    provisionalEvidence: 0,
    provisionalEvidenceFirstSeenTurn: null
  };
}

function summarizeReasons(components: LemmaScoreComponents): string[] {
  const reasons: string[] = [];
  if (components.due > 0) {
    reasons.push("due-for-review");
  }
  if (components.new > 0) {
    reasons.push("new-item");
  }
  if (components.anchor > 0) {
    reasons.push("scene-anchor");
  }
  if (components.freq > 0) {
    reasons.push("high-frequency");
  }
  if (components.scene > 0) {
    reasons.push("scene-relevant");
  }
  if (components.prodgap > 0) {
    reasons.push("productive-gap");
  }
  if (components.lapse > 0) {
    reasons.push("high-lapse-penalty");
  }
  return reasons;
}

export function scoreLemma(
  lemma: SceneLemmaInfo,
  card: LemmaCard,
  sceneLexicon: CompiledSceneLexicon,
  context: ScoringContext
): LemmaScore {
  const decayedCard = decayProvisionalEvidence(
    decayProductiveStrength(card, context.nowMs),
    context.currentSessionTurn
  );
  // Frequency bonus: normalized to [0, 1] where rank 1 = 1.0 and rank 2000+ = ~0.
  const freqRank = lemma.frequencyRank ?? 5000;
  const freqBonus = Math.max(0, 1 - freqRank / 2000);

  // Scene relevance: normalized to [0, 1]. A word mentioned 5+ times across
  // dialogue/NPC lore/quest text saturates at 1.0. A single mention in a
  // low-weight source scores ~0.15-0.2.
  const sceneRelevance = Math.min(1, (lemma.sceneWeight ?? 0) / 5);

  const components: LemmaScoreComponents = {
    due: 1 - decayedCard.retrievability,
    new: decayedCard.reviewCount === 0 ? decayedCard.priorWeight : 0,
    anchor: sceneLexicon.anchors.includes(lemma.lemmaId) ? 1 : 0,
    freq: freqBonus,
    scene: sceneRelevance,
    prodgap: Math.max(0, decayedCard.stability - decayedCard.productiveStrength),
    lapse: decayedCard.lapseCount > 2 ? 1 : 0
  };
  const score =
    SCORING_WEIGHTS.w_due * components.due +
    SCORING_WEIGHTS.w_new * components.new +
    SCORING_WEIGHTS.w_anchor * components.anchor +
    SCORING_WEIGHTS.w_freq * components.freq +
    SCORING_WEIGHTS.w_scene * components.scene +
    SCORING_WEIGHTS.w_prodgap * components.prodgap -
    SCORING_WEIGHTS.w_lapse * components.lapse;

  return {
    lemmaId: lemma.lemmaId,
    score,
    components,
    reasons: summarizeReasons(components)
  };
}

export function scoreBatch(
  candidates: Array<{ lemma: SceneLemmaInfo; card: LemmaCard }>,
  sceneLexicon: CompiledSceneLexicon,
  context: ScoringContext
): LemmaScore[] {
  return candidates.map(({ lemma, card }) =>
    scoreLemma(lemma, card, sceneLexicon, context)
  );
}

export function computeLemmaPriority(
  lemma: SceneLemmaInfo,
  learner: LearnerProfile,
  sceneLexicon: CompiledSceneLexicon
): number {
  const card = learner.lemmaCards[lemma.lemmaId] ?? createFallbackCard(lemma);
  return scoreLemma(lemma, card, sceneLexicon, {
    nowMs: learner.currentSession?.startedAt ?? 0,
    currentSessionTurn: learner.currentSession?.turns ?? 0
  }).score;
}
