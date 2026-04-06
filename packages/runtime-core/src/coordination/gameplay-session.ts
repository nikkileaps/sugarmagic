import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  type DocumentDefinition,
  type DialogueDefinition,
  type ItemDefinition,
  type NPCDefinition,
  type PlayerDefinition,
  type QuestDefinition,
  type SpellDefinition,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  CasterManager,
  CasterSystem,
  createRuntimeSpellMenuUI
} from "../caster";
import { type World, Position } from "../ecs";
import {
  type ConversationActionProposal,
  type ConversationMiddleware,
  type ConversationProvider,
  type ConversationRuntimeContext,
  type ConversationSelectionContext,
  createRuntimeDialoguePanel,
  DialogueManager
} from "../dialogue";
import { createDocumentDefinitionFromItem, createRuntimeDocumentReaderUI } from "../document";
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
import type { RuntimePluginManager } from "../plugins";
import { RuntimePluginSystem } from "../plugins";
import {
  clearActiveQuestObjectives,
  clearActiveQuestStage,
  clearTrackedQuest,
  createRuntimeBlackboard,
  getActiveQuestObjectives,
  getEntityCurrentArea,
  getActiveQuestStage,
  getEntityLocation,
  getEntityPlayerSpatialRelation,
  getEntityPosition,
  getTrackedQuest as getTrackedQuestFact,
  setActiveQuestObjectives,
  setActiveQuestStage,
  setTrackedQuest,
  type RuntimeBlackboard
} from "../state";
import { PlayerControlled } from "../ecs";
import {
  buildLocationReference
} from "../spatial";
import { createRuntimeSpatialResolverSystem } from "../spatial/system";

export interface RuntimeSpellCastFeedback {
  spellDefinitionId: string;
  message: string;
}

export function formatRuntimeSpellCastFeedback(
  spell: SpellDefinition
): RuntimeSpellCastFeedback {
  return {
    spellDefinitionId: spell.definitionId,
    message: `${spell.displayName} Spell Cast`
  };
}

export interface RuntimeGameplaySessionControllerOptions {
  root: HTMLElement;
  world: World;
  inputManager: RuntimeInputManager;
  activeRegion: RegionDocument | null;
  playerDefinition: PlayerDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  pluginManager?: RuntimePluginManager | null;
  onItemPresenceCollected?: (presenceId: string) => void;
  onSpellCastSuccess?: (feedback: RuntimeSpellCastFeedback) => void;
}

export interface RuntimeGameplaySessionController {
  readonly dialogueManager: DialogueManager;
  readonly questManager: QuestManager;
  readonly interactionSystem: InteractionSystem;
  readonly questSystem: QuestSystem;
  readonly blackboard: RuntimeBlackboard;
  update: () => void;
  dispose: () => void;
}

export interface RuntimeGameplayAssemblyOptions
  extends RuntimeGameplaySessionControllerOptions {
  pluginManager?: RuntimePluginManager | null;
}

export interface RuntimeGameplayAssembly {
  readonly pluginManager: RuntimePluginManager | null;
  readonly gameplaySession: RuntimeGameplaySessionController;
  dispose: () => Promise<void>;
}

const DIALOGUE_LOCK_ID = "runtime-dialogue";
const JOURNAL_LOCK_ID = "runtime-quest-journal";
const INVENTORY_LOCK_ID = "runtime-inventory";
const ITEM_VIEW_LOCK_ID = "runtime-item-view";
const DOCUMENT_READER_LOCK_ID = "runtime-document-reader";
const SPELL_MENU_LOCK_ID = "runtime-spell-menu";
// Require a few consecutive frames before committing ambiguous area transitions.
// Three frames is enough to smooth threshold jitter in preview movement without
// making normal walking feel sticky when crossing authored boundaries.
const SPATIAL_AREA_CONFIRMATION_FRAMES = 3;

