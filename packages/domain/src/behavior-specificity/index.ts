/**
 * packages/domain/src/behavior-specificity/index.ts
 *
 * CHOOSING WHICH TASK AN NPC IS DOING
 *
 * An NPC has a list of tasks. Several can be live at the same moment, so
 * something has to pick one. The rule is that the MORE SPECIFIC task wins,
 * and "more specific" has an exact meaning here:
 *
 *   Task A is more specific than task B when every situation that turns A
 *   on would also have turned B on, and B is on in situations A is not.
 *
 * A is the narrower instruction, so A wins while it applies. When A stops
 * applying, B is still there and the NPC falls back to it. Nobody authors
 * the fallback -- it is just the next widest task that still matches.
 *
 * That is the whole point of writing behaviors this way. An author writes
 * "supervise the docks" as the baseline, then "block the way during the
 * Introduction quest" over the top of it, and never has to edit the first
 * one or say "unless the Introduction quest is running".
 *
 * WHY NOT COUNT THE CONDITIONS
 *
 * Counting how many boxes an author filled in looks equivalent and is not.
 * "Introduction + Arrival stage" and "Introduction + a world flag" both
 * fill two boxes, but only the first is narrower than "Introduction" --
 * the second is a different question, not a sharper version of the same
 * one. Counting cannot tell those apart, so it invents a winner where
 * there is no honest answer.
 *
 * Counting also gets it backwards: a task asking only for "Introduction"
 * really is narrower than one asking for "any quest, mornings only",
 * even though it filled in fewer boxes.
 *
 * STORY OUTRANKS THE CLOCK
 *
 * Comparison happens in two passes, in this order:
 *
 *   1. The story conditions -- which quest, stage, node, world flag.
 *   2. The time window, and only when the story conditions are identical.
 *
 * An author who ties a task to a quest is saying what this character must
 * be doing at this point in the story. Someone's daily routine does not
 * get to override that, however few hours the routine covers. So the time
 * window narrows a task but never promotes it past a story instruction.
 *
 * WHICH SIDE OF THE POINT
 *
 * A task names one point in the story -- a quest, a stage inside it, or a
 * node inside that -- and which side of it counts: while it is running, or
 * ever since it finished.
 *
 * The two sides are back to back. "While the Introduction quest runs" ends
 * at the exact moment "ever since the Introduction quest finished" begins,
 * so a pair like that hands over cleanly with no overlap and no gap.
 *
 * On the "while" side the deeper point is narrower, as you would expect. On
 * the "after" side it turns around, because things finish innermost first:
 * a node is done, then its stage, then the whole quest. So "ever since the
 * quest finished" covers less time than "ever since a node in it was done".
 *
 * WHEN THERE IS NO ANSWER
 *
 * Two tasks can both be live with neither narrower than the other --
 * "while the Introduction quest runs" against "while the upset flag is
 * set". Neither is a sharper version of the other, so there is no correct
 * pick. This reports `incomparable` rather than guessing, and the author is
 * told to make one of them narrower. Studio reports it; the runtime keeps
 * the earlier task so a player mid-session keeps playing.
 */

import type {
  RegionBehaviorQuestBinding,
  RegionNPCBehaviorTask
} from "../region-authoring/index";
import type { QuestDefinition } from "../quest-definition/index";
import { TIME_OF_DAY_BANDS } from "../quest-definition/index";

/**
 * How two tasks relate. `narrower` and `wider` are from the point of view
 * of the first task passed in.
 */
export type TaskSpecificityOrder =
  | "narrower"
  | "wider"
  | "equal"
  | "incomparable";

/**
 * Where a task sits in the quest structure, outermost first: the quest,
 * then the stage inside it, then the node inside that.
 *
 * A path is a prefix of a narrower one -- ["intro"] against
 * ["intro", "arrival"] -- which is what makes "inside" checkable.
 */
type QuestScopePath = readonly string[];

/**
 * The quest structure a task named, outermost first.
 *
 * A node sits inside a stage which sits inside a quest, so naming a node
 * names all three. The node's own quest wins over the Quest picker when
 * they disagree, because the node is the more exact statement -- and the
 * Studio picker only offers nodes from the selected quest anyway.
 *
 * Needs the quest definitions to find which stage a node belongs to. With
 * no definitions to hand the path stops at the node's quest, which stays
 * correct, just less precise.
 */
