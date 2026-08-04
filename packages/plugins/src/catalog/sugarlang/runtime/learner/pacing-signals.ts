/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/pacing-signals.ts
 *
 * Purpose: Derived PACING signals -- how much probing this learner is due for
 *   right now. Computed, never stored.
 *
 * THESE ARE SIGNALS, NOT STATE
 *   Both are pure functions of data that already exists:
 *
 *     pendingProvisionalLemmas  <- learner.lemmaCards + learner.currentSession.turns
 *     probeFloorState           <- pendingProvisionalLemmas + turnsSinceLastProbe
 *
 *   Nothing here is a new fact about the learner, so nothing here is persisted
 *   and nothing here belongs on `LearnerProfile`. They are readings TAKEN OFF
 *   learner state, not pieces of it. Deriving at the read site is what keeps a
 *   stored copy from drifting out of agreement with the cards it came from.
 *
 * WHY THEY LIVE IN THE LEARNER MODULE
 *   CAPACITY is a property of the LEARNER, alongside band and standing. These
 *   two probe-pacing signals are what exists of it, so if capacity is ever
 *   revisited it starts HERE rather than in a new home.
 *
 *   The fatigue/strain half was deleted in 090.5. It WAS live code -- see the
 *   correction at `scheduler/outer-loop-scheduler.ts:67`, which this comment
 *   used to contradict by claiming it had never run.
 *
 *   They were in `middlewares/shared.ts`, which made the teacher unable to
 *   derive them without depending on middleware -- so they were computed once
 *   and passed along as data instead, which is what put two non-learner fields
 *   on the Teacher's learner door in the first place.
 *
 * THE ONE INPUT THAT IS NOT LEARNER STATE
 *   `turnsSinceLastProbe` is CONVERSATION state -- it is read off the execution,
 *   not off the profile -- so it is a parameter here rather than a field. It
 *   reaches the Teacher on the SITUATION, beside `recentTurns` (090.4).
 *
 * Exports:
 *   - PendingProvisional, ProbeFloorState
 *   - computePendingProvisionalLemmas, computeProbeFloorState
 *
 * Relationships:
 *   - Pure. Reads a LearnerProfile and a turn count; no I/O, no store, no clock.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 *
 * Status: active
 */

import type { LemmaRef } from "../contracts/lexical-prescription";
import type { LearnerProfile } from "./learner-profile";

/** Probe is REQUIRED at or beyond this many turns, or this many turns pending. */
const HARD_FLOOR_TURNS = 25;
/** Probe is RECOMMENDED at or beyond this many turns, with enough pending. */
const SOFT_FLOOR_TURNS = 15;
const SOFT_FLOOR_MIN_PENDING = 5;

/**
 * Runtime-computed view of a lemma with uncommitted provisional evidence.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export interface PendingProvisional {
  lemmaRef: LemmaRef;
  evidenceAmount: number;
  turnsPending: number;
}

/**
 * Soft/hard-floor state used to govern comprehension-probe frequency.
 *
 * Implements: Proposal 001 §Observer Latency Bias and In-Character Comprehension Checks
 */
export interface ProbeFloorState {
  turnsSinceLastProbe: number;
  totalPendingLemmas: number;
  softFloorReached: boolean;
  hardFloorReached: boolean;
  hardFloorReason?: "turns-since-probe" | "lemma-age";
}

/**
 * Lemmas the learner has been exposed to without confirmed comprehension,
 * oldest first.
 *
 * Chunk cards are excluded: they track pragmatic competency acquisition, not
 * vocabulary, and a probe targets a word.
 */
export function computePendingProvisionalLemmas(
  learner: LearnerProfile
): PendingProvisional[] {
  const currentTurn = learner.currentSession?.turns ?? 0;
  return Object.values(learner.lemmaCards)
    .filter((card) => !card.lemmaId.startsWith("exponent:") && card.provisionalEvidence > 0)
    .map((card) => ({
      lemmaRef: {
        lemmaId: card.lemmaId,
        lang: learner.targetLanguage
      },
      evidenceAmount: card.provisionalEvidence,
      turnsPending:
        card.provisionalEvidenceFirstSeenTurn === null
          ? 0
          : Math.max(0, currentTurn - card.provisionalEvidenceFirstSeenTurn)
    }))
    .sort((left, right) => {
      if (left.turnsPending !== right.turnsPending) {
        return right.turnsPending - left.turnsPending;
      }
      return left.lemmaRef.lemmaId.localeCompare(right.lemmaRef.lemmaId);
    });
}

export function computeProbeFloorState(
  pending: PendingProvisional[],
  turnsSinceLastProbe: number
): ProbeFloorState {
  const oldestPending = pending[0]?.turnsPending ?? 0;
  const hardFloorReached =
    turnsSinceLastProbe >= HARD_FLOOR_TURNS || oldestPending >= HARD_FLOOR_TURNS;
  const hardFloorReason =
    turnsSinceLastProbe >= HARD_FLOOR_TURNS
      ? "turns-since-probe"
      : oldestPending >= HARD_FLOOR_TURNS
        ? "lemma-age"
        : undefined;

  return {
    turnsSinceLastProbe,
    totalPendingLemmas: pending.length,
    softFloorReached:
      turnsSinceLastProbe >= SOFT_FLOOR_TURNS && pending.length >= SOFT_FLOOR_MIN_PENDING,
    hardFloorReached,
    ...(hardFloorReason ? { hardFloorReason } : {})
  };
}

/**
 * Both signals together, for a caller that has a learner and a turn count.
 *
 * The pair is what every Teacher-side reader actually wants, and computing them
 * separately at four call sites is how the two drift apart.
 */
export function computePacingSignals(
  learner: LearnerProfile,
  turnsSinceLastProbe: number
): { pendingProvisionalLemmas: PendingProvisional[]; probeFloorState: ProbeFloorState } {
  const pendingProvisionalLemmas = computePendingProvisionalLemmas(learner);
  return {
    pendingProvisionalLemmas,
    probeFloorState: computeProbeFloorState(pendingProvisionalLemmas, turnsSinceLastProbe)
  };
}
