import type {
  DialogueCondition,
  DialogueDefinition
} from "../dialogue-definition";
import { mapScenes } from "../episodes";
import type { GameProject } from "../game-project";
import type {
  QuestActionDefinition,
  QuestConditionDefinition,
  QuestDefinition
} from "../quest-definition";
import {
  readWorldFlagReference,
  type RegionBehaviorQuestBinding,
  type RegionDocument
} from "../region-authoring";
import type { SpellDefinition } from "../spell-definition";
import type { WorldFlagValueType } from "./index";

/**
 * The content holding a reference, in ids. Carried alongside `where` because
 * `where` is prose for a person to read -- anything that needs to navigate to
 * the content reads this instead of parsing that.
 */
export type WorldFlagReferenceTarget =
  | {
      kind: "quest-node";
      questDefinitionId: string;
      stageId: string;
      nodeId: string;
    }
  | { kind: "dialogue-node"; dialogueDefinitionId: string; nodeId: string }
  | { kind: "spell"; spellDefinitionId: string }
  | {
      kind: "behavior-task";
      regionId: string;
      behaviorId: string;
      taskId: string;
    }
  | { kind: "volume"; regionId: string; volumeId: string }
  | {
      kind: "npc-placement";
      /** Null when the region owns the placement rather than a Scene. */
      sceneId: string | null;
      regionId: string;
      presenceId: string;
    };

/**
 * Where a world flag reference was found. `where` is written for an author to
 * read in a validation message, not parsed by anything.
 */
export interface WorldFlagReferenceSite {
  where: string;
  target: WorldFlagReferenceTarget;
  /** Declared by the region grammar; the quest and dialogue ones infer. */
  valueType?: WorldFlagValueType;
}

/**
 * Given a reference and where it sits, returns the reference to keep. Return
 * the input unchanged to leave content alone.
 */
export type WorldFlagReferenceVisitor = (
  worldFlagId: string,
  site: WorldFlagReferenceSite
) => string;

export interface WorldFlagReference {
  worldFlagId: string;
  where: string;
  target: WorldFlagReferenceTarget;
}

/**
 * Every place authored content names a world flag, walked once.
 *
 * Two callers need this exact traversal and would drift apart if each had its
 * own: the load-time migration rewrites what it finds, and content validation
 * reports it. So the walk lives here and the caller supplies what to do at
 * each site.
 *
 * Covers the project AND its regions, because a flag a quest writes can be
 * read by a region condition and the two live in different files. Adding a
 * surface that names a flag means adding it here, once.
 */
