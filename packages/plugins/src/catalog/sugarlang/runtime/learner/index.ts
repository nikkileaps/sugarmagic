/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/index.ts
 *
 * Purpose: The learner module's PUBLIC surface. Everything outside this
 *   directory imports from here; nothing outside imports a file inside it.
 *
 * WHY THIS FILE EXISTS
 *   The module README has always said "editor UI must not depend on its
 *   internals". That was unenforceable: there was no public entry, so every
 *   caller deep-imported (`../learner/card-store`, `../learner/cefr-posterior`)
 *   and "internals" described the whole module. This file is the difference
 *   between a rule and a wish.
 *
 *   `LearnerStateReducer` IS exported, and the README's "single enforcer" claim
 *   survives that: it means the reducer is the only supported WRITER of the
 *   learner-profile fact, not that it is unreachable. Something has to construct
 *   it -- `runtime-services` does. Hiding it would have made this file lie
 *   rather than made the write path safer.
 *
 * Exports: learner state types, the CEFR posterior math, learning status,
 *   card + teach-record stores, session signals, and the debug reset helper the
 *   Studio shell needs.
 *
 * Relationships:
 *   - Depends on `runtime/cefr` for the band scale.
 *   - `runtime/types.ts` re-exports the types from here.
 *
 * Implements: Proposal 001 §Learner State Model + Plan 090 story 090.9
 *
 * Status: active
 */

export type {
  CefrPosterior,
  CefrPosteriorBandWeight,
  CurrentSessionSignals,
  LearnerAssessment,
  LearnerId,
  LearnerProfile,
  LemmaCard,
  SessionRecord
} from "./learner-profile";

export {
  INITIAL_PRODUCTIVE_STRENGTH,
  INITIAL_PROVISIONAL_EVIDENCE,
  PROVISIONAL_EVIDENCE_DECAY_TURN_THRESHOLD,
  PROVISIONAL_EVIDENCE_MAX
} from "./learner-profile";

export type { PendingProvisional, ProbeFloorState } from "./pacing-signals";
export {
  computePacingSignals,
  computePendingProvisionalLemmas,
  computeProbeFloorState
} from "./pacing-signals";

export {
  CEFR_BAND_ORDER,
  computeEvidenceShare,
  computeExpectedBand,
  computePointEstimate,
  createUniformCefrPosterior,
  seedCefrPosteriorFromPlacement,
  seedCefrPosteriorFromSelfReport,
  updatePosterior
} from "./cefr-posterior";

export { learnerKey } from "./learner-key";
export {
  DUE_RETRIEVABILITY_FLOOR,
  KNOWN_RETRIEVABILITY_FLOOR,
  LEARNING_STATUSES,
  getLearningStatus
} from "./learning-status";
export type { LearningStatus, LearningStatusInput } from "./learning-status";

export {
  CARD_STORE_DB_NAME_PREFIX,
  CARD_STORE_PAGE_SIZE,
  IndexedDBCardStore,
  MemoryCardStore
} from "./card-store";
export type {
  CardStore,
  CardStorePage,
  IndexedDBCardStoreOptions
} from "./card-store";

export { resetSugarlangLearnerDatabases } from "./reset-learner-data";
export type {
  ResetSugarlangLearnerDatabasesOptions,
  SugarlangLearnerDataResetResult
} from "./reset-learner-data";

export * from "./teach-record-store";
export * from "./encounter-debt-ledger";
export * from "./fact-definitions";
export * from "./calibration-window";
export * from "./persistence";
export * from "./learner-state-reducer";
// 090.5: `session-signals` deleted -- it computed the fatigue/strain score,
// which never ran. See outer-loop-scheduler.ts for the full note.
