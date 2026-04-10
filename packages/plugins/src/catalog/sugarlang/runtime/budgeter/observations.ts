/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/observations.ts
 *
 * Purpose: Implements the pure observation-to-outcome rule table used by the Budgeter and learner reducer.
 *
 * Exports:
 *   - PROVISIONAL_DELTA_CAP
 *   - PRODUCTIVE_DELTAS
 *   - computeProvisionalEvidenceDelta
 *   - observationToOutcome
 *   - observationToFsrsGrade
 *
 * Relationships:
 *   - Depends on the observation contract types only.
 *   - Is consumed by the learner reducer and FSRS adapter as the single interpretation layer.
 *
 * Implements: Proposal 001 §1. Lexical Budgeter / §Receptive vs. Productive Knowledge
 *
 * Status: active
 */

import type {
  FSRSGrade,
  LemmaObservation,
  ObservationOutcome
} from "../types";

export const PROVISIONAL_DELTA_CAP = 0.3;

export const PRODUCTIVE_DELTAS = {
  encountered: 0,
  rapidAdvance: 0,
  hovered: -0.05,
  questSuccess: 0,
  producedChosen: 0.15,
  producedTyped: 0.3,
  producedUnprompted: 0.5,
  producedIncorrect: -0.2
} as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled observation kind: ${String(value)}`);
}

export function computeProvisionalEvidenceDelta(dwellMs: number): number {
  return Math.min(PROVISIONAL_DELTA_CAP, Math.max(0, dwellMs / 10000));
}

export function observationToOutcome(
  observation: LemmaObservation
): ObservationOutcome {
  switch (observation.kind) {
    case "encountered":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: PRODUCTIVE_DELTAS.encountered,
        provisionalEvidenceDelta: 0
      };
    case "rapid-advance":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: PRODUCTIVE_DELTAS.rapidAdvance,
        provisionalEvidenceDelta: computeProvisionalEvidenceDelta(
          observation.dwellMs
        )
      };
    case "hovered":
      return {
        receptiveGrade: "Hard",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.hovered,
        provisionalEvidenceDelta: 0
      };
    case "quest-success":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.questSuccess,
        provisionalEvidenceDelta: 0
      };
    case "produced-chosen":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedChosen,
        provisionalEvidenceDelta: 0
      };
    case "produced-typed":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedTyped,
        provisionalEvidenceDelta: 0
      };
    case "produced-unprompted":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedUnprompted,
        provisionalEvidenceDelta: 0
      };
    case "produced-incorrect":
      return {
        receptiveGrade: "Again",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedIncorrect,
        provisionalEvidenceDelta: 0
      };
    default:
      return assertNever(observation);
  }
}

export function observationToFsrsGrade(
  observation: LemmaObservation
): FSRSGrade | null {
  return observationToOutcome(observation).receptiveGrade;
}
