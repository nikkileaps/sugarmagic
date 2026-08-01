/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-profile.ts
 *
 * Purpose: Declares the learner-state types this module owns.
 *
 * WHY THESE LIVE HERE AND NOT IN `contracts/`
 *   They were in `contracts/learner-profile.ts`, which meant "the Learner" did
 *   not exist as one thing: its types were in one place, its behavior (card
 *   store, posterior math, state reducer, learning status) in another, and the
 *   module had no public entry -- so this module's README rule that "editor UI
 *   must not depend on its internals" was unenforceable, because there were no
 *   non-internals to depend on instead. Callers now import the module, and the
 *   module decides what it exposes (./index.ts).
 *
 *   The CEFR band scale did NOT come with them. A band is not a learner fact --
 *   words and text have bands too -- so it lives in `runtime/cefr`.
 *
 * Exports:
 *   - LearnerId, LemmaCard, CefrPosterior, CefrPosteriorBandWeight
 *   - CurrentSessionSignals, SessionRecord, LearnerAssessment, LearnerProfile
 *   - the provisional-evidence constants
 *
 * Relationships:
 *   - Depends on `runtime/cefr` for CEFRBand. Nothing else.
 *
 * Implements: Proposal 001 §Learner State Model / §Receptive vs. Productive Knowledge
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";

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
  // 090.5: avgResponseLatencyMs / hoverRate / probeFailRate / fatigueScore
  // deleted. All four fed `computeFatigueScore` and nothing else, and the strain
  // curve they drove never ran in production -- `currentSession` is only created
  // by a `session-start` event, which nothing outside tests emits.
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