export function createRuntimeGameplaySessionController(
  options: RuntimeGameplaySessionControllerOptions
): RuntimeGameplaySessionController {
  const {
    root,
    world,
    inputManager,
    activeRegion,
    playerDefinition,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    dialogueDefinitions,
    questDefinitions,
    pluginManager,
    onItemPresenceCollected,
    onSpellCastSuccess
  } = options;

  const dialoguePanel = createRuntimeDialoguePanel(root);
  const questTracker = createRuntimeQuestTracker(root);
  const questJournal = createRuntimeQuestJournal(root);
  const questNotificationCenter = createRuntimeQuestNotificationCenter(root);
  const casterManager = new CasterManager();
  const casterSystem = new CasterSystem(casterManager);
  const spellMenuUi = createRuntimeSpellMenuUI(root, casterManager);
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
  const blackboard = createRuntimeBlackboard();
  const questDialogueCoordinator = createRuntimeQuestDialogueCoordinator();
  const conversationProviders: ConversationProvider[] =
    pluginManager?.getContributions("conversation.provider").map(
      (entry) => entry.payload.provider
    ) ?? [];
  const conversationMiddlewares: ConversationMiddleware[] =
    pluginManager?.getContributions("conversation.middleware").map(
      (entry) => entry.payload.middleware
    ) ?? [];
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
  let pendingScriptedFollowupDialogueId: string | null = null;
  let lastTrackedQuestDefinitionId: string | null = null;
  const spatialResolverSystem =
    activeRegion
      ? createRuntimeSpatialResolverSystem({
          blackboard,
          region: activeRegion,
          playerEntityId: playerDefinition.definitionId,
          confirmationFrames: SPATIAL_AREA_CONFIRMATION_FRAMES,
          logDebug(event, payload) {
            console.info(`[runtime-core] ${event}`, payload ?? {});
          }
        })
      : null;

  function logConversationDebug(
    event: string,
    payload?: Record<string, unknown>
  ) {
    console.info(`[runtime-core] ${event}`, payload ?? {});
  }

  function buildActiveRegionLocationReference() {
    if (!activeRegion) {
      return null;
    }
    return (
      spatialResolverSystem?.buildRegionLocationReference() ??
      buildLocationReference(activeRegion, null)
    );
  }

  function resolvePlayerPositionTuple(): [number, number, number] {
    const runtimePlayerEntity =
      world.query(PlayerControlled, Position)[0] ?? null;
    if (runtimePlayerEntity !== null) {
      const runtimePosition = world.getComponent(runtimePlayerEntity, Position);
      if (runtimePosition) {
        return [runtimePosition.x, runtimePosition.y, runtimePosition.z];
      }
    }

    return activeRegion?.scene.playerPresence?.transform.position ?? [0, 0, 0];
  }

  function syncBlackboardSpatialFacts() {
    const region = activeRegion;
    if (!region || !spatialResolverSystem) {
      return;
    }

    const [playerX, playerY, playerZ] = resolvePlayerPositionTuple();
    spatialResolverSystem.sync({
      playerPosition: { x: playerX, y: playerY, z: playerZ },
      npcPositions: region.scene.npcPresences.map((presence) => {
        const [x, y, z] = presence.transform.position;
        return {
          entityId: presence.npcDefinitionId,
          position: { x, y, z }
        };
      })
    });
  }

  function syncBlackboardQuestFacts() {
    const trackedQuest = questManager.getTrackedQuest();
    if (!trackedQuest) {
      if (lastTrackedQuestDefinitionId) {
        clearActiveQuestStage(blackboard, lastTrackedQuestDefinitionId);
        clearActiveQuestObjectives(blackboard, lastTrackedQuestDefinitionId);
      }
      clearTrackedQuest(blackboard);
      lastTrackedQuestDefinitionId = null;
      return;
    }

    if (
      lastTrackedQuestDefinitionId &&
      lastTrackedQuestDefinitionId !== trackedQuest.questDefinitionId
    ) {
      clearActiveQuestStage(blackboard, lastTrackedQuestDefinitionId);
      clearActiveQuestObjectives(blackboard, lastTrackedQuestDefinitionId);
    }

    setTrackedQuest(blackboard, {
      questId: trackedQuest.questDefinitionId,
      displayName: trackedQuest.displayName
    });
    setActiveQuestStage(blackboard, {
      questId: trackedQuest.questDefinitionId,
      stageId: trackedQuest.stageId,
      stageDisplayName: trackedQuest.stageDisplayName
    });
    setActiveQuestObjectives(blackboard, {
      questId: trackedQuest.questDefinitionId,
      displayName: trackedQuest.displayName,
      stageId: trackedQuest.stageId,
      stageDisplayName: trackedQuest.stageDisplayName,
      objectives: trackedQuest.objectives.map((objective) => ({
        nodeId: objective.nodeId,
        displayName: objective.displayName,
        description: objective.description
      }))
    });
    lastTrackedQuestDefinitionId = trackedQuest.questDefinitionId;
  }

  const runtimeBlackboardConversationMiddleware: ConversationMiddleware = {
    middlewareId: "runtime.blackboard-context",
    displayName: "Runtime Blackboard Context",
    priority: -100,
    stage: "context",
    prepare(context) {
      const trackedQuest = getTrackedQuestFact(blackboard);
      const activeQuestStage =
        trackedQuest ? getActiveQuestStage(blackboard, trackedQuest.questId) : null;
      const activeQuestObjectives =
        trackedQuest ? getActiveQuestObjectives(blackboard, trackedQuest.questId) : null;
      const playerLocation = getEntityLocation(blackboard, playerDefinition.definitionId);
      const playerPosition = getEntityPosition(blackboard, playerDefinition.definitionId);
      const playerArea = getEntityCurrentArea(blackboard, playerDefinition.definitionId);
      const npcLocation =
        context.selection.npcDefinitionId
          ? getEntityLocation(blackboard, context.selection.npcDefinitionId)
          : null;
      const npcPosition =
        context.selection.npcDefinitionId
          ? getEntityPosition(blackboard, context.selection.npcDefinitionId)
          : null;
      const npcArea =
        context.selection.npcDefinitionId
          ? getEntityCurrentArea(blackboard, context.selection.npcDefinitionId)
          : null;
      const npcPlayerRelation =
        context.selection.npcDefinitionId
          ? getEntityPlayerSpatialRelation(blackboard, context.selection.npcDefinitionId)
          : null;
      const runtimeContext: ConversationRuntimeContext = {
        here:
          playerLocation?.location ??
          npcLocation?.location ??
          buildActiveRegionLocationReference(),
        playerLocation,
        playerPosition,
        npcLocation,
        npcPosition,
        playerArea,
        npcArea,
        npcPlayerRelation,
        trackedQuest,
        activeQuestStage,
        activeQuestObjectives
      };

      return {
        ...context,
        runtimeContext
      };
    }
  };

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
      const npcDefinition = npcDefinitions.find(
        (candidate) => candidate.definitionId === npcDefinitionId
      );
      if (!npcDefinition || npcDefinition.interactionMode === "scripted") {
        interactable.available =
          questDialogueCoordinator.isNpcInteractableAvailable(npcDefinitionId);
        continue;
      }

      interactable.available = true;
    }
  }

  function resolveNpcConversationSelection(
    npcDefinitionId: string
  ): ConversationSelectionContext | null {
    const npcDefinition =
      npcDefinitions.find((candidate) => candidate.definitionId === npcDefinitionId) ??
      null;
    if (!npcDefinition) {
      logConversationDebug("conversation-selection-missing-npc", {
        npcDefinitionId
      });
      return null;
    }

    if (npcDefinition.interactionMode === "scripted") {
      const dialogueDefinitionId =
        questDialogueCoordinator.resolveNpcDialogueDefinitionId(npcDefinitionId);
      if (!dialogueDefinitionId) {
        logConversationDebug("conversation-selection-scripted-missing-dialogue", {
          npcDefinitionId,
          interactionMode: npcDefinition.interactionMode
        });
        return null;
      }
      const selection: ConversationSelectionContext = {
        conversationKind: "scripted-dialogue",
        dialogueDefinitionId,
        npcDefinitionId,
        npcDisplayName: npcDefinition.displayName,
        interactionMode: "scripted"
      };
      logConversationDebug("conversation-selection-resolved", {
        npcDefinitionId,
        npcDisplayName: npcDefinition.displayName,
        interactionMode: npcDefinition.interactionMode,
        conversationKind: selection.conversationKind,
        dialogueDefinitionId
      });
      return selection;
    }

    const trackedQuest = questManager.getTrackedQuest();
    const dialogueDefinitionId =
      questDialogueCoordinator.resolveNpcDialogueDefinitionId(npcDefinitionId);

    const selection: ConversationSelectionContext = {
      conversationKind:
        npcDefinition.interactionMode === "guided" ? "guided" : "free-form",
      dialogueDefinitionId:
        npcDefinition.interactionMode === "guided" ? dialogueDefinitionId ?? undefined : undefined,
      npcDefinitionId,
      npcDisplayName: npcDefinition.displayName,
      interactionMode: npcDefinition.interactionMode,
      lorePageId: npcDefinition.lorePageId,
      activeQuest: trackedQuest
        ? {
            questDefinitionId: trackedQuest.questDefinitionId,
            displayName: trackedQuest.displayName,
            stageDisplayName: trackedQuest.stageDisplayName,
            objectives: trackedQuest.objectives.map((objective) => ({
              nodeId: objective.nodeId,
              displayName: objective.displayName,
              description: objective.description
            }))
          }
        : null,
      scriptedFollowupDialogueDefinitionId: dialogueDefinitionId
    };
    logConversationDebug("conversation-selection-resolved", {
      npcDefinitionId,
      npcDisplayName: npcDefinition.displayName,
      interactionMode: npcDefinition.interactionMode,
      conversationKind: selection.conversationKind,
      dialogueDefinitionId: selection.dialogueDefinitionId ?? null,
      lorePageId: selection.lorePageId ?? null,
      hasActiveQuest: Boolean(selection.activeQuest?.displayName)
    });
    return selection;
  }

  function handleConversationActionProposal(
    proposal: ConversationActionProposal
  ): void {
    switch (proposal.kind) {
      case "set-conversation-flag":
        questManager.setFlag(proposal.key, proposal.value);
        return;
      case "surface-beat-evidence":
        console.debug("[runtime-core] conversation beat evidence", proposal);
        return;
      case "start-scripted-followup":
        pendingScriptedFollowupDialogueId = proposal.dialogueDefinitionId;
        return;
      case "request-close":
        return;
      case "propose-quest-hook":
        console.debug("[runtime-core] ignored quest hook proposal", proposal);
        return;
      default: {
        const exhaustive: never = proposal;
        console.debug("[runtime-core] unhandled conversation action proposal", exhaustive);
      }
    }
  }

  function syncInteractionPrompt() {
    if (
      dialogueManager.isDialogueActive() ||
      questJournal.isOpen() ||
      spellMenuUi.isOpen() ||
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
  dialogueManager.setConversationProviders(conversationProviders);
  dialogueManager.setConversationMiddlewares([
    runtimeBlackboardConversationMiddleware,
    ...conversationMiddlewares
  ]);
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
    const followupDialogueDefinitionId =
      reason === "completed" ? pendingScriptedFollowupDialogueId : null;
    pendingScriptedFollowupDialogueId = null;
    if (followupDialogueDefinitionId) {
      queueMicrotask(() => {
        void dialogueManager.start(followupDialogueDefinitionId);
      });
    }
  });
  dialogueManager.setOnTurn((_turn, proposedActions) => {
    for (const proposal of proposedActions) {
      handleConversationActionProposal(proposal);
    }
  });

  questDialogueCoordinator.loadDefinitions(dialogueDefinitions, questDefinitions);
  questDialogueCoordinator.attach(dialogueManager, questManager, {
    hasItem: (itemDefinitionId, count) =>
      inventoryManager.hasItem(itemDefinitionId, count),
    hasSpell: (spellDefinitionId) => casterManager.hasSpell(spellDefinitionId),
    canCastSpell: (spellDefinitionId) =>
      casterManager.canCastSpell(spellDefinitionId).canCast
  });

  questManager.registerDefinitions(questDefinitions);
  questManager.setInventoryCountProvider((itemDefinitionId) =>
    inventoryManager.getQuantity(itemDefinitionId)
  );
  questManager.setHasSpellProvider((spellDefinitionId) =>
    casterManager.hasSpell(spellDefinitionId)
  );
  questManager.setCanCastSpellProvider((spellDefinitionId) =>
    casterManager.canCastSpell(spellDefinitionId).canCast
  );
  questManager.setNarrativeHandler((node) => {
    if (node.narrativeSubtype === "dialogue" && node.dialogueDefinitionId) {
      void dialogueManager.start(node.dialogueDefinitionId);
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
    syncBlackboardQuestFacts();
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
  spellMenuUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addMovementLock(SPELL_MENU_LOCK_ID);
    } else {
      inputManager.removeMovementLock(SPELL_MENU_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  spellMenuUi.setCanOpenProvider(() => {
    return !(
      dialogueManager.isDialogueActive() ||
      questJournal.isOpen() ||
      inventoryUi.isOpen() ||
      itemViewUi.isOpen() ||
      documentReaderUi.isOpen()
    );
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
    const interactPressed = inputManager.isInteractPressed();
    if (!interactPressed) {
      return false;
    }

    if (
      dialogueManager.isDialogueActive() ||
      questJournal.isOpen() ||
      spellMenuUi.isOpen() ||
      inventoryUi.isOpen() ||
      itemViewUi.isOpen() ||
      documentReaderUi.isOpen()
    ) {
      logConversationDebug("interact-press-blocked", {
        dialogueActive: dialogueManager.isDialogueActive(),
        questJournalOpen: questJournal.isOpen(),
        spellMenuOpen: spellMenuUi.isOpen(),
        inventoryOpen: inventoryUi.isOpen(),
        itemViewOpen: itemViewUi.isOpen(),
        documentReaderOpen: documentReaderUi.isOpen()
      });
      return false;
    }

    logConversationDebug("interact-press-accepted", {
      nearestInteractable: interactionSystem.getNearestInteractable()
    });
    return true;
  });
  interactionSystem.setNearbyChangeHandler((nearby) => {
    logConversationDebug("nearby-interactable-changed", {
      nearby
    });
    syncInteractionPrompt();
  });
  interactionSystem.setInteractHandler((nearby) => {
    logConversationDebug("interact-handler-invoked", {
      nearby
    });
    if (nearby.type === "npc") {
      const selection = resolveNpcConversationSelection(nearby.targetId);
      if (!selection) {
        logConversationDebug("conversation-start-aborted-no-selection", {
          nearby
        });
        return;
      }
      logConversationDebug("conversation-start-requested", {
        npcDefinitionId: selection.npcDefinitionId ?? null,
        npcDisplayName: selection.npcDisplayName ?? null,
        conversationKind: selection.conversationKind,
        interactionMode: selection.interactionMode ?? null
      });
      void dialogueManager.startConversation(selection);
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
  world.addSystem(casterSystem);
  casterManager.setWorld(world);
  casterManager.registerDefinitions(spellDefinitions);
  casterManager.setSpellCastHandler((spell, result) => {
    questManager.notifySpellCast(spell.definitionId);
    onSpellCastSuccess?.(formatRuntimeSpellCastFeedback(spell));
    for (const effect of result.effects) {
      if (effect.type === "event" && effect.targetId) {
        questManager.notifyEvent(effect.targetId);
        continue;
      }

      if (effect.type === "dialogue" && effect.targetId) {
        void dialogueManager.start(effect.targetId);
        continue;
      }

      if (effect.type === "world-flag" && effect.targetId) {
        questManager.setFlag(effect.targetId, effect.value ?? true);
      }
    }
    spellMenuUi.update();
  });
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
  syncBlackboardSpatialFacts();
  syncBlackboardQuestFacts();
  syncInventoryUi();
  syncQuestUi();
  syncNpcInteractionAvailability();
  spellMenuUi.update();
  syncInteractionPrompt();

  return {
    dialogueManager,
    questManager,
    interactionSystem,
    questSystem,
    blackboard,
    update() {
      blackboard.advanceFrame();
      syncBlackboardSpatialFacts();
      spellMenuUi.update();
    },
    dispose() {
      spatialResolverSystem?.reset();
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
      spellMenuUi.dispose();
      questNotificationCenter.dispose();
      inventoryUi.dispose();
      itemViewUi.dispose();
      documentReaderUi.dispose();
      itemPickupNotifications.dispose();
      interactionPrompt.dispose();
    }
  };
}

export function createRuntimeGameplayAssembly(
  options: RuntimeGameplayAssemblyOptions
): RuntimeGameplayAssembly {
  const pluginManager = options.pluginManager ?? null;

  if (pluginManager) {
    void pluginManager.init();
    options.world.addSystem(new RuntimePluginSystem(pluginManager));
  }

  const gameplaySession = createRuntimeGameplaySessionController(options);

  return {
    pluginManager,
    gameplaySession,
    async dispose() {
      gameplaySession.dispose();
      await pluginManager?.dispose();
    }
  };
}
