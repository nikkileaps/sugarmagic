/**
 * Content validation: the one checker over authored content, with two callers.
 *
 * The quest editor renders what it finds for the selected quest, and the save
 * refuses when it finds something that would ship broken. One enforcer, so the
 * panel and the gate can never disagree about what "broken" means.
 *
 * Severity is what lets one checker serve both. An `error` refuses the save; a
 * `warning` is reported and does not. The split is deliberate: half-authored
 * content is normal mid-session and must stay saveable, while a reference to
 * something that does not exist is content that cannot work in play.
 *
 * `issues` matches `MechanicsValidationResult` (`runtime-core/src/mechanics/
 * validation/structural.ts`) rather than inventing a second word for the same
 * idea, which is why this adds `severity` to that shape instead of renaming it.
 */

import { tasksAreAmbiguous } from "../behavior-specificity";
import { getAllScenes } from "../episodes";
import type { GameProject } from "../game-project";
import type {
  QuestConditionDefinition,
  QuestDefinition,
  QuestStageDefinition
} from "../quest-definition";
import type {
  RegionBehaviorQuestBinding,
  RegionDocument
} from "../region-authoring";
import {
  findDuplicateWorldFlagNames,
  isBlankWorldFlagValue
} from "../world-flag";
import { collectWorldFlagReferences } from "../world-flag/references";

export type ContentValidationSeverity = "error" | "warning";

export interface ContentValidationIssue {
  /** Where the problem is, written for an author to read. */
  path: string;
  message: string;
  severity: ContentValidationSeverity;
}

export interface ContentValidationResult {
  /** False when any issue is an error. Warnings do not make content invalid. */
  valid: boolean;
  issues: ContentValidationIssue[];
}

function warning(path: string, message: string): ContentValidationIssue {
  return { path, message, severity: "warning" };
}

function error(path: string, message: string): ContentValidationIssue {
  return { path, message, severity: "error" };
}

/**
 * A stage with no nodes completes the moment it starts, so a next-stage loop
 * made only of empty stages never settles on anything. The runtime parks the
 * quest rather than hanging; this is where the author finds out.
 */
function emptyStageLoop(quest: QuestDefinition): string[] {
  const stagesById = new Map(
    quest.stageDefinitions.map((stage) => [stage.stageId, stage])
  );
  const reported = new Set<string>();
  const messages: string[] = [];

  for (const start of quest.stageDefinitions) {
    if (reported.has(start.stageId)) continue;
    const path: string[] = [];
    const seen = new Set<string>();
    let stage: QuestStageDefinition | undefined = start;

    while (stage && stage.nodeDefinitions.length === 0) {
      if (seen.has(stage.stageId)) {
        for (const stageId of path) reported.add(stageId);
        messages.push(
          `Stages ${path
            .map(
              (stageId) =>
                `"${stagesById.get(stageId)?.displayName ?? stageId}"`
            )
            .join(
              " -> "
            )} have no nodes and loop back on each other, so the quest can never move past them.`
        );
        break;
      }
      seen.add(stage.stageId);
      path.push(stage.stageId);
      stage = stage.nextStageId ? stagesById.get(stage.nextStageId) : undefined;
    }
  }
  return messages;
}

/** Every flag condition inside a condition tree, including under `not`. */
function worldFlagConditions(
  condition: QuestConditionDefinition | undefined
): Extract<QuestConditionDefinition, { type: "hasFlag" }>[] {
  if (!condition) return [];
  if (condition.type === "hasFlag") return [condition];
  if (condition.type === "not") return worldFlagConditions(condition.condition);
  return [];
}

/**
 * What is wrong with one quest. Everything here is a warning: a quest is
 * half-authored for most of its life, and a save that refused an unfinished
 * talk node would make the editor unusable.
 */
