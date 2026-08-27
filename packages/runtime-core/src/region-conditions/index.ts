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
  /**
   * Truthy when the flag that `worldFlagId` references holds `value`. Takes a
   * reference, not a store key -- the caller supplies a predicate that
   * resolves, so this module never needs the flag registry.
   */
  hasWorldFlag?: (worldFlagId: string, value?: unknown) => boolean;
  /** Truthy when that quest node has been completed at any point. */
  isNodeCompleted?: (questDefinitionId: string, nodeId: string) => boolean;
  /** Truthy while that node is the one being worked on. */
  isNodeActive?: (questDefinitionId: string, nodeId: string) => boolean;
  /** Truthy once that quest has finished, and from then on. */
  isQuestCompleted?: (questDefinitionId: string) => boolean;
  /** Truthy once that stage has finished, and from then on. */
  isStageCompleted?: (questDefinitionId: string, stageId: string) => boolean;
}

/**
 * The quest progress questions a story point can ask, in one object so the
 * four travel together instead of as four parameters through every layer
 * that forwards them.
 *
 * `QuestManager` implements all four; anything holding one can supply this.
 */
export type QuestProgressReader = Pick<
  RegionConditionContext,
  "isNodeCompleted" | "isNodeActive" | "isQuestCompleted" | "isStageCompleted"
>;

/**
 * The declared type and authored text of a flag value -- the only parts the
 * coercion reads. Narrower than the full condition so the volume trigger's
 * flag assignment, which names its flag differently, shares the one rule.
 */
export type WorldFlagValueDeclaration = Pick<
  RegionBehaviorWorldFlagCondition,
  "valueType" | "value"
>;

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
 *
 * Text that does not parse as the declared number is a different case, and
 * returns `NaN` rather than that zero. `NaN === NaN` is false, so the condition
 * matches nothing -- an authoring mistake reads as "not satisfied" instead of
 * quietly reading as "equals 0" and matching a flag that happens to hold zero.
 */
export function coerceWorldFlagValue(
  condition: WorldFlagValueDeclaration
): string | boolean | number {
  if (condition.valueType === "boolean") {
    if (condition.value === null) {
      return true;
    }
    return condition.value.toLowerCase() === "true";
  }
  if (condition.valueType === "number") {
    if (condition.value === null) {
      return 0;
    }
    return Number(condition.value);
  }
  return condition.value ?? "";
}

/**
 * The value to write when setting a world flag. Same rule as reading -- see
 * `coerceWorldFlagValue`. Kept as its own name because #216 removes the
 * region-side flag writer and this is the seam it deletes.
 *
 * Writing a number the author mistyped stores `NaN`, which JSON serializes as
 * `null`. That is a broken flag either way -- it matches no condition before or
 * after a save -- and it stays symmetric with the read rather than storing a
 * zero the read would not agree with. The one caller is the volume trigger
 * action #216 deletes.
 */
export function resolveWorldFlagWriteValue(
  condition: WorldFlagValueDeclaration
): string | number | boolean {
  return coerceWorldFlagValue(condition);
}

/**
 * Whether the story point named by this binding is satisfied.
 *
 * The point is the deepest of the three ids that is set -- a node if there is
 * one, otherwise a stage, otherwise the quest. `storyPointSide` says which
 * side of it counts:
 *
 *   "while"  the point is happening right now, and stops the moment it ends.
 *   "after"  the point has finished, and stays true from then on, including
 *            once the whole quest is over.
 *
 * Naming no quest names no point, which is satisfied always -- that is what
 * makes a task with nothing filled in the NPC's baseline.
 *
 * A missing predicate fails closed, so a caller that cannot answer "has this
 * finished" never gets a silent yes.
 */
function satisfiesStoryPoint(
  binding: RegionBehaviorQuestBinding,
  context: RegionConditionContext
): boolean {
  const questId = binding.questDefinitionId;
  const stageId = binding.questStageId;
  const nodeId = binding.questNodeId;
  if (!questId && !stageId) {
    return true;
  }

  if (binding.storyPointSide === "after") {
    if (nodeId && questId) {
      return context.isNodeCompleted?.(questId, nodeId) ?? false;
    }
    if (stageId && questId) {
      return context.isStageCompleted?.(questId, stageId) ?? false;
    }
    return questId ? context.isQuestCompleted?.(questId) ?? false : false;
  }

  // "while": the quest has to be in progress, and the stage and node have to
  // be the ones it is on. All three are checked against the SAME active quest
  // -- checking them apart would let a quest from one entry and a stage from
  // another jointly satisfy a binding that neither satisfies.
  const onPoint = context.activeQuests.some(
    (quest) =>
      (!questId || quest.questDefinitionId === questId) &&
      (!stageId || quest.stageId === stageId)
  );
  if (!onPoint) {
    return false;
  }
  // A node is "while" only between opening and completing -- not before its
  // prerequisites are met, and not after it is done.
  if (nodeId && questId) {
    return context.isNodeActive?.(questId, nodeId) ?? false;
  }
  return true;
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
  if (!satisfiesStoryPoint(binding, context)) {
    return false;
  }
  if (binding.worldFlagEquals?.worldFlagId) {
    if (!context.hasWorldFlag) {
      return false;
    }
    const expectedValue = coerceWorldFlagValue(binding.worldFlagEquals);
    if (!context.hasWorldFlag(binding.worldFlagEquals.worldFlagId, expectedValue)) {
      return false;
    }
  }
  return true;
}