export function questScopePath(
  binding: RegionBehaviorQuestBinding,
  questDefinitions: readonly QuestDefinition[] = []
): QuestScopePath {
  const quest = binding.questDefinitionId;
  if (!quest) return [];
  const path: string[] = [quest];

  // The stage the author picked, or the one holding the node when they only
  // picked a node. Looking it up needs the quest definitions; without them
  // the path just stops one level shallower, which stays correct.
  const nodeId = binding.questNodeId ?? null;
  const stage =
    binding.questStageId ??
    (nodeId ? findStageHoldingNode(quest, nodeId, questDefinitions) : null);
  if (stage) path.push(stage);

  if (nodeId) path.push(nodeId);
  return path;
}

function findStageHoldingNode(
  questDefinitionId: string,
  nodeId: string,
  questDefinitions: readonly QuestDefinition[]
): string | null {
  const definition = questDefinitions.find(
    (candidate) => candidate.definitionId === questDefinitionId
  );
  const stage = definition?.stageDefinitions.find((candidate) =>
    candidate.nodeDefinitions.some(
      (nodeDefinition) => nodeDefinition.nodeId === nodeId
    )
  );
  return stage?.stageId ?? null;
}

/** Which side of its story point a binding is on. No point means no side. */
function storyPointSide(
  binding: RegionBehaviorQuestBinding
): "while" | "after" | null {
  if (!binding.questDefinitionId) return null;
  return binding.storyPointSide === "after" ? "after" : "while";
}

/** True when `outer` is `inner` or encloses it. */
function isPrefix(outer: QuestScopePath, inner: QuestScopePath): boolean {
  if (outer.length > inner.length) return false;
  return outer.every((step, index) => step === inner[index]);
}

/**
 * The world flag a task asks for, as a single comparable string, or null
 * when it asks for none. Two tasks asking about the same flag but a
 * different value can never both be live, so they need no ordering.
 */
function worldFlagKey(binding: RegionBehaviorQuestBinding): string | null {
  const flag = binding.worldFlagEquals;
  if (!flag?.worldFlagId) return null;
  return `${flag.worldFlagId}=${flag.valueType}:${flag.value ?? ""}`;
}

/**
 * Which of two story points covers less time.
 *
 * On the "while" side the deeper point is the narrower one, the way you
 * would expect: a stage runs for part of its quest, and a node for part of
 * its stage.
 *
 * On the "after" side it turns around. Things finish innermost first -- a
 * node completes, then the stage holding it, then the whole quest -- so
 * "ever since the quest finished" starts latest and covers the least.
 * "Ever since the Introduction quest finished" is inside "ever since its
 * farewell node was done", not the other way round.
 *
 * Opposite sides never enclose each other. "While the quest runs" and
 * "ever since a node in it was done" each cover time the other does not.
 */
function comparePoints(
  leftPath: QuestScopePath,
  leftSide: "while" | "after" | null,
  rightPath: QuestScopePath,
  rightSide: "while" | "after" | null
): { leftInsideRight: boolean; rightInsideLeft: boolean } {
  // Naming no quest names no point, which is every moment there is, so any
  // point at all sits inside it.
  if (leftSide === null && rightSide === null) {
    return { leftInsideRight: true, rightInsideLeft: true };
  }
  if (leftSide === null) {
    return { leftInsideRight: false, rightInsideLeft: true };
  }
  if (rightSide === null) {
    return { leftInsideRight: true, rightInsideLeft: false };
  }
  if (leftSide !== rightSide) {
    return { leftInsideRight: false, rightInsideLeft: false };
  }
  if (leftSide === "while") {
    return {
      leftInsideRight: isPrefix(rightPath, leftPath),
      rightInsideLeft: isPrefix(leftPath, rightPath)
    };
  }
  return {
    leftInsideRight: isPrefix(leftPath, rightPath),
    rightInsideLeft: isPrefix(rightPath, leftPath)
  };
}

/**
 * How the story conditions of two tasks relate, ignoring the clock.
 *
 * The story point and the world flag are compared on their own and the
 * answers have to agree. A task is narrower only if it is
 * narrower-or-equal on both and strictly narrower on at least one.
 * Disagreement -- narrower on the point, wider on the flag -- means
 * neither encloses the other.
 */
