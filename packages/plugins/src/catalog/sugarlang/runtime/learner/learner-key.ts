/**
 * packages/plugins/src/catalog/sugarlang/runtime/learner/learner-key.ts
 *
 * Purpose: A stable identity for WHAT THE LEARNER KNOWS. Moves when their
 *   knowledge changes materially; still when it does not.
 *
 * WHY IT IS SEPARATE FROM THE SITUATION KEY
 *   nikki, 2026-07-30: *"the situation key doesn't and it SHOULDN'T know
 *   anything about the learner -- I do not want to conflate the situation (the
 *   world) with the learner (the player's knowledge of the language)."*
 *
 *   Folding learner state into the situation key was the obvious shortcut and it
 *   would have quietly destroyed the epic's central distinction. The SITUATION is
 *   the world: this scene, this quest node, this hour. The LEARNER is the
 *   person. They are the Teacher's two doors in (090.4), they change for
 *   completely unrelated reasons, and a cached decision is valid only while BOTH
 *   still hold. Two keys, checked independently.
 *
 * WHY `ItemProgress` AND NOT RETRIEVABILITY
 *   Retrievability is a decaying float -- it changes every turn, so a key built
 *   on it would re-plan constantly and put us back on the per-turn treadmill the
 *   situation key removed. `ItemProgress` is five coarse values, so the key
 *   moves on a TRANSITION: unseen -> learning when the player first produces a
 *   word, learning -> due when it decays past the floor. That is what
 *   "materially" means.
 *
 * WHAT THIS COMPLETES
 *   The pipeline already existed end to end and nothing read the end of it:
 *
 *     player types "queso"
 *       -> observe records produced-typed   (sugar-lang-observe-middleware)
 *       -> reducer applies it               (learner-state-reducer)
 *       -> FSRS updates the card
 *       -> getItemProgress flips          <- this was where it stopped
 *
 *   Now the flip moves this key, the cached directive retires, and the Teacher
 *   decides again knowing the word landed.
 *
 * Exports:
 *   - learnerKey
 *
 * Relationships:
 *   - Reads a LearnerProfile and nothing else. Reuses `sha256Hex` from the
 *     compile content-hash rather than adding a second digest.
 *
 * Implements: Plan 090 story 090.4
 *
 * Status: active
 */

import { sha256Hex } from "../compile/content-hash";
import type { LearnerProfile } from "./learner-profile";
import { getItemProgress } from "./item-progress";

/**
 * Digest of the learner's band plus the ItemProgress of every card they hold.
 *
 * The band is in the key because a re-estimate changes what is teachable at all
 * -- it moves the out-of-reach boundary for every item at once.
 *
 * Sorted so the digest is order-independent; a Record's iteration order is not
 * something to hang cache validity on.
 */
export function learnerKey(learner: LearnerProfile): string {
  const statuses = Object.values(learner.lemmaCards)
    .map((card) => {
      const status = getItemProgress({
        card,
        // The card carries the band it was seeded with, so this needs no atlas.
        itemBand: card.cefrPriorBand,
        learnerBand: learner.estimatedCefrBand
      });
      return { lemmaId: card.lemmaId, status };
    })
    // `unseen` CARDS ARE OMITTED, and this is load-bearing.
    //
    // `getItemProgress` returns "unseen" for a missing card AND for a card
    // with no reviews -- they are the same state, so they must digest the same
    // way. Including unseen cards meant the key moved every time a card was
    // merely CREATED, which happens whenever a word is shown; the Teacher then
    // re-planned every turn and we were back on the treadmill the situation key
    // removed. Caught by an integration test expecting one invocation and
    // getting two.
    //
    // Same discipline as everywhere else in this epic: two representations of
    // one state must not look like a change.
    .filter((entry) => entry.status !== "unseen")
    .map((entry) => `${entry.lemmaId}:${entry.status}`)
    .sort();

  return sha256Hex([`band:${learner.estimatedCefrBand}`, ...statuses].join("|"));
}
