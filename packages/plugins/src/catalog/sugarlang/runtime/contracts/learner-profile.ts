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
 * Status: active
 */

/**
 * Canonical CEFR bands used across learner state, scene lexicons, and directives.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export type CEFRBand = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/**
 * Nominal learner identifier to distinguish persisted learner profiles from other ids.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export type LearnerId = string & { readonly __brand: "LearnerId" };

/**
 * Initial productive knowledge for a newly seeded lemma card.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge
 */
export const INITIAL_PRODUCTIVE_STRENGTH = 0;

/**
 * Initial amount of uncommitted provisional evidence on a new lemma card.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export const INITIAL_PROVISIONAL_EVIDENCE = 0;

/**
 * Maximum provisional evidence allowed on a lemma card before clamping.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export const PROVISIONAL_EVIDENCE_MAX = 5;

/**
 * Turn threshold after which stale provisional evidence decays to zero.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export const PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD = 30;

/**
 * Posterior weight for a single CEFR band.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export interface CefrPosteriorBandWeight {
  alpha: number;
  beta: number;
}

/**
 * Bayesian posterior over the learner's CEFR level.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export type CefrPosterior = Record<CEFRBand, CefrPosteriorBandWeight>;

/**
 * Per-lemma learner state combining FSRS receptive memory with productive knowledge.
 *
 * Implements: Proposal 001 §Receptive vs. Productive Knowledge / §Observer Latency Bias
 */
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

/**
 * Session-local aggregate signals used by runtime adaptation and fatigue estimation.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export interface CurrentSessionSignals {
  sessionId: string;
  startedAt: number;
  turns: number;
  avgResponseLatencyMs: number;
  hoverRate: number;
  retryRate: number;
  fatigueScore: number;
}

/**
 * Historical summary for a completed learning session.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export interface SessionRecord {
  sessionId: string;
  startedAt: number;
  completedAt: number;
  turns: number;
}

/**
 * Persistent assessment metadata for placement and later recalibration flows.
 *
 * Implements: Proposal 001 §Cold Start Sequence / §Learner State Model
 */
export interface LearnerAssessment {
  status: "unassessed" | "estimated" | "evaluated";
  evaluatedCefrBand: CEFRBand | null;
  cefrConfidence: number;
  evaluatedAtMs: number | null;
}

/**
 * Full persisted learner profile owned by sugarlang.
 *
 * Implements: Proposal 001 §Learner State Model
 */
export interface LearnerProfile {
  learnerId: LearnerId;
  targetLanguage: string;
  supportLanguage: string;
  assessment: LearnerAssessment;
  estimatedCefrBand: CEFRBand;
  cefrPosterior: CefrPosterior;
  lemmaCards: Record<string, LemmaCard>;
  currentSession: CurrentSessionSignals | null;
  sessionHistory: SessionRecord[];
}
