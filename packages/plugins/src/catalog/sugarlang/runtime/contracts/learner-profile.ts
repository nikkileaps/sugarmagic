/**
 * packages/plugins/src/catalog/sugarlang/runtime/contracts/learner-profile.ts
 *
 * Purpose: Declares the learner-state types owned by sugarlang runtime state and persistence.
 *
 * Exports:
 *   - CEFRBand
 *   - LearnerId
 *   - CefrPosterior
 *   - LemmaCard
 *   - CurrentSessionSignals
 *   - SessionRecord
 *   - LearnerProfile
 *
 * Relationships:
 *   - Is consumed by learner-state, budgeter, classifier, director, and middleware stubs.
 *   - Feeds persistence and blackboard fact definitions in runtime/learner.
 *
 * Implements: Proposal 001 §Learner State Model / §Receptive vs. Productive Knowledge
 *
 * Status: skeleton (no implementation yet; see Epic 3)
 */

export type CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type LearnerId = string & { readonly __brand: "LearnerId" };

export interface CefrPosteriorBandWeight {
  alpha: number;
  beta: number;
}

export type CefrPosterior = Record<CEFRBand, CefrPosteriorBandWeight>;

export interface LemmaCard {
  lemmaId: string;
  difficulty: number;
  stability: number;
  retrievability: number;
  lastReviewedAt: number | null;
  reviewCount: number;
  lapseCount: number;
  cefrPriorBand: CEFRBand;
  priorWeight: number;
  productiveStrength: number;
  lastProducedAtMs: number | null;
  provisionalEvidence: number;
  provisionalEvidenceFirstSeenTurn: number | null;
}

export interface CurrentSessionSignals {
  sessionId: string;
  startedAt: number;
  turns: number;
  avgResponseLatencyMs: number;
  hoverRate: number;
  retryRate: number;
  fatigueScore: number;
}

export interface SessionRecord {
  sessionId: string;
  startedAt: number;
  completedAt: number;
  turns: number;
}

export interface LearnerProfile {
  learnerId: LearnerId;
  targetLanguage: string;
  supportLanguage: string;
  assessment: {
    status: "unassessed" | "estimated" | "evaluated";
    evaluatedCefrBand: CEFRBand | null;
    cefrConfidence: number;
    evaluatedAtMs: number | null;
  };
  estimatedCefrBand: CEFRBand;
  cefrPosterior: CefrPosterior;
  lemmaCards: Record<string, LemmaCard>;
  currentSession: CurrentSessionSignals | null;
  sessionHistory: SessionRecord[];
}
