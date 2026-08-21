/**
 * Region quest/flag condition grammar (Plan 069.5).
 *
 * The SINGLE evaluator for `RegionBehaviorQuestBinding` — the quest +
 * world-flag activation grammar authored on NPC behavior tasks
 * (`activation`) and, since 069.5, containment-boundary volumes
 * (`condition`). Behavior task selection (behavior/system.ts) and the
 * containment gate (collision) both route through here so "the same
 * flag/quest grammar" stays literally one function.
 *
 * Pure + framework-free: the caller supplies the active quest snapshot and
 * a world-flag predicate; this module owns only the matching rules and the
 * value coercion the flag comparison needs.
 */

import type {
  RegionBehaviorQuestBinding,
  RegionBehaviorWorldFlagCondition
} from "@sugarmagic/domain";

/** The active quest snapshot a binding is evaluated against. */
export interface RegionConditionQuestState {
  questDefinitionId: string;
  stageId: string | null;
}

export interface RegionConditionContext {
  /**
   * Every quest in progress, with the stage it is on. A binding is satisfied
   * when ANY of them matches -- not the one the player has selected in their
   * journal, which is a display choice and must not decide where NPCs stand or
   * which doors open.
   */
  activeQuests: RegionConditionQuestState[];
  /** Truthy when the world flag `key` holds `value` (value omitted => any). */
  hasWorldFlag?: (key: string, value?: unknown) => boolean;
  /** Truthy when that quest node has been completed at any point. */
  isNodeCompleted?: (questDefinitionId: string, nodeId: string) => boolean;
}

/**
 * Coerce an authored flag value into the type the flag store holds, for both
 * reading and writing. One function so the two sides cannot disagree: a
 * condition compares with `===`, so a value written one way and read another
 * never matches, which is a silent miss with nothing to see at authoring time.
 *
 * A valueless declaration falls back to the declared type's zero (`0` / `""` /
 * `true`) rather than to "no constraint". Authoring a condition with no value
 * is refused in the editor, so this fallback only catches content authored
 * before that check existed.
 */
export function coerceWorldFlagValue(
  condition: RegionBehaviorWorldFlagCondition
): string | boolean | number {
  if (condition.valueType === "boolean") {
    if (condition.value === null) {
      return true;
    }
    return condition.value.toLowerCase() === "true";
  }
  if (condition.valueType === "number") {
    const parsed = Number(condition.value);
    return condition.value !== null && Number.isFinite(parsed) ? parsed : 0;
  }
  return condition.value ?? "";
}

/**
 * The value to write when setting a world flag. Same rule as reading -- see
 * `coerceWorldFlagValue`. Kept as its own name because #216 removes the
 * region-side flag writer and this is the seam it deletes.
 */
export function resolveWorldFlagWriteValue(
  condition: RegionBehaviorWorldFlagCondition
): string | number | boolean {
  return coerceWorldFlagValue(condition);
}

/**
 * True when every populated clause of the binding is satisfied. An
 * all-null binding is vacuously satisfied (the behavior system's "default
 * task" fallback relies on this). Missing quest / flag predicate => the
 * corresponding populated clause fails closed.
 */
export function evaluateRegionQuestBinding(
  binding: RegionBehaviorQuestBinding,
  context: RegionConditionContext
): boolean {
  // Both quest clauses are checked against the SAME quest. Checking them
  // separately would let quest X from one active quest and a stage from
  // another jointly satisfy a binding that neither satisfies.
  if (binding.questDefinitionId || binding.questStageId) {
    const matched = context.activeQuests.some(
      (quest) =>
        (!binding.questDefinitionId ||
          quest.questDefinitionId === binding.questDefinitionId) &&
        (!binding.questStageId || quest.stageId === binding.questStageId)
    );
    if (!matched) {
      return false;
    }
  }
  if (binding.nodeCompleted) {
    if (
      !context.isNodeCompleted ||
      !context.isNodeCompleted(
        binding.nodeCompleted.questDefinitionId,
        binding.nodeCompleted.nodeId
      )
    ) {
      return false;
    }
  }
  if (binding.worldFlagEquals?.key) {
    if (!context.hasWorldFlag) {
      return false;
    }
    const expectedValue = coerceWorldFlagValue(binding.worldFlagEquals);
    if (!context.hasWorldFlag(binding.worldFlagEquals.key, expectedValue)) {
      return false;
    }
  }
  return true;
}
