/**
 * packages/plugins/src/catalog/sugarlang/runtime/types.ts
 *
 * Purpose: Provides the single re-export surface for all public sugarlang runtime contract types.
 *
 * Exports:
 *   - all public types from runtime/contracts/*
 *
 * Relationships:
 *   - Depends on the contract files under ./contracts.
 *   - Is the intended import surface for downstream epics that need sugarlang types.
 *
 * Implements: Proposal 001 §File Structure
 *
 * Status: active
 */

export * from "./contracts/pedagogy";
// 090.9: the learner owns its own types and exposes them from its module entry;
// the CEFR band scale is its own module because words and text have bands too.
export * from "./cefr";
export type {
  CefrPosterior,
  CefrPosteriorBandWeight,
  CurrentSessionSignals,
  LearnerAssessment,
  LearnerId,
  LearnerProfile,
  LemmaCard,
  LearningStatus,
  SessionRecord
} from "./learner";
export {
  INITIAL_PRODUCTIVE_STRENGTH,
  INITIAL_PROVISIONAL_EVIDENCE,
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX
} from "./learner";
export * from "./contracts/lexical-prescription";
export * from "./contracts/envelope";
export * from "./contracts/scene-lexicon";
export * from "./contracts/observation";
export * from "./contracts/providers";
export * from "./contracts/placement-questionnaire";
