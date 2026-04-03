import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  type DocumentDefinition,
  type DialogueDefinition,
  type ItemDefinition,
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
import {
  createDocumentDefinitionFromItem,
  createRuntimeDocumentReaderUI
} from "../document";
import { type RuntimeInputManager } from "../input";
import {
  createRuntimeInventoryUI,
  createRuntimeItemPickupNotificationCenter,
  createRuntimeItemViewUI,
  InventoryManager
} from "../inventory";
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
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  onItemPresenceCollected?: (presenceId: string) => void;
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
const INVENTORY_LOCK_ID = "runtime-inventory";
const ITEM_VIEW_LOCK_ID = "runtime-item-view";
const DOCUMENT_READER_LOCK_ID = "runtime-document-reader";

export function createRuntimeGameplaySessionController(
  options: RuntimeGameplaySessionControllerOptions
): RuntimeGameplaySessionController {
  const {
    root,
    world,
    inputManager,
    activeRegion,
    playerDefinition,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    onItemPresenceCollected
  } = options;

  const dialoguePanel = createRuntimeDialoguePanel(root);
  const questTracker = createRuntimeQuestTracker(root);
  const questJournal = createRuntimeQuestJournal(root);
  const questNotificationCenter = createRuntimeQuestNotificationCenter(root);
  const inventoryManager = new InventoryManager();
  const inventoryUi = createRuntimeInventoryUI(root);
  const itemViewUi = createRuntimeItemViewUI(root, documentDefinitions);
  const itemPickupNotifications = createRuntimeItemPickupNotificationCenter(root);
  const interactionPrompt = createRuntimeInteractionPrompt(root);
  const documentReaderUi = createRuntimeDocumentReaderUI(root);
  const dialogueManager = new DialogueManager(dialoguePanel);
  const questManager = new QuestManager();
  const interactionSystem = new InteractionSystem();
  const questSystem = new QuestSystem(questManager);
  const questDialogueCoordinator = createRuntimeQuestDialogueCoordinator();
  const npcInteractableEntities = new Map<
    string,
    { npcDefinitionId: string; entity: number }
  >();
  const itemInteractableEntities = new Map<
    string,
    { itemDefinitionId: string; quantity: number; entity: number }
  >();
  const inspectableInteractableEntities = new Map<
    string,
    { documentDefinitionId: string; promptText: string; entity: number }
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
    if (
      dialogueManager.isDialogueActive() ||
      questJournal.isOpen() ||
      inventoryUi.isOpen() ||
      itemViewUi.isOpen() ||
      documentReaderUi.isOpen()
    ) {
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

  function registerItemInteractables() {
    if (!activeRegion) return;

    for (const presence of activeRegion.scene.itemPresences) {
      const itemDefinition = itemDefinitions.find(
        (definition) => definition.definitionId === presence.itemDefinitionId
      );
      const interactableEntity = world.createEntity();
      world.addComponent(interactableEntity, new Position(...presence.transform.position));
      world.addComponent(
        interactableEntity,
        new Interactable(
          "item",
          presence.presenceId,
          presence.itemDefinitionId,
          `Pick up ${itemDefinition?.displayName ?? "Item"}`,
          1.6,
          true
        )
      );
      itemInteractableEntities.set(presence.presenceId, {
        itemDefinitionId: presence.itemDefinitionId,
        quantity: presence.quantity,
        entity: interactableEntity
      });
    }
  }

  function registerInspectableInteractables() {
    if (!activeRegion) return;

    for (const asset of activeRegion.scene.placedAssets) {
      if (!asset.inspectable) continue;

      const promptText = asset.inspectable.promptText?.trim() || "Inspect";
      const interactableEntity = world.createEntity();
      world.addComponent(
        interactableEntity,
        new Position(...asset.transform.position)
      );
      world.addComponent(
        interactableEntity,
        new Interactable(
          "inspectable",
          asset.instanceId,
          asset.inspectable.documentDefinitionId,
          promptText,
          2.0,
          true
        )
      );
      inspectableInteractableEntities.set(asset.instanceId, {
        documentDefinitionId: asset.inspectable.documentDefinitionId,
        promptText,
        entity: interactableEntity
      });
    }
  }

  function syncInventoryUi() {
    inventoryUi.update(inventoryManager.getEntries());
  }

  function collectItemPresence(presenceId: string) {
    const itemPresence = itemInteractableEntities.get(presenceId);
    if (!itemPresence) return;

    const itemDefinition = itemDefinitions.find(
      (definition) => definition.definitionId === itemPresence.itemDefinitionId
    );
    if (!itemDefinition) return;

    if (!inventoryManager.addItem(itemDefinition.definitionId, itemPresence.quantity)) {
      return;
    }

    const interactable = world.getComponent(itemPresence.entity, Interactable);
    if (interactable) {
      interactable.available = false;
    }
    world.destroyEntity(itemPresence.entity);
    itemInteractableEntities.delete(presenceId);
    itemPickupNotifications.push(itemDefinition.displayName, itemPresence.quantity);
    onItemPresenceCollected?.(presenceId);
    syncInteractionPrompt();
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
  questDialogueCoordinator.attach(dialogueManager, questManager, {
    hasItem: (itemDefinitionId, count) =>
      inventoryManager.hasItem(itemDefinitionId, count)
  });

  questManager.registerDefinitions(questDefinitions);
  questManager.setInventoryCountProvider((itemDefinitionId) =>
    inventoryManager.getQuantity(itemDefinitionId)
  );
  questManager.setNarrativeHandler((node) => {
    if (node.narrativeSubtype === "dialogue" && node.dialogueDefinitionId) {
      dialogueManager.start(node.dialogueDefinitionId);
      return;
    }
    if (node.eventName) {
      questManager.notifyEvent(node.eventName);
    }
  });
  questManager.setActionHandler((action) => {
    const numericValue =
      typeof action.value === "number"
        ? action.value
        : typeof action.value === "string" && action.value.trim().length > 0
          ? Number(action.value)
          : NaN;
    const count =
      Number.isFinite(numericValue) ? Math.max(1, Math.floor(numericValue)) : 1;

    if (action.type === "giveItem" && action.targetId) {
      inventoryManager.addItem(action.targetId, count);
      return;
    }

    if (action.type === "removeItem" && action.targetId) {
      inventoryManager.removeItem(action.targetId, count);
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
  inventoryUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addMovementLock(INVENTORY_LOCK_ID);
    } else {
      inputManager.removeMovementLock(INVENTORY_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  inventoryUi.setOnInspectItem((itemDefinitionId) => {
    const definition = inventoryManager.getDefinition(itemDefinitionId);
    if (!definition) return;

    if (definition.interactionView.kind === "readable") {
      const documentDefinition = createDocumentDefinitionFromItem(
        definition,
        documentDefinitions
      );
      if (!documentDefinition) {
        return;
      }
      documentReaderUi.show(documentDefinition, { kicker: "Inventory document" });
      return;
    }

    itemViewUi.show(definition, inventoryManager.getQuantity(itemDefinitionId));
  });
  itemViewUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addMovementLock(ITEM_VIEW_LOCK_ID);
    } else {
      inputManager.removeMovementLock(ITEM_VIEW_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  documentReaderUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addMovementLock(DOCUMENT_READER_LOCK_ID);
    } else {
      inputManager.removeMovementLock(DOCUMENT_READER_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  itemViewUi.setOnConsume((itemDefinitionId) => {
    if (!inventoryManager.removeItem(itemDefinitionId, 1)) return;
    const definition = inventoryManager.getDefinition(itemDefinitionId);
    if (!definition) return;

    const remaining = inventoryManager.getQuantity(itemDefinitionId);
    if (remaining > 0) {
      itemViewUi.show(definition, remaining);
    } else {
      itemViewUi.hide();
    }
  });

  interactionSystem.setInteractPressedProvider(() => {
    if (
      dialogueManager.isDialogueActive() ||
      questJournal.isOpen() ||
      inventoryUi.isOpen() ||
      itemViewUi.isOpen() ||
      documentReaderUi.isOpen()
    ) {
      return false;
    }
    return inputManager.isInteractPressed();
  });
  interactionSystem.setNearbyChangeHandler(() => {
    syncInteractionPrompt();
  });
  interactionSystem.setInteractHandler((nearby) => {
    if (nearby.type === "npc") {
      const dialogueDefinitionId = questDialogueCoordinator.resolveNpcDialogueDefinitionId(
        nearby.targetId
      );
      if (!dialogueDefinitionId) return;
      dialogueManager.start(dialogueDefinitionId);
      return;
    }

    if (nearby.type === "item") {
      collectItemPresence(nearby.instanceId);
      return;
    }

    if (nearby.type === "inspectable") {
      const inspectable = inspectableInteractableEntities.get(nearby.instanceId);
      if (!inspectable) return;

      const documentDefinition = documentDefinitions.find(
        (definition) => definition.definitionId === inspectable.documentDefinitionId
      );
      if (!documentDefinition) return;

      documentReaderUi.show(documentDefinition, {
        kicker: inspectable.promptText
      });
    }
  });

  world.addSystem(interactionSystem);
  world.addSystem(questSystem);
  inventoryManager.registerDefinitions(itemDefinitions);
  inventoryManager.registerDocumentDefinitions(documentDefinitions);
  inventoryManager.setOnChange(() => {
    syncInventoryUi();
    questManager.update();
    syncInteractionPrompt();
  });
  registerNpcInteractables();
  registerItemInteractables();
  registerInspectableInteractables();
  questDialogueCoordinator.startInitialQuests();
  syncInventoryUi();
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
      for (const { entity } of itemInteractableEntities.values()) {
        world.destroyEntity(entity);
      }
      itemInteractableEntities.clear();
      for (const { entity } of inspectableInteractableEntities.values()) {
        world.destroyEntity(entity);
      }
      inspectableInteractableEntities.clear();
      questDialogueCoordinator.reset();
      dialogueManager.dispose();
      questTracker.dispose();
      questJournal.dispose();
      questNotificationCenter.dispose();
      inventoryUi.dispose();
      itemViewUi.dispose();
      documentReaderUi.dispose();
      itemPickupNotifications.dispose();
      interactionPrompt.dispose();
    }
  };
}