export function validateQuest(quest: QuestDefinition): ContentValidationIssue[] {
  const path = `quest "${quest.displayName}"`;
  const issues: ContentValidationIssue[] = [];
  const stageIds = new Set(quest.stageDefinitions.map((stage) => stage.stageId));

  if (!stageIds.has(quest.startStageId)) {
    issues.push(warning(path, "Start stage is missing."));
  }
  for (const message of emptyStageLoop(quest)) {
    issues.push(warning(path, message));
  }

  for (const stage of quest.stageDefinitions) {
    if (stage.nextStageId && !stageIds.has(stage.nextStageId)) {
      issues.push(
        warning(path, `Stage "${stage.displayName}" points to a missing next stage.`)
      );
    }
    if (stage.nodeDefinitions.length === 0) {
      issues.push(warning(path, `Stage "${stage.displayName}" has no nodes.`));
      continue;
    }

    const nodeIds = new Set(stage.nodeDefinitions.map((node) => node.nodeId));
    for (const node of stage.nodeDefinitions) {
      const at = `${path} node "${node.displayName}"`;

      for (const prerequisiteNodeId of node.prerequisiteNodeIds) {
        if (!nodeIds.has(prerequisiteNodeId)) {
          issues.push(
            warning(at, `Node "${node.displayName}" has a missing prerequisite.`)
          );
        }
      }
      for (const failTargetNodeId of node.failTargetNodeIds) {
        if (!nodeIds.has(failTargetNodeId)) {
          issues.push(
            warning(at, `Node "${node.displayName}" has a missing fail target.`)
          );
        }
      }
      if (
        (node.nodeBehavior === "condition" || node.nodeBehavior === "branch") &&
        !node.condition
      ) {
        issues.push(
          warning(at, `Node "${node.displayName}" is missing a condition.`)
        );
      }
      for (const flagCondition of worldFlagConditions(node.condition)) {
        if (!flagCondition.worldFlagId) {
          issues.push(
            warning(
              at,
              `Node "${node.displayName}" has a flag condition with no flag picked.`
            )
          );
        } else if (isBlankWorldFlagValue(flagCondition.value)) {
          issues.push(
            warning(
              at,
              `Node "${node.displayName}" checks a flag with no value, so it never matches.`
            )
          );
        }
      }
      for (const action of [...node.onEnterActions, ...node.onCompleteActions]) {
        if (action.type === "setFlag" && isBlankWorldFlagValue(action.value)) {
          issues.push(
            warning(at, `Node "${node.displayName}" sets a flag with no value.`)
          );
        }
      }
      if (node.nodeBehavior === "objective") {
        if (node.objectiveSubtype === "location" && !node.targetAreaId) {
          issues.push(
            warning(
              at,
              `Location node "${node.displayName}" has no target area, so nothing completes it.`
            )
          );
        }
        if (node.objectiveSubtype === "talk" && !node.targetId) {
          issues.push(
            warning(at, `Talk node "${node.displayName}" has no NPC target.`)
          );
        }
        if (node.objectiveSubtype === "talk" && !node.dialogueDefinitionId) {
          issues.push(
            warning(at, `Talk node "${node.displayName}" has no dialogue linked.`)
          );
        }
        if (node.objectiveSubtype === "collect" && !node.targetId) {
          issues.push(
            warning(at, `Collect node "${node.displayName}" has no item target.`)
          );
        }
        if (node.objectiveSubtype === "castSpell" && !node.targetId) {
          issues.push(
            warning(at, `Cast Spell node "${node.displayName}" has no spell target.`)
          );
        }
      }
      if (
        node.nodeBehavior === "narrative" &&
        node.narrativeSubtype === "dialogue" &&
        !node.dialogueDefinitionId
      ) {
        issues.push(
          warning(at, `Narrative node "${node.displayName}" has no dialogue selected.`)
        );
      }
    }
  }

  return issues;
}

/** Every quest binding in the project and its regions, with where it sits. */
function collectQuestBindings(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): Array<{ binding: RegionBehaviorQuestBinding; where: string }> {
  const bindings: Array<{
    binding: RegionBehaviorQuestBinding;
    where: string;
  }> = [];

  for (const region of regions) {
    for (const behavior of region.behaviors) {
      for (const task of behavior.tasks) {
        bindings.push({
          binding: task.activation,
          where: `region "${region.displayName}" behavior "${behavior.displayName}" task activation`
        });
      }
    }
    for (const volume of region.volumes ?? []) {
      if (volume.condition) {
        bindings.push({
          binding: volume.condition,
          where: `region "${region.displayName}" volume "${volume.volumeId}" gate`
        });
      }
    }
    // A resident's spawn condition validates like a Scene placement's; the
    // region owns this one, so it is reachable with no Scene at all.
    for (const presence of region.npcPresences) {
      if (presence.condition) {
        bindings.push({
          binding: presence.condition,
          where: `region "${region.displayName}" NPC placement`
        });
      }
    }
  }
  for (const scene of getAllScenes(gameProject.episodes)) {
    for (const [regionId, overlay] of Object.entries(scene.regionOverlays)) {
      for (const presence of overlay.npcPresences) {
        if (presence.condition) {
          bindings.push({
            binding: presence.condition,
            where: `scene "${scene.displayName}" NPC placement in region "${regionId}"`
          });
        }
      }
    }
  }
  return bindings;
}

/**
 * Everything wrong with the project's authored content.
 *
 * The errors are references to things that do not exist. Those cannot be fixed
 * by playing further and cannot work in play, so they refuse the save; every
 * other finding is reported and lets the save through.
 */
