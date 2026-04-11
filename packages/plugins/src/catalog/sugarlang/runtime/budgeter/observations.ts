/**
 * packages/plugins/src/catalog/sugarlang/runtime/budgeter/observations.ts
 *
 * Purpose: Implements the pure observation-to-outcome rule table used by the
 *          Budgeter and learner reducer.
 *
 * ## Pedagogical rationale: introduce vs reinforce observation weights
 *
 * The observation system distinguishes between two categories of highlighted vocabulary:
 *
 * INTRODUCE words (new to the learner):
 *   - Visually: gold highlight with underline — "pay attention, this is new"
 *   - Hover ("hovered-introduce"): FSRS grade "Good" — engaging with new material
 *     is expected and positive. The learner SHOULD be looking these up.
 *   - Player produces: no star celebration — they literally just saw it with a gloss
 *
 * REINFORCE words (previously seen):
 *   - Visually: blue highlight, no underline — "you've seen this, try to remember"
 *   - Hover ("hovered"): FSRS grade "Hard" — needed help remembering, schedules the
 *     card sooner for more practice
 *   - Player produces without hovering first: star celebration — strong retention evidence
 *
 * This separation prevents the system from penalizing learners for engaging with
 * new material (hovering to learn) while correctly detecting forgetting on review
 * material (hovering because they forgot).
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
  /** Hover on a reinforce word — slight productive penalty (they forgot). */
  hovered: -0.05,
  /** Hover on an introduce word — no productive penalty (they're learning). */
  hoveredIntroduce: 0,
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

/**
 * Maps a single observation event to its FSRS outcome. This is the core
 * interpretation layer that translates player behavior into learning signals.
 *
 * Each observation kind produces three outputs:
 * - `receptiveGrade`: FSRS review grade (null = no review, "Again"/"Hard"/"Good"/"Easy")
 * - `productiveStrengthDelta`: adjustment to the card's productive strength score
 * - `provisionalEvidenceDelta`: evidence accumulator for deferred observations
 */
export function observationToOutcome(
  observation: LemmaObservation
): ObservationOutcome {
  switch (observation.kind) {
    // NPC used this word in dialogue; learner was exposed but didn't interact.
    case "encountered":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: PRODUCTIVE_DELTAS.encountered,
        provisionalEvidenceDelta: 0
      };

    // Learner scrolled/advanced past the word quickly — provisional signal
    // that accumulates until confirmed by a comprehension probe.
    case "rapid-advance":
      return {
        receptiveGrade: null,
        productiveStrengthDelta: PRODUCTIVE_DELTAS.rapidAdvance,
        provisionalEvidenceDelta: computeProvisionalEvidenceDelta(
          observation.dwellMs
        )
      };

    // Learner hovered a REINFORCE word (previously seen). They needed help
    // remembering — grade "Hard" schedules the card sooner.
    case "hovered":
      return {
        receptiveGrade: "Hard",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.hovered,
        provisionalEvidenceDelta: 0
      };

    // Learner hovered an INTRODUCE word (new vocabulary). This is expected
    // and positive — grade "Good" records a successful first exposure.
    case "hovered-introduce":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.hoveredIntroduce,
        provisionalEvidenceDelta: 0
      };

    // Learner completed a quest objective containing this word.
    case "quest-success":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.questSuccess,
        provisionalEvidenceDelta: 0
      };

    // Learner selected a dialogue choice containing this word.
    case "produced-chosen":
      return {
        receptiveGrade: "Good",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedChosen,
        provisionalEvidenceDelta: 0
      };

    // Learner typed this word in free text when it was a target (introduce/reinforce).
    // Strong productive signal — they recalled and produced it.
    case "produced-typed":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedTyped,
        provisionalEvidenceDelta: 0
      };

    // Learner typed this word unprompted (wasn't in the current prescription).
    // Even stronger — spontaneous production shows deep retention.
    case "produced-unprompted":
      return {
        receptiveGrade: "Easy",
        productiveStrengthDelta: PRODUCTIVE_DELTAS.producedUnprompted,
        provisionalEvidenceDelta: 0
      };

    // Learner attempted to produce a target word but got it wrong.
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

/**
 * Convenience accessor: extracts just the FSRS grade from an observation.
 * Returns null for observations that don't trigger an FSRS review.
 */
export function observationToFsrsGrade(
  observation: LemmaObservation
): FSRSGrade | null {
  return observationToOutcome(observation).receptiveGrade;
}
