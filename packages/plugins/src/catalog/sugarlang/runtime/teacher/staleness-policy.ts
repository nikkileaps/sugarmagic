/**
 * packages/plugins/src/catalog/sugarlang/runtime/teacher/staleness-policy.ts
 *
 * Purpose: Whether an out-of-date directive may be served for one more turn
 *   while a replacement is written in the background.
 *
 * WHY THIS IS ITS OWN FILE
 *   It is the correctness core of 7gp.1 and it is one decision: can the player
 *   read a line planned before this happened, or not. Everything else in that
 *   story is plumbing.
 *
 * THE DISTINCTION
 *   A directive dies for two unrelated kinds of reason, and they are not
 *   equally safe to answer late:
 *
 *     THE LEARNER MOVED ALONG. The world is unchanged; the plan is merely one
 *     word behind. Serving it costs one turn in which the Teacher does not yet
 *     know about the word just produced -- so it may reinforce it once more,
 *     which is harmless. The directive is built to live 20 turns
 *     (schema-parser.ts maxTurns), so a single turn of lag is inside a
 *     tolerance the design already accepts.
 *
 *     THE WORLD CHANGED. The plan is now about the WRONG PLACE. Serving it
 *     would have the NPC teaching dock words in a forest. No latency win is
 *     worth that, so these keep the player waiting.
 *
 * DEFAULT IS BLOCKING. `deferrable` is an explicit allow-list over a total
 * switch: adding an InvalidationReason without classifying it fails to
 * compile, rather than silently inheriting the fast path. A wrong answer here
 * is a teaching bug that no timing measurement would ever surface.
 *
 * Exports:
 *   - isDeferrableStaleness
 *
 * Status: active
 */

import type { InvalidationReason } from "./directive-cache";

/** True when this staleness may be answered a turn late. */
export function isDeferrableStaleness(reason: InvalidationReason): boolean {
  switch (reason) {
    // The learner moved along; the world did not.
    case "learner_change":
      return true;
    // A backstop against a situation key that never moves. Firing it one turn
    // late means 21 turns on a directive instead of 20, which is nothing.
    //
    // REVISIT TRIGGER: deferring this weakens the backstop it comes from. If
    // background re-plans fail repeatedly -- the gateway down, the model
    // erroring -- every turn serves the same stale directive and retries, so
    // "one directive forever" becomes reachable again, which is the exact
    // failure maxTurns exists to bound. That is currently the RIGHT
    // degradation (a playable turn on an old plan beats a blocked one), and it
    // is bounded by nothing. If teacher.invocation-failed ever shows sustained
    // background failures in play, bound the deferral here: after N
    // consecutive stale-serves with no successful re-plan, return false and
    // make the player wait.
    case "max_turns_exceeded":
      return true;

    // The world changed. The outgoing plan is about somewhere else.
    case "situation_change":
    case "quest_stage_change":
    case "location_change":
      return false;
    // The player switched language: what they need changed, and the outgoing
    // plan's posture and ratio are the things that answer it. Not deferrable.
    case "player_code_switch":
      return false;
    // Something asked for a re-plan on purpose. Honour it now.
    case "manual":
      return false;

    default: {
      // Exhaustiveness: a new reason must be classified here deliberately.
      const unhandled: never = reason;
      void unhandled;
      return false;
    }
  }
}