export function validateProjectContent(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];

  for (const quest of gameProject.questDefinitions) {
    issues.push(...validateQuest(quest));
  }

  // The name is the runtime store key. A blank one is a key nothing can write
  // on purpose and nothing can read back.
  for (const definition of gameProject.worldFlagDefinitions) {
    if (definition.name.trim().length === 0) {
      issues.push(
        error(
          "world flags",
          `The flag "${definition.displayName}" has a blank name. A flag's name is the key it is stored under at runtime.`
        )
      );
    }
  }

  // Two entries with one name share a slot in the runtime store, so two flags
  // the author sees as separate would read and write each other's value.
  for (const name of findDuplicateWorldFlagNames(
    gameProject.worldFlagDefinitions
  )) {
    issues.push(
      error(
        "world flags",
        `More than one flag is named "${name}". Two flags with one name share a value at runtime.`
      )
    );
  }

  const knownFlagIds = new Set(
    gameProject.worldFlagDefinitions.map((definition) => definition.definitionId)
  );
  for (const reference of collectWorldFlagReferences(gameProject, regions)) {
    if (!knownFlagIds.has(reference.worldFlagId)) {
      issues.push(
        error(
          reference.where,
          `References world flag "${reference.worldFlagId}", which is not in the project's flag registry.`
        )
      );
    }
  }

  // A volume trigger's flag write names a flag by store key, not by id, so the
  // reference walk cannot see it and a rename cannot follow it. A key matching
  // no registered flag writes a flag nothing reads -- the silent miss this
  // registry exists to remove. A warning rather than an error: the field is
  // legacy and #216 deletes it, and refusing the save over it would block a
  // project that plays correctly today.
  const knownFlagNames = new Set(
    gameProject.worldFlagDefinitions.map((definition) => definition.name)
  );
  for (const region of regions) {
    for (const volume of region.volumes ?? []) {
      const key = volume.trigger?.action.setWorldFlag?.key;
      if (!key || knownFlagNames.has(key)) continue;
      issues.push(
        warning(
          `region "${region.displayName}" volume "${volume.volumeId}" trigger`,
          `Sets world flag "${key}", which is not a registered flag name. Nothing reads it.`
        )
      );
    }
  }

  // A story point is authored as ids with no validation anywhere else, so a
  // quest or node that has since been deleted is only caught here.
  const nodeIdsByQuest = new Map(
    gameProject.questDefinitions.map((quest) => [
      quest.definitionId,
      new Set(
        quest.stageDefinitions.flatMap((stage) =>
          stage.nodeDefinitions.map((node) => node.nodeId)
        )
      )
    ])
  );
  for (const { binding, where } of collectQuestBindings(gameProject, regions)) {
    const questDefinitionId = binding.questDefinitionId;
    if (!questDefinitionId) continue;
    const nodeIds = nodeIdsByQuest.get(questDefinitionId);
    if (!nodeIds) {
      issues.push(
        error(
          where,
          `Names quest "${questDefinitionId}", which is not in the project.`
        )
      );
      continue;
    }
    if (binding.questNodeId && !nodeIds.has(binding.questNodeId)) {
      issues.push(
        error(
          where,
          `Names node "${binding.questNodeId}", which is not in quest "${questDefinitionId}".`
        )
      );
    }
  }

  issues.push(...findAmbiguousBehaviorTasks(gameProject, regions));

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

/**
 * Pairs of tasks on one NPC that can be live at the same moment with
 * neither being the narrower instruction.
 *
 * An NPC's tasks work by one overriding another: "block the way during
 * the Introduction quest" sits on top of "supervise the docks", and the
 * NPC drops back to supervising when the quest ends. That only works
 * while every pair has a narrower one. Two tasks asking unrelated
 * questions -- one about a quest, one about a world flag -- give no
 * answer for the moments both apply, and the author has to say which
 * they meant by making one of them narrower.
 *
 * A warning, not an error. The project plays: the runtime keeps the
 * earlier task, so this is a question to settle rather than a reason to
 * refuse a save mid-edit.
 */
function findAmbiguousBehaviorTasks(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  for (const region of regions) {
    for (const behavior of region.behaviors) {
      for (let index = 0; index < behavior.tasks.length; index += 1) {
        for (let other = index + 1; other < behavior.tasks.length; other += 1) {
          const left = behavior.tasks[index]!;
          const right = behavior.tasks[other]!;
          if (
            !tasksAreAmbiguous(left, right, gameProject.questDefinitions)
          ) {
            continue;
          }
          issues.push(
            warning(
              `region "${region.displayName}" behavior "${behavior.displayName}"`,
              `Tasks "${left.displayName}" and "${right.displayName}" can both apply at once and neither is more specific, so which one runs is not decided by anything authored. Narrow one of them.`
            )
          );
        }
      }
    }
  }
  return issues;
}

/** The errors only, for a caller that reports what is blocking a save. */
export function blockingIssues(
  result: ContentValidationResult
): ContentValidationIssue[] {
  return result.issues.filter((issue) => issue.severity === "error");
}
