/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learning-status.ts
 *
 * Purpose: Answers "where does this learner stand on this item" as ONE named
 *   fact, readable without invoking the budgeter.
 *
 * WHY THIS EXISTS
 *   The five values below were always implicit in the system -- they were just
 *   spread across whoever needed them first, each as a private predicate: the
 *   band-envelope filter in the budgeter, a `reviewCount === 0` split two lines
 *   below it, and retrievability comparisons in the scheduler. Nothing named the
 *   concept, so the Teacher could not read it; it could only re-derive it, or
 *   accept whatever the budgeter had already decided. 090.4 needs to ask
 *   directly.
 *
 * THIS IS A DERIVATION, NOT A NEW STORE
 *   Every input already exists. The card lives on `LearnerProfile.lemmaCards`,
 *   the learner's band on the same profile, the item's band in the atlas. What
 *   moved is the decision, not the data:
 *
 *     LemmaCard      retrievability, reviewCount  -> unseen / learning / due / known
 *     atlas          the item's band              -\
 *     LearnerProfile the learner's band           -/ -> out-of-reach
 *
 * WHAT IT IS NOT
 *   Not a facade over the budgeter -- that module is deleted in 090.10, so
 *   there would be nothing to delegate to. The learner OWNS this question.
 *   It IS a thin read over FSRS: retrievability is computed there, and this only
 *   compares it to a floor.
 *
 * Exports:
 *   - DUE_RETRIEVABILITY_FLOOR, KNOWN_RETRIEVABILITY_FLOOR
 *   - LEARNING_STATUSES, LearningStatus
 *   - getLearningStatus
 *
 * Relationships:
 *   - Reads a LemmaCard and a band; no store, no I/O, no side effects.
 *   - The scheduler re-exports the two floors from here rather than declaring
 *     its own, so there is one threshold per concept repo-wide.
 *
 * Implements: Plan 090 story 090.9
 *
 * Status: active
 */

import type { CEFRBand } from "../cefr";
import { bandIndex } from "../cefr";
import type { LemmaCard } from "../types";

/**
 * The recall probability we aim to keep an item at. One number, because there
 * were two: the FSRS engine was asked for 0.9 and the due question used 0.7,
 * neither aware of the other.
 *
 * FSRS defines stability as the interval at which retrievability reaches 0.90,
 * and the interval to any target r is (S/FACTOR) * (r^(1/DECAY) - 1). Measured
 * against the installed library, for a card at stability 19 (one successful
 * review of a fresh item):
 *
 *     r=0.97 -> 4.2 days   r=0.95 -> 7.7   r=0.90 -> 19   r=0.70 -> 177
 *
 * Anki documents 0.90 as a WORKLOAD balance -- higher retention means shorter
 * intervals and more reviews per day, and above 90% the workload climbs
 * steeply. That tradeoff does not apply here. In a flashcard app a review costs
 * the learner deliberate effort at a queue; here it is an NPC using a word in a
 * line the player was reading anyway, so the cost of re-exposure is close to
 * zero. What limits us is how many items fit naturally in a turn, and the
 * Teacher already caps that.
 *
 * So we sit above the flashcard balance point. 0.95 puts a brand-new item about
 * a day out and a reviewed one about a week, stretching as stability grows. Not
 * higher: at 0.97 intervals fall to half a day, nearly everything is always
 * due, and "due" stops telling anyone anything.
 */
export const DESIRED_RETENTION = 0.95;

/**
 * Retrievability below this = the learner is overdue on this item.
 *
 * Lives here rather than in the scheduler because it defines a LEARNER fact --
 * "is this card due" -- and 087 put it in the scheduler only because that was
 * the first caller.
 */
export const DUE_RETRIEVABILITY_FLOOR = DESIRED_RETENTION;

/**
 * At or above this retrievability the learner is treated as knowing the item.
 *
 * Sits ABOVE the desired retention, which is what keeps three bands meaningful
 * once the due floor became the retention target: known is freshly recalled,
 * `learning` is still above target but drifting toward it, and due is below.
 * With both numbers equal the middle band would be unreachable, and an
 * unreachable branch is worse than no branch.
 *
 * It measures "would they recall it right now", not "have they mastered it".
 * Mastery is a property of stability -- how durable the memory is -- and a card
 * can read as known here minutes after its first exposure. Keying this off
 * stability instead is a real improvement and a separate change.
 */
export const KNOWN_RETRIEVABILITY_FLOOR = 0.98;

export const LEARNING_STATUSES = [
  "unseen",
  "learning",
  "due",
  "known",
  "out-of-reach"
] as const;

/**
 * Where a learner stands on one item.
 *
 * Ordered roughly by progression, except `out-of-reach`, which is not a stage
 * the learner passes through -- it is a statement about the item being too far
 * above their band to be worth teaching yet. It wins over the others because a
 * card's history does not make an out-of-reach item teachable.
 */
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export interface LearningStatusInput {
  /** The learner's card for this item, when one exists. */
  card: LemmaCard | undefined;
  /** The item's band, from the atlas. Undefined when the atlas cannot place it. */
  itemBand: CEFRBand | undefined;
  learnerBand: CEFRBand;
  /**
   * How far above the learner's band still counts as in-reach.
   *
   * Defaults to 1 (band+1), matching the budgeter's envelope. Deliberately a
   * parameter and NOT a shared constant: the scheduler's stretch gate uses a
   * different delta on a different entity, and folding them into one number
   * would admit every band+1 competency unconditionally.
   */
  reachDelta?: number;
}

/**
 * Total and deterministic: every (card, band) pair yields exactly one status.
 *
 * Order of checks is load-bearing:
 *   1. out-of-reach first -- a learner may have a card for a word above their
 *      band (seen in passing, or after a band drop). Teaching it is still wrong,
 *      so reach beats history.
 *   2. unseen -- no card at all, or a card that has never been reviewed.
 *   3. known / due -- both read retrievability, so the higher floor is tested
 *      first or everything known would also read as due.
 */
export function getLearningStatus(input: LearningStatusInput): LearningStatus {
  const reachDelta = input.reachDelta ?? 1;

  // An item the atlas cannot band is treated as in-reach rather than
  // out-of-reach: absent evidence is not evidence of difficulty, and silently
  // withholding every unbanded word is the failure mode that is hardest to see.
  if (input.itemBand !== undefined) {
    const itemIndex = bandIndex(input.itemBand);
    const learnerIndex = bandIndex(input.learnerBand);
    if (itemIndex >= 0 && learnerIndex >= 0 && itemIndex > learnerIndex + reachDelta) {
      return "out-of-reach";
    }
  }

  const card = input.card;
  if (!card || card.reviewCount === 0) {
    return "unseen";
  }

  if (card.retrievability >= KNOWN_RETRIEVABILITY_FLOOR) {
    return "known";
  }

  if (card.retrievability < DUE_RETRIEVABILITY_FLOOR) {
    return "due";
  }

  return "learning";
}
