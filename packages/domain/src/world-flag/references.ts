import type {
  DialogueCondition,
  DialogueDefinition
} from "../dialogue-definition";
import type { GameProject } from "../game-project";
import type {
  QuestActionDefinition,
  QuestConditionDefinition,
  QuestDefinition
} from "../quest-definition";
import type {
  RegionBehaviorQuestBinding,
  RegionDocument
} from "../region-authoring";
import type { SpellDefinition } from "../spell-definition";
import type { WorldFlagValueType } from "./index";

/**
 * Where a world flag reference was found. `where` is written for an author to
 * read in a validation message, not parsed by anything.
 */
export interface WorldFlagReferenceSite {
  where: string;
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
    where: string
  ): QuestConditionDefinition | undefined {
    if (!condition) return condition;
    if (condition.type === "hasFlag") {
      return {
        ...condition,
        worldFlagId: visit(condition.worldFlagId, { where })
      };
    }
    if (condition.type === "not") {
      const inner = questCondition(condition.condition, where);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function questAction(
    action: QuestActionDefinition,
    where: string
  ): QuestActionDefinition {
    return action.type === "setFlag"
      ? { ...action, worldFlagId: visit(action.worldFlagId, { where }) }
      : action;
  }

  function dialogueCondition(
    condition: DialogueCondition | undefined,
    where: string
  ): DialogueCondition | undefined {
    if (!condition) return condition;
    if (condition.type === "flag") {
      return {
        ...condition,
        worldFlagId: visit(condition.worldFlagId, { where })
      };
    }
    if (condition.type === "not") {
      const inner = dialogueCondition(condition.condition, where);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function binding(
    value: RegionBehaviorQuestBinding,
    where: string
  ): RegionBehaviorQuestBinding {
    if (!value.worldFlagEquals?.worldFlagId) return value;
    return {
      ...value,
      worldFlagEquals: {
        ...value.worldFlagEquals,
        worldFlagId: visit(value.worldFlagEquals.worldFlagId, {
          where,
          valueType: value.worldFlagEquals.valueType
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
          return {
            ...node,
            condition: questCondition(node.condition, `${where} condition`),
            onEnterActions: node.onEnterActions.map((action) =>
              questAction(action, `${where} on-enter action`)
            ),
            onCompleteActions: node.onCompleteActions.map((action) =>
              questAction(action, `${where} on-complete action`)
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
          condition: dialogueCondition(
            edge.condition,
            `dialogue "${dialogue.displayName}" node "${node.displayName ?? node.nodeId}"`
          )
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
                where: `spell "${spell.displayName}" world-flag effect`
              })
            }
          : effect
      )
    })
  );

  // Behavior task activations and containment-volume gates live in the region
  // file. `volumes` is absent in pre-069.4 files.
  const mappedRegions: RegionDocument[] = regions.map((region) => ({
    ...region,
    behaviors: region.behaviors.map((behavior) => ({
      ...behavior,
      tasks: behavior.tasks.map((task) => ({
        ...task,
        activation: binding(
          task.activation,
          `region "${region.displayName}" behavior "${behavior.displayName}" task activation`
        )
      }))
    })),
    volumes: region.volumes?.map((volume) =>
      volume.condition
        ? {
            ...volume,
            condition: binding(
              volume.condition,
              `region "${region.displayName}" volume "${volume.volumeId}" gate`
            )
          }
        : volume
    )
  }));

  // NPC presence conditions are Scene-scoped, not region-scoped: they live on
  // Scene.regionOverlays in the GameProject (Plan 058).
  const scenes = gameProject.scenes.map((scene) => ({
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
                  condition: binding(
                    presence.condition,
                    `scene "${scene.displayName}" NPC placement in region "${regionId}"`
                  )
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
      scenes
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
 * orphan, once there is a surface that deletes a flag -- `DeleteWorldFlag-
 * Definition` has no caller today.
 */
export function collectWorldFlagReferences(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): WorldFlagReference[] {
  const references: WorldFlagReference[] = [];
  mapWorldFlagReferences(gameProject, regions, (worldFlagId, site) => {
    if (worldFlagId) {
      references.push({ worldFlagId, where: site.where });
    }
    return worldFlagId;
  });
  return references;
}
