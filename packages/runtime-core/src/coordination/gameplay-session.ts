import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  type DialogueDefinition,
  type NPCDefinition,
  type PlayerDefinition,
  type QuestDefinition,
  type RegionDocument
} from "@sugarmagic/domain";
import { type World, Position } from "../ecs";
import {
  createRuntimeDialoguePanel,
  DialogueManager
} from "../dialogue";
import { type RuntimeInputManager } from "../input";
import {
  createRuntimeInteractionPrompt,
  Interactable,
  InteractionSystem
} from "../interaction";
import {
  createRuntimeQuestJournal,
  createRuntimeQuestNotificationCenter,
  createRuntimeQuestTracker,
  QuestManager,
  QuestSystem
} from "../quest";
import { createRuntimeQuestDialogueCoordinator } from "./quest-dialogue";

export interface RuntimeGameplaySessionControllerOptions {
  root: HTMLElement;
  world: World;
  inputManager: RuntimeInputManager;
  activeRegion: RegionDocument | null;
  playerDefinition: PlayerDefinition;
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
}

export interface RuntimeGameplaySessionController {
  readonly dialogueManager: DialogueManager;
  readonly questManager: QuestManager;
  readonly interactionSystem: InteractionSystem;
  readonly questSystem: QuestSystem;
  dispose: () => void;
}

const DIALOGUE_LOCK_ID = "runtime-dialogue";
const JOURNAL_LOCK_ID = "runtime-quest-journal";

