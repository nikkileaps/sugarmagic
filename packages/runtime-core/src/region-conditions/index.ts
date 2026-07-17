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
  activeQuest: RegionConditionQuestState | null;
  /** Truthy when the world flag `key` holds `value` (value omitted => any). */
  hasWorldFlag?: (key: string, value?: unknown) => boolean;
}

/**
 * Coerce an authored string flag value into the comparison type the flag
 * store holds. `null` boolean => `true` (a bare "flag is set" check);
 * `null`/unparseable number => `undefined` (no constraint).
 */
export function coerceWorldFlagValue(
  condition: RegionBehaviorWorldFlagCondition
): string | boolean | number | undefined {
  if (condition.valueType === "boolean") {
    if (condition.value === null) {
      return true;
    }
    return condition.value.toLowerCase() === "true";
  }
  if (condition.valueType === "number") {
    if (condition.value === null) {
      return undefined;
    }
    const parsed = Number(condition.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return condition.value ?? undefined;
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
  if (
    binding.questDefinitionId &&
    context.activeQuest?.questDefinitionId !== binding.questDefinitionId
  ) {
    return false;
  }
  if (
    binding.questStageId &&
    context.activeQuest?.stageId !== binding.questStageId
  ) {
    return false;
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
