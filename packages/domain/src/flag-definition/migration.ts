import type { DialogueDefinition, DialogueCondition } from "../dialogue-definition";
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
import { createFlagDefinition, type FlagDefinition } from "./index";

/**
 * Turns flag references written before the registry existed into real ones.
 *
 * Content authored before epic 206 names a flag by its key -- `"gate-open"` --
 * in the same field that now holds a reference. This walks every one of those
 * fields; anything that is not already a registry id becomes an entry named
 * after the string it found, and the field is rewritten to that entry's id.
 *
 * Runs over the project AND its regions together, because a flag written by a
 * quest action can be read by a region condition, and the two live in
 * different files. Splitting the pass would give one flag two entries.
 *
 * Idempotent: a second run finds every reference already resolves and changes
 * nothing.
 */
export function migrateFlagReferences(
  gameProject: GameProject,
  regions: readonly RegionDocument[]
): { gameProject: GameProject; regions: RegionDocument[]; changed: boolean } {
  const definitions = [...gameProject.flagDefinitions];
  const idsInRegistry = new Set(
    definitions.map((definition) => definition.definitionId)
  );
  const idsByName = new Map(
    definitions.map((definition) => [definition.name, definition.definitionId])
  );
  let changed = false;

  /**
   * The id a legacy reference should point at, creating the entry the first
   * time that name is seen. Returns the input untouched when it already names
   * an entry -- that is what makes a second run a no-op.
   */
  function resolve(reference: string, valueType?: FlagDefinition["valueType"]) {
    if (!reference || idsInRegistry.has(reference)) {
      return reference;
    }
    const existing = idsByName.get(reference);
    if (existing) {
      changed = true;
      return existing;
    }
    const definition = createFlagDefinition({
      name: reference,
      displayName: reference,
      valueType: valueType ?? "boolean"
    });
    definitions.push(definition);
    idsInRegistry.add(definition.definitionId);
    idsByName.set(definition.name, definition.definitionId);
    changed = true;
    return definition.definitionId;
  }

  function migrateQuestCondition(
    condition: QuestConditionDefinition | undefined
  ): QuestConditionDefinition | undefined {
    if (!condition) return condition;
    if (condition.type === "hasFlag") {
      return { ...condition, flagId: resolve(condition.flagId) };
    }
    if (condition.type === "not") {
      const inner = migrateQuestCondition(condition.condition);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function migrateQuestAction(
    action: QuestActionDefinition
  ): QuestActionDefinition {
    return action.type === "setFlag"
      ? { ...action, flagId: resolve(action.flagId) }
      : action;
  }

  function migrateDialogueCondition(
    condition: DialogueCondition | undefined
  ): DialogueCondition | undefined {
    if (!condition) return condition;
    if (condition.type === "flag") {
      return { ...condition, flagId: resolve(condition.flagId) };
    }
    if (condition.type === "not") {
      const inner = migrateDialogueCondition(condition.condition);
      return inner ? { type: "not", condition: inner } : condition;
    }
    return condition;
  }

  function migrateBinding(
    binding: RegionBehaviorQuestBinding
  ): RegionBehaviorQuestBinding {
    if (!binding.worldFlagEquals?.flagId) return binding;
    return {
      ...binding,
      worldFlagEquals: {
        ...binding.worldFlagEquals,
        flagId: resolve(
          binding.worldFlagEquals.flagId,
          binding.worldFlagEquals.valueType
        )
      }
    };
  }

  const questDefinitions: QuestDefinition[] = gameProject.questDefinitions.map(
    (quest) => ({
      ...quest,
      stageDefinitions: quest.stageDefinitions.map((stage) => ({
        ...stage,
        nodeDefinitions: stage.nodeDefinitions.map((node) => ({
          ...node,
          condition: migrateQuestCondition(node.condition),
          onEnterActions: node.onEnterActions.map(migrateQuestAction),
          onCompleteActions: node.onCompleteActions.map(migrateQuestAction)
        }))
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
          condition: migrateDialogueCondition(edge.condition)
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
          ? { ...effect, targetId: resolve(effect.targetId) }
          : effect
      )
    })
  );

  // Behavior task activations and containment-volume gates live in the region
  // file. `volumes` is absent in pre-069.4 files.
  const migratedRegions: RegionDocument[] = regions.map((region) => ({
    ...region,
    behaviors: region.behaviors.map((behavior) => ({
      ...behavior,
      tasks: behavior.tasks.map((task) => ({
        ...task,
        activation: migrateBinding(task.activation)
      }))
    })),
    volumes: region.volumes?.map((volume) =>
      volume.condition
        ? { ...volume, condition: migrateBinding(volume.condition) }
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
              ? { ...presence, condition: migrateBinding(presence.condition) }
              : presence
          )
        }
      ])
    )
  }));

  return {
    gameProject: {
      ...gameProject,
      flagDefinitions: definitions,
      questDefinitions,
      dialogueDefinitions,
      spellDefinitions,
      scenes
    },
    regions: migratedRegions,
    changed
  };
}
