import type { DialogueDefinition, QuestDefinition } from "@sugarmagic/domain";
import type { DialogueManager } from "../dialogue";
import type { QuestManager } from "../quest";

export interface RuntimeQuestDialogueCoordinator {
  loadDefinitions: (dialogueDefinitions: DialogueDefinition[], questDefinitions: QuestDefinition[]) => void;
  attach: (
    dialogueManager: DialogueManager,
    questManager: QuestManager,
    options?: {
      hasItem?: (itemDefinitionId: string, count?: number) => boolean;
    }
  ) => void;
  resolveNpcDialogueDefinitionId: (npcDefinitionId: string) => string | null;
  isNpcInteractableAvailable: (npcDefinitionId: string) => boolean;
  handleDialogueNodeEnter: (nodeId: string) => void;
  handleDialogueEnd: (
    dialogueDefinitionId: string | null,
    reason: "completed" | "cancelled"
  ) => void;
  startInitialQuests: () => void;
  reset: () => void;
}

export function createRuntimeQuestDialogueCoordinator(): RuntimeQuestDialogueCoordinator {
  const npcDialogueBindings = new Map<string, string>();
  const questScopedNpcDefinitionIds = new Set<string>();
  let currentDialogueNodeId: string | null = null;
  let loadedQuestDefinitions: QuestDefinition[] = [];
  let dialogueManager: DialogueManager | null = null;
  let questManager: QuestManager | null = null;
  let hasItem: ((itemDefinitionId: string, count?: number) => boolean) | null = null;

  function syncDialogueConditions() {
    if (!dialogueManager || !questManager) return;

        dialogueManager.setConditionContext({
          hasFlag: (key, value) => questManager?.hasFlag(key, value) ?? false,
          hasItem: (itemDefinitionId, count) => hasItem?.(itemDefinitionId, count) ?? false,
          isQuestActive: (questId) => questManager?.isQuestActive(questId) ?? false,
          isQuestCompleted: (questId) => questManager?.isQuestCompleted(questId) ?? false,
          getQuestStageState: (questId, stageId) =>
            questManager?.getQuestStageState(questId, stageId) ?? null
        });
  }

  return {
    loadDefinitions(dialogueDefinitions, questDefinitions) {
      npcDialogueBindings.clear();
      questScopedNpcDefinitionIds.clear();
      loadedQuestDefinitions = questDefinitions;

      for (const definition of dialogueDefinitions) {
        const npcDefinitionId = definition.interactionBinding.npcDefinitionId;
        if (npcDefinitionId && !npcDialogueBindings.has(npcDefinitionId)) {
          npcDialogueBindings.set(npcDefinitionId, definition.definitionId);
        }
      }

      for (const questDefinition of questDefinitions) {
        for (const stage of questDefinition.stageDefinitions) {
          for (const node of stage.nodeDefinitions) {
            if (
              node.nodeBehavior === "objective" &&
              node.objectiveSubtype === "talk" &&
              node.targetId
            ) {
              questScopedNpcDefinitionIds.add(node.targetId);
            }
          }
        }
      }
    },

    attach(nextDialogueManager, nextQuestManager, options) {
      dialogueManager = nextDialogueManager;
      questManager = nextQuestManager;
      hasItem = options?.hasItem ?? null;
      syncDialogueConditions();
    },

    resolveNpcDialogueDefinitionId(npcDefinitionId) {
      const questDialogueDefinitionId =
        questManager?.getDialogueOverrideForNpc(npcDefinitionId) ?? null;
      if (questDialogueDefinitionId) {
        return questDialogueDefinitionId;
      }

      if (questScopedNpcDefinitionIds.has(npcDefinitionId)) {
        return null;
      }

      return npcDialogueBindings.get(npcDefinitionId) ?? null;
    },

    isNpcInteractableAvailable(npcDefinitionId) {
      return Boolean(this.resolveNpcDialogueDefinitionId(npcDefinitionId));
    },

    handleDialogueNodeEnter(nodeId) {
      currentDialogueNodeId = nodeId;
    },

    handleDialogueEnd(dialogueDefinitionId, reason) {
      if (dialogueDefinitionId && reason === "completed") {
        questManager?.notifyDialogueFinished(dialogueDefinitionId, currentDialogueNodeId);
      }
      currentDialogueNodeId = null;
    },

    startInitialQuests() {
      if (!questManager) return;
      for (const questDefinition of loadedQuestDefinitions) {
        questManager.startQuest(questDefinition.definitionId);
      }
    },

    reset() {
      npcDialogueBindings.clear();
      questScopedNpcDefinitionIds.clear();
      loadedQuestDefinitions = [];
      currentDialogueNodeId = null;
      dialogueManager = null;
      questManager = null;
      hasItem = null;
    }
  };
}
