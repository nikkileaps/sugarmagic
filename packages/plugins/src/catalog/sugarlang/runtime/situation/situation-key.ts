/**
 * packages/plugins/src/catalog/sugarlang/runtime/situation/situation-key.ts
 *
 * Purpose: A stable identity for a situation. Two situations with the same key
 *   should produce the same teaching decision, so the key is what a cached
 *   directive is validated against.
 *
 * WHAT IS IN THE KEY, AND WHY THE REST IS NOT
 *   Only facts that change WHAT SHOULD BE TAUGHT belong here. Every field added
 *   costs an LLM call each time it moves, so the test for inclusion is "would a
 *   Teacher decide differently", not "is it part of the situation".
 *
 *     sceneId            a different scene is a different situation
 *     scene contentHash  the scene was rebuilt; its concepts may have changed
 *     quest + stage      the player is somewhere else in the story
 *     objective nodeIds  the current quest node -- what they are doing NOW
 *     timeOfDay          authored content and NPC availability turn on it
 *
 *   DELIBERATELY EXCLUDED: `knownFacts` and `recentWorldEvents`. Both change
 *   constantly -- every learned fact, every quest event -- and neither changes
 *   which vocabulary is worth teaching. Putting them in the key would re-slate
 *   on nearly every turn, which is the turn-based churn this key exists to
 *   replace. They still reach the Teacher through the prompt; they just do not
 *   invalidate a decision that is still correct.
 *
 * AVAILABILITY IS PART OF THE KEY
 *   An unavailable fact encodes differently from an available-but-empty one. A
 *   situation where the quest is unknown is NOT the same situation as one with
 *   no active quest, and a directive decided under one must not be reused under
 *   the other.
 *
 * Exports:
 *   - situationKey
 *   - describeSituationKeyChange
 *
 * Relationships:
 *   - Pure. Consumed by the directive cache to decide whether a cached decision
 *     still applies.
 *
 * Implements: Plan 090 story 090.3
 *
 * Status: active
 */

import type { RuntimeFact } from "./runtime-fact";
import type { Situation } from "./situation";

/** Encodes unavailable distinctly from any value a fact could hold. */
function part<T>(fact: RuntimeFact<T>, encode: (value: T) => string): string {
  return fact.available ? encode(fact.value) : "?";
}

export function situationKey(situation: Situation): string {
  const scene = part(situation.sceneContext, (model) => model.contentHash);

  const quest = part(situation.runtime.questStage, (stage) =>
    [stage.questId, stage.stageId ?? "-"].join("/")
  );

  // Sorted, so the same objectives in a different order are the same situation.
  const objectives = part(situation.runtime.questObjectives, (fact) =>
    [...fact.objectives.map((objective) => objective.nodeId)].sort().join(",")
  );

  const time = part(situation.runtime.timeOfDay, (band) => band);

  return [
    `scene:${situation.sceneId}`,
    `hash:${scene}`,
    `quest:${quest}`,
    `nodes:${objectives}`,
    `time:${time}`
  ].join("|");
}

/**
 * Which parts of the key moved, for a reader trying to find out why a cached
 * decision stopped applying.
 *
 * `situation_change` is one word for five different events -- the player walked
 * into another scene, the scene was rebuilt, a quest advanced, an objective
 * moved, the clock crossed a band -- and they call for different fixes. Which
 * one it was has been guessed at repeatedly and never measured, so this makes
 * the key say it.
 *
 * Pure, and returns a short string meant to sit on one log line.
 */
export function describeSituationKeyChange(
  plannedFor: string | undefined,
  now: string | undefined
): string {
  if (!plannedFor || !now) return "unknown (a key was missing)";
  if (plannedFor === now) return "no change";

  const read = (key: string): Map<string, string> =>
    new Map(
      key.split("|").map((part) => {
        const at = part.indexOf(":");
        return at === -1
          ? ([part, ""] as [string, string])
          : ([part.slice(0, at), part.slice(at + 1)] as [string, string]);
      })
    );

  const before = read(plannedFor);
  const after = read(now);
  const segments = [...new Set([...before.keys(), ...after.keys()])];
  const moved = segments
    .filter((segment) => before.get(segment) !== after.get(segment))
    .map(
      (segment) =>
        `${segment}: ${before.get(segment) ?? "(absent)"} -> ${after.get(segment) ?? "(absent)"}`
    );

  // A key that changed in no named segment means the FORMAT changed, which is
  // worth saying rather than reporting nothing moved.
  return moved.length > 0 ? moved.join("; ") : "the key format changed";
}