export function mapWorldFlagReferences(
  gameProject: GameProject,
  regions: readonly RegionDocument[],
  visit: WorldFlagReferenceVisitor
): { gameProject: GameProject; regions: RegionDocument[] } {
  function questCondition(
    condition: QuestConditionDefinition | undefined,
    site: WorldFlagReferenceSite
  ): QuestConditionDefinition | undefined {
    if (!condition) return condition;
    if (condition.type === "hasFlag") {
      return { ...condition, worldFlagId: visit(condition.worldFlagId, site) };
    }
    if (condition.type === "not") {
      const inner = questCondition(condition.condition, site);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function questAction(
    action: QuestActionDefinition,
    site: WorldFlagReferenceSite
  ): QuestActionDefinition {
    return action.type === "setFlag"
      ? { ...action, worldFlagId: visit(action.worldFlagId, site) }
      : action;
  }

  function dialogueCondition(
    condition: DialogueCondition | undefined,
    site: WorldFlagReferenceSite
  ): DialogueCondition | undefined {
    if (!condition) return condition;
    if (condition.type === "flag") {
      return { ...condition, worldFlagId: visit(condition.worldFlagId, site) };
    }
    if (condition.type === "not") {
      const inner = dialogueCondition(condition.condition, site);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function binding(
    value: RegionBehaviorQuestBinding,
    site: WorldFlagReferenceSite
  ): RegionBehaviorQuestBinding {
    // Read through the same helper the normalizer uses, so a region file that
    // still names its flag in the pre-206 `key` is visible here whether or not
    // it has been normalized yet. Without this the migration silently skips an
    // unnormalized region and the reference fails validation later.
    const reference = readWorldFlagReference(value.worldFlagEquals);
    if (!reference) return value;
    return {
      ...value,
      worldFlagEquals: {
        ...value.worldFlagEquals,
        valueType: value.worldFlagEquals?.valueType ?? "boolean",
        value: value.worldFlagEquals?.value ?? null,
        worldFlagId: visit(reference, {
          ...site,
          valueType: value.worldFlagEquals?.valueType
        })
      }
    };
  }

  const questDefinitions: QuestDefinition[] = gameProject.questDefinitions.map(
    (quest) => ({
      ...quest,
      stageDefinitions: quest.stageDefinitions.map((stage) => ({
        ...stage,
        nodeDefinitions: stage.nodeDefinitions.map((node) => {
          const where = `quest "${quest.displayName}" node "${node.displayName}"`;
          const target = {
            kind: "quest-node" as const,
            questDefinitionId: quest.definitionId,
            stageId: stage.stageId,
            nodeId: node.nodeId
          };
          return {
            ...node,
            condition: questCondition(node.condition, {
              where: `${where} condition`,
              target
            }),
            onEnterActions: node.onEnterActions.map((action) =>
              questAction(action, {
                where: `${where} on-enter action`,
                target
              })
            ),
            onCompleteActions: node.onCompleteActions.map((action) =>
              questAction(action, {
                where: `${where} on-complete action`,
                target
              })
            )
          };
        })
      }))
    })
  );

  // A dialogue's conditions hang off each node's outgoing edges.
  const dialogueDefinitions: DialogueDefinition[] =
    gameProject.dialogueDefinitions.map((dialogue) => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => ({
        ...node,
        next: node.next.map((edge) => ({
          ...edge,
          condition: dialogueCondition(edge.condition, {
            where: `dialogue "${dialogue.displayName}" node "${node.displayName ?? node.nodeId}"`,
            target: {
              kind: "dialogue-node",
              dialogueDefinitionId: dialogue.definitionId,
              nodeId: node.nodeId
            }
          })
        }))
      }))
    }));

  // A world-flag effect's `targetId` is a flag reference; on every other
  // effect type it means something else and must be left alone.
  const spellDefinitions: SpellDefinition[] = gameProject.spellDefinitions.map(
    (spell) => ({
      ...spell,
      effects: spell.effects.map((effect) =>
        effect.type === "world-flag" && effect.targetId
          ? {
              ...effect,
              targetId: visit(effect.targetId, {
                where: `spell "${spell.displayName}" world-flag effect`,
                target: {
                  kind: "spell",
                  spellDefinitionId: spell.definitionId
                }
              })
            }
          : effect
      )
    })
  );

  // Behavior task activations and containment-volume gates live in the region
  // file. `volumes` is absent in pre-069.4 files.
  //
  // A volume's `trigger.action.setWorldFlag` is NOT walked here, and cannot be:
  // it names a flag by store key rather than by id, so there is no reference to
  // rewrite or resolve. `validateProjectContent` reports one whose key matches
  // no registered flag name instead. #216 deletes the field, at which point the
  // volume's flag write becomes a quest action and joins this walk.
  const mappedRegions: RegionDocument[] = regions.map((region) => ({
    ...region,
    // A resident's spawn condition is a flag reference like any other. It
    // reaches the walk here rather than through the Scene loop below,
    // because the region owns it and no Scene needs to exist for it to
    // matter.
    npcPresences: region.npcPresences.map((presence) =>
      presence.condition
        ? {
            ...presence,
            condition: binding(presence.condition, {
              where: `region "${region.displayName}" NPC placement`,
              target: {
                kind: "npc-placement",
                sceneId: null,
                regionId: region.identity.id,
                presenceId: presence.presenceId
              }
            })
          }
        : presence
    ),
    behaviors: region.behaviors.map((behavior) => ({
      ...behavior,
      tasks: behavior.tasks.map((task) => ({
        ...task,
        activation: binding(task.activation, {
          where: `region "${region.displayName}" behavior "${behavior.displayName}" task activation`,
          target: {
            kind: "behavior-task",
            regionId: region.identity.id,
            behaviorId: behavior.behaviorId,
            taskId: task.taskId
          }
        })
      }))
    })),
    volumes: region.volumes?.map((volume) =>
      volume.condition
        ? {
            ...volume,
            condition: binding(volume.condition, {
              where: `region "${region.displayName}" volume "${volume.volumeId}" gate`,
              target: {
                kind: "volume",
                regionId: region.identity.id,
                volumeId: volume.volumeId
              }
            })
          }
        : volume
    )
  }));

  // NPC presence conditions are Scene-scoped, not region-scoped: they live on
  // Scene.regionOverlays, inside the Episode that owns the Scene.
  const episodes = mapScenes(gameProject.episodes, (scene) => ({
    ...scene,
    regionOverlays: Object.fromEntries(
      Object.entries(scene.regionOverlays).map(([regionId, overlay]) => [
        regionId,
        {
          ...overlay,
          npcPresences: overlay.npcPresences.map((presence) =>
            presence.condition
              ? {
                  ...presence,
                  condition: binding(presence.condition, {
                    where: `scene "${scene.displayName}" NPC placement in region "${regionId}"`,
                    target: {
                      kind: "npc-placement",
                      sceneId: scene.sceneId,
                      regionId,
                      presenceId: presence.presenceId
                    }
                  })
                }
              : presence
          )
        }
      ])
    )
  }));

  return {
    gameProject: {
      ...gameProject,
      questDefinitions,
      dialogueDefinitions,
      spellDefinitions,
      episodes
    },
    regions: mappedRegions
  };
}

/**
 * Every world flag reference in the project, with a readable location. Reads
 * only -- the mapped copy is thrown away.
 *
 * Content validation uses this to report dangling references. Filtering it by
 * `worldFlagId` is also how a delete says how much content it is about to
 * orphan: the World Flags workspace warns with it before dispatching
 * `DeleteWorldFlagDefinition`.
 */
export function collectWorldFlagReferences(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): WorldFlagReference[] {
  const references: WorldFlagReference[] = [];
  mapWorldFlagReferences(gameProject, regions, (worldFlagId, site) => {
    if (worldFlagId) {
      references.push({ worldFlagId, where: site.where, target: site.target });
    }
    return worldFlagId;
  });
  return references;
}