function compareStoryScope(
  left: RegionNPCBehaviorTask,
  right: RegionNPCBehaviorTask,
  questDefinitions: readonly QuestDefinition[]
): TaskSpecificityOrder {
  const point = comparePoints(
    questScopePath(left.activation, questDefinitions),
    storyPointSide(left.activation),
    questScopePath(right.activation, questDefinitions),
    storyPointSide(right.activation)
  );
  const leftFlag = worldFlagKey(left.activation);
  const rightFlag = worldFlagKey(right.activation);

  const leftInsideRight =
    point.leftInsideRight && (rightFlag === null || rightFlag === leftFlag);
  const rightInsideLeft =
    point.rightInsideLeft && (leftFlag === null || leftFlag === rightFlag);

  if (leftInsideRight && rightInsideLeft) return "equal";
  if (leftInsideRight) return "narrower";
  if (rightInsideLeft) return "wider";
  return "incomparable";
}

/** The bands a task covers. No window means every band. */
function coveredBands(task: RegionNPCBehaviorTask): ReadonlySet<string> {
  const bands = task.timeWindow?.bands;
  if (!bands || bands.length === 0) return new Set(TIME_OF_DAY_BANDS);
  return new Set(bands);
}

function isSubset(
  inner: ReadonlySet<string>,
  outer: ReadonlySet<string>
): boolean {
  for (const band of inner) {
    if (!outer.has(band)) return false;
  }
  return true;
}

/**
 * How two tasks rank against each other. `narrower` means the first one
 * should be chosen.
 *
 * Story conditions decide first. The clock is consulted only when the
 * story conditions are identical, so a routine can never displace a task
 * tied to the story.
 */
export function compareTaskSpecificity(
  left: RegionNPCBehaviorTask,
  right: RegionNPCBehaviorTask,
  questDefinitions: readonly QuestDefinition[] = []
): TaskSpecificityOrder {
  const story = compareStoryScope(left, right, questDefinitions);
  if (story !== "equal") return story;

  const leftBands = coveredBands(left);
  const rightBands = coveredBands(right);
  const leftInsideRight = isSubset(leftBands, rightBands);
  const rightInsideLeft = isSubset(rightBands, leftBands);

  if (leftInsideRight && rightInsideLeft) return "equal";
  if (leftInsideRight) return "narrower";
  if (rightInsideLeft) return "wider";
  return "incomparable";
}

/**
 * True when these two tasks could both be live and neither is narrower,
 * so which one runs is not decided by anything the author wrote.
 *
 * Tasks that can never be live together are not a problem: asking for
 * different quests, or the same flag at different values, means only one
 * of them can ever match.
 */
export function tasksAreAmbiguous(
  left: RegionNPCBehaviorTask,
  right: RegionNPCBehaviorTask,
  questDefinitions: readonly QuestDefinition[] = []
): boolean {
  if (compareTaskSpecificity(left, right, questDefinitions) !== "incomparable") {
    return false;
  }
  return canBeLiveTogether(left, right, questDefinitions);
}

/**
 * Whether any single moment could satisfy both tasks. Used to skip pairs
 * that only look ambiguous because they are mutually exclusive.
 */
function canBeLiveTogether(
  left: RegionNPCBehaviorTask,
  right: RegionNPCBehaviorTask,
  questDefinitions: readonly QuestDefinition[]
): boolean {
  const leftPath = questScopePath(left.activation, questDefinitions);
  const rightPath = questScopePath(right.activation, questDefinitions);
  const leftSide = storyPointSide(left.activation);
  const rightSide = storyPointSide(right.activation);

  if (leftSide === "while" && rightSide === "while") {
    // One active quest is on one stage at one node, so two "while" points
    // only overlap when one is inside the other.
    if (!isPrefix(leftPath, rightPath) && !isPrefix(rightPath, leftPath)) {
      return false;
    }
  }

  // The two sides of one point are back to back with no gap and no overlap:
  // "while the quest runs" has ended by the time "ever since it finished"
  // begins. Same for a point that encloses the other -- a stage inside a
  // quest is over before the quest is.
  if (leftSide && rightSide && leftSide !== rightSide) {
    const afterPath = leftSide === "after" ? leftPath : rightPath;
    const whilePath = leftSide === "after" ? rightPath : leftPath;
    if (isPrefix(afterPath, whilePath)) {
      return false;
    }
  }

  // The same flag cannot hold two values at once.
  const leftFlag = left.activation.worldFlagEquals;
  const rightFlag = right.activation.worldFlagEquals;
  if (
    leftFlag?.worldFlagId &&
    rightFlag?.worldFlagId &&
    leftFlag.worldFlagId === rightFlag.worldFlagId &&
    worldFlagKey(left.activation) !== worldFlagKey(right.activation)
  ) {
    return false;
  }

  // Windows that share no band never overlap.
  const leftBands = coveredBands(left);
  for (const band of coveredBands(right)) {
    if (leftBands.has(band)) return true;
  }
  return false;
}
