/**
 * packages/plugins/src/catalog/sugarlang/runtime/debug/turn-debug-state.ts
 *
 * Purpose: Holds the two things the debug HUD needs that are not on the learner
 *   profile: the last observation applied, and the last learner-curriculum
 *   state reported.
 *
 * Both are per-turn values that are used and discarded. Nothing else needs them
 * kept, so they are not persisted and not part of any save -- this is a window
 * onto the turn that just happened, and it is empty until one has.
 *
 * Writing is unconditional and costs two assignments per turn. Gating it on
 * whether the HUD is open would mean the first thing you see after opening it
 * is nothing, which is indistinguishable from the bug you opened it to find.
 *
 * Exports:
 *   - ObservationRecord
 *   - recordObservation
 *   - recordCurriculumState
 *   - readTurnDebugState
 *   - clearTurnDebugState
 *
 * Status: active
 */

import type { LearnerProgress } from "../learner/learner-progress";

/** What one observation did, in the terms the observation path uses. */
export interface ObservationRecord {
  /** The observation kind, e.g. "hovered", "chunk-encountered". */
  kind: string;
  /** The card it landed on -- a lemma, or `exponent:<id>` for a competency. */
  cardKey: string;
  /**
   * The FSRS grade it produced, or null.
   *
   * Null is the interesting case, not a missing value: passive exposure does
   * not grade, so a null here means the card was touched and its schedule did
   * not move. Rendering that as blank would hide the distinction.
   */
  grade: string | null;
  observedAtMs: number;
}

let lastObservation: ObservationRecord | null = null;
let lastCurriculumState: LearnerProgress | null = null;

export function recordObservation(record: ObservationRecord): void {
  lastObservation = record;
}

export function recordCurriculumState(state: LearnerProgress): void {
  lastCurriculumState = state;
}

export function readTurnDebugState(): {
  lastObservation: ObservationRecord | null;
  learnerProgress: LearnerProgress | null;
} {
  return { lastObservation, learnerProgress: lastCurriculumState };
}

/** Used by the learner-data reset so the HUD does not outlive the learner. */
export function clearTurnDebugState(): void {
  lastObservation = null;
  lastCurriculumState = null;
}