export function createRuntimeGameplaySessionController(
  options: RuntimeGameplaySessionControllerOptions
): RuntimeGameplaySessionController {
  const {
    root,
    world,
    inputManager,
    activeRegion,
    playerDefinition,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions
  } = options;

  const dialoguePanel = createRuntimeDialoguePanel(root);
  const questTracker = createRuntimeQuestTracker(root);
  const questJournal = createRuntimeQuestJournal(root);
  const questNotificationCenter = createRuntimeQuestNotificationCenter(root);
  const interactionPrompt = createRuntimeInteractionPrompt(root);
  const dialogueManager = new DialogueManager(dialoguePanel);
  const questManager = new QuestManager();
  const interactionSystem = new InteractionSystem();
  const questSystem = new QuestSystem(questManager);
  const questDialogueCoordinator = createRuntimeQuestDialogueCoordinator();
  const npcInteractableEntities = new Map<
    string,
    { npcDefinitionId: string; entity: number }
  >();

  function resolveSpeakerName(speakerId: string): string | undefined {
    if (speakerId === playerDefinition.definitionId) {
      return playerDefinition.displayName;
    }

    const builtInSpeaker = BUILT_IN_DIALOGUE_SPEAKERS.find(
      (speaker) => speaker.speakerId === speakerId
    );
    if (builtInSpeaker) {
      if (builtInSpeaker.kind === "player" || builtInSpeaker.kind === "player-vo") {
        return playerDefinition.displayName;
      }
      return builtInSpeaker.displayName;
    }

    return npcDefinitions.find((npc) => npc.definitionId === speakerId)?.displayName;
  }

  function syncQuestUi() {
    questTracker.update(questManager.getTrackedQuest());
    questJournal.update(questManager.getJournalData());
  }

  function syncNpcInteractionAvailability() {
    for (const { npcDefinitionId, entity } of npcInteractableEntities.values()) {
      const interactable = world.getComponent(entity, Interactable);
      if (!interactable) continue;
      interactable.available =
        questDialogueCoordinator.isNpcInteractableAvailable(npcDefinitionId);
    }
  }

  function syncInteractionPrompt() {
    if (dialogueManager.isDialogueActive() || questJournal.isOpen()) {
      interactionPrompt.hide();
      return;
    }

    const nearby = interactionSystem.getNearestInteractable();
    if (nearby?.available) {
      interactionPrompt.show(nearby.promptText);
      return;
    }

    interactionPrompt.hide();
  }

  function registerNpcInteractables() {
    if (!activeRegion) return;

    for (const presence of activeRegion.scene.npcPresences) {
      const npcDefinition = npcDefinitions.find(
        (definition) => definition.definitionId === presence.npcDefinitionId
      );
      const interactableEntity = world.createEntity();
      world.addComponent(interactableEntity, new Position(...presence.transform.position));
      world.addComponent(
        interactableEntity,
        new Interactable(
          "npc",
          presence.presenceId,
          presence.npcDefinitionId,
          `Talk to ${npcDefinition?.displayName ?? "NPC"}`,
          2.0,
          questDialogueCoordinator.isNpcInteractableAvailable(presence.npcDefinitionId)
        )
      );
      npcInteractableEntities.set(presence.presenceId, {
        npcDefinitionId: presence.npcDefinitionId,
        entity: interactableEntity
      });
    }
  }

  dialogueManager.registerDefinitions(dialogueDefinitions);
  dialogueManager.setSpeakerNameResolver(resolveSpeakerName);
  dialogueManager.setOnStart(() => {
    inputManager.addMovementLock(DIALOGUE_LOCK_ID);
    inputManager.consumeInteract();
    syncInteractionPrompt();
  });
  dialogueManager.setOnNodeEnter((nodeId) => {
    questDialogueCoordinator.handleDialogueNodeEnter(nodeId);
  });
  dialogueManager.setOnEnd((dialogueDefinitionId, reason) => {
    inputManager.removeMovementLock(DIALOGUE_LOCK_ID);
    inputManager.consumeInteract();
    questDialogueCoordinator.handleDialogueEnd(dialogueDefinitionId, reason);
    syncInteractionPrompt();
  });

  questDialogueCoordinator.loadDefinitions(dialogueDefinitions, questDefinitions);
  questDialogueCoordinator.attach(dialogueManager, questManager);

  questManager.registerDefinitions(questDefinitions);
  questManager.setNarrativeHandler((node) => {
    if (node.narrativeSubtype === "dialogue" && node.dialogueDefinitionId) {
      dialogueManager.start(node.dialogueDefinitionId);
      return;
    }
    if (node.eventName) {
      questManager.notifyEvent(node.eventName);
    }
  });
  questManager.setStateChangeHandler(() => {
    syncQuestUi();
    syncNpcInteractionAvailability();
    syncInteractionPrompt();
  });
  questManager.setEventHandler((event) => {
    questNotificationCenter.push(event);
  });

  questJournal.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addMovementLock(JOURNAL_LOCK_ID);
    } else {
      inputManager.removeMovementLock(JOURNAL_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  questJournal.setOnTrackedQuestChange((questDefinitionId) => {
    questManager.setTrackedQuest(questDefinitionId);
  });

  interactionSystem.setInteractPressedProvider(() => {
    if (dialogueManager.isDialogueActive() || questJournal.isOpen()) {
      return false;
    }
    return inputManager.isInteractPressed();
  });
  interactionSystem.setNearbyChangeHandler(() => {
    syncInteractionPrompt();
  });
  interactionSystem.setInteractHandler((nearby) => {
    if (nearby.type !== "npc") return;
    const dialogueDefinitionId = questDialogueCoordinator.resolveNpcDialogueDefinitionId(
      nearby.targetId
    );
    if (!dialogueDefinitionId) return;
    dialogueManager.start(dialogueDefinitionId);
  });

  world.addSystem(interactionSystem);
  world.addSystem(questSystem);
  registerNpcInteractables();
  questDialogueCoordinator.startInitialQuests();
  syncQuestUi();
  syncNpcInteractionAvailability();
  syncInteractionPrompt();

  return {
    dialogueManager,
    questManager,
    interactionSystem,
    questSystem,
    dispose() {
      for (const { entity } of npcInteractableEntities.values()) {
        world.destroyEntity(entity);
      }
      npcInteractableEntities.clear();
      questDialogueCoordinator.reset();
      dialogueManager.dispose();
      questTracker.dispose();
      questJournal.dispose();
      questNotificationCenter.dispose();
      interactionPrompt.dispose();
    }
  };
}
