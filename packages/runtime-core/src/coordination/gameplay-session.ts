/**
 * packages/runtime-core/src/coordination/gameplay-session.ts
 *
 * Purpose: Assembles the runtime gameplay session and bridges authored content into runtime systems.
 *
 * Exports:
 *   - createRuntimeGameplaySessionController
 *   - createRuntimeGameplayAssembly
 *   - createConversationSelectionFromNpc
 *
 * Relationships:
 *   - Depends on domain-authored definitions as the single source of truth.
 *   - Bridges NPC metadata into conversation selection so middlewares can read authored tags.
 *
 * Implements: Epic 2 runtime-core prerequisite for NPC metadata propagation
 *
 * Status: active
 */

import {
  BUILT_IN_DIALOGUE_SPEAKERS,
  composeRegionContents,
  type CastableInvocation,
  createDefaultAudioMixerSettings,
  createEmptyContentLibrarySnapshot,
  type DocumentDefinition,
  type DialogueDefinition,
  type AudioMixerSettings,
  type ContentLibrarySnapshot,
  type ItemDefinition,
  type MechanicsDefinition,
  type NPCDefinition,
  type PlayerDefinition,
  type QuestDefinition,
  type RegionItemPresence,
  type Scene,
  type SpellDefinition,
  type RegionDocument,
  type RegionVolumeDefinition,
  type SoundEventBindingMap
} from "@sugarmagic/domain";
import {
  CasterManager,
  CasterSystem,
  createRuntimeSpellMenuUI
} from "../caster";
import {
  createRuntimeAudioController,
  type RuntimeAudioController,
  type RuntimeSoundCommand
} from "../audio";
import {
  assertValidMechanicsDefinition,
  collectMechanicsConsumerInvocations,
  createCastableExecutor,
  type CastableExecutionResult,
  type StatCarrier
} from "../mechanics";
import { type World, type Entity, Caster, Position } from "../ecs";
import {
  BillboardComponent,
  BillboardSystem,
  type BillboardComponentOptions,
  type BillboardDescriptor,
  type CameraSnapshot
} from "../billboard";
import {
  type ConversationActionProposal,
  type ConversationMiddleware,
  type ConversationProvider,
  type ConversationRuntimeContext,
  type ConversationSelectionContext,
  createRuntimeDialoguePanel,
  DialogueManager
} from "../dialogue";
import {
  createDocumentDefinitionFromItem,
  createRuntimeDocumentReaderUI
} from "../document";
import { type RuntimeInputManager } from "../input";
import { executeTriggerCastableItemInteraction } from "../item";
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
  iterateActiveItemPresences,
  computePlayerAgentDimensions,
  computeNpcAgentDimensions
} from "../scene";
import {
  applyVolumeColliderGates,
  createEmptyCollisionWorld,
  type CircleObstacle,
  type CollisionWorld
} from "../collision";
import type { NavMeshPathfinder } from "../navmesh";
import { resolveWorldFlagWriteValue } from "../region-conditions";
import {
  createRuntimeQuestJournal,
  createRuntimeQuestNotificationCenter,
  createRuntimeQuestTracker,
  type QuestTrackerView,
  QuestManager,
  QuestSystem
} from "../quest";
import { createRuntimeQuestDialogueCoordinator } from "./quest-dialogue";
import type {
  DebugEntityBillboardKind,
  DebugHudCardContribution,
  DebugHudGameplaySessionSnapshot,
  EntityBillboardContext,
  MechanicsEmitDispatch,
  RuntimePluginManager
} from "../plugins";
import { RuntimePluginSystem } from "../plugins";
import {
  createRuntimeNpcBehaviorSystem,
  type RuntimeNpcBehaviorSystem,
  type NpcCollisionAgent
} from "../behavior";
import {
  bumpGoalSurfacedCount,
  getGoalSurfacedCount,
  clearActiveQuestObjectives,
  clearActiveQuestStage,
  clearTrackedQuest,
  setWorldTimeOfDay,
  setWorldDay,
  getTimeOfDayBand,
  getPlayerKnownFacts,
  setPlayerKnownFacts,
  createRuntimeBlackboard,
  getActiveQuestObjectives,
  getEntityCurrentActivity,
  getEntityCurrentArea,
  getEntityCurrentGoal,
  getActiveQuestStage,
  getEntityLocation,
  getEntityMovement,
  getEntityPlayerSpatialRelation,
  getEntityPosition,
  getTrackedQuest as getTrackedQuestFact,
  RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
  setActiveQuestObjectives,
  setActiveQuestStage,
  setTrackedQuest,
  type RuntimeBlackboard
} from "../state";
import { PlayerControlled } from "../ecs";
import { buildLocationReference } from "../spatial";
import { createRuntimeSpatialResolverSystem } from "../spatial/system";
import {
  createWorldTimeStore,
  createPlayerKnownFactsStore,
  createRecentEventCollector,
  type TimeOfDayBand,
  type WorldTimeStore,
  type PlayerKnownFactsStore,
  type RecentEventCollector
} from "../world";

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
  /**
   * Plan 058 §058.1 — the active narrative Scene whose overlay
   * composes onto the region base. The assembly reads presences
   * and inspectable assets from the COMPOSED view (Pattern 1),
   * never from the region directly. Null composes base-only.
   */
  activeScene?: Scene | null;
  /**
   * Plan 058 §058.5 — quest Scene-progression actions
   * (unlockScene / advanceToNextScene) forward here; the host
   * owns campaign.progression and the world reload that a Scene
   * change implies.
   */
  onSceneAction?: (action: {
    type: "unlockScene" | "advanceToNextScene";
    sceneId: string | null;
  }) => void;
  /**
   * Plan 059 §059.1 — the background-music sound cue to start at
   * assembly boot, already resolved by the host (Scene
   * `audioOverride.backgroundMusicId` ?? project
   * `musicBindings.defaultBackgroundMusicId`). Null = silence.
   */
  backgroundMusicCueId?: string | null;
  playerDefinition: PlayerDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  mechanics: MechanicsDefinition;
  contentLibrary?: ContentLibrarySnapshot;
  soundEventBindings?: SoundEventBindingMap;
  audioMixer?: AudioMixerSettings;
  pluginManager?: RuntimePluginManager | null;
  /** Plan 069.3 — the static collision world (built by the host from the
   *  scene objects) so NPC movement resolves against props via the shared
   *  `resolveMove`. Absent => empty world (agent-vs-agent still applies). */
  collisionWorld?: CollisionWorld;
  /** Plan 069.9 — supplies the baked navmesh pathfinder (the host loads it
   *  async from the artifact blob). NPCs follow navmesh paths when present,
   *  straight-line otherwise. */
  getPathfinder?: () => NavMeshPathfinder | null;
  onItemPresenceCollected?: (presenceId: string) => void;
  /**
   * Plan 055 §055.6 — the host consults its WorldPresenceTracker
   * and returns true for item presences the player has already
   * collected in the active region. `registerItemInteractables`
   * skips those so re-entering the region doesn't respawn them.
   * Undefined defaults to "skip nothing" (pre-055.6 behavior).
   */
  shouldSkipItemPresence?: (presenceId: string) => boolean;
  onSpellCastSuccess?: (feedback: RuntimeSpellCastFeedback) => void;
  onAudioCommands?: (commands: RuntimeSoundCommand[]) => void;
  /**
   * Resolves a project-relative asset path to a fetchable URL (typically a
   * blob: URL minted from the project file handle). Used by the inventory
   * UI to render item thumbnails. Stable across the session lifecycle —
   * the underlying map can change without re-creating the session.
   */
  getAssetUrl?: (relativePath: string) => string | undefined;
  /**
   * Story 50.3 — central keyboard action registry. Threaded
   * through to every UI module that wants a keyboard shortcut
   * (inventory, quest journal, document, spell menu, dialogue,
   * debug HUD) so they all flow through one window-listener +
   * one mode-aware dispatcher. The host (target-web's
   * runtimeHost.ts, Studio's bootPreviewSession.ts) owns
   * registry creation alongside its `UIStateStore`.
   */
  actionRegistry?: import("../input-modes/registry").RuntimeActionRegistry;
  /**
   * Story 50.5 — the same `UIStateStore` the host owns. Threaded
   * through to the DialoguePanel so its show()/hide() can flip
   * `visibleMenuKey = "dialogue"` for the runtime-mode resolver
   * to pick up.
   */
  uiStateStore?: import("../ui-state").UIStateStore;
}

export interface RuntimeGameplaySessionController {
  readonly dialogueManager: DialogueManager;
  readonly questManager: QuestManager;
  readonly inventoryManager: InventoryManager;
  readonly casterManager: CasterManager;
  readonly npcBehaviorSystem: RuntimeNpcBehaviorSystem | null;
  readonly interactionSystem: InteractionSystem;
  readonly questSystem: QuestSystem;
  readonly blackboard: RuntimeBlackboard;
  readonly audioController: RuntimeAudioController;
  readonly worldTimeStore: WorldTimeStore;
  readonly playerKnownFactsStore: PlayerKnownFactsStore;
  /** Plan 055 §055.4 — kick off every loaded quest definition
   *  via the quest-dialogue coordinator. Idempotent: startQuest
   *  short-circuits on quests already active or completed. The
   *  host calls this AFTER the Phase 2 save-participant
   *  deserialize so restored progress isn't stomped by fresh
   *  initial state. */
  startInitialQuests: () => void;
  update: (deltaSeconds?: number) => void;
  syncBillboards: (
    cameraSnapshot: CameraSnapshot,
    deltaSeconds?: number
  ) => void;
  createBillboard: (options: {
    entity?: Entity;
    position?: { x: number; y: number; z: number };
    descriptor: BillboardDescriptor;
    component?: BillboardComponentOptions;
  }) => Entity;
  destroyBillboard: (entity: Entity) => void;
  getBillboardBindings: () => Array<{
    entity: Entity;
    sceneInstanceId: string | null;
    kind: "player" | "npc" | "item" | "inspectable";
  }>;
  getNpcRuntimeSnapshots: () => Array<{
    presenceId: string;
    npcDefinitionId: string;
    position: [number, number, number];
  }>;
  initializeDebugBillboards: () => void;
  refreshDebugBillboards: () => void;
  setDebugBillboardsEnabled: (enabled: boolean) => void;
  getDebugHudCardContributions: () => DebugHudCardContribution[];
  getDebugHudSnapshot: () => DebugHudGameplaySessionSnapshot;
  /** Plan 059 §059.1 — the host switches the music channel at
   *  lifecycle transitions (menu theme vs in-game track). */
  setMusicTrack: (
    cueDefinitionId: string | null,
    options?: { fadeOutMs?: number }
  ) => void;
  /** Returns the current NPC agent circles for the player's CollisionSystem.
   *  Reads ECS Position components, so values are one frame stale relative
   *  to when CollisionSystem runs -- acceptable and symmetric with how NPCs
   *  read the player position. */
  getNpcAgents: () => readonly CircleObstacle[];
  toggleInventory: () => void;
  toggleCaster: () => void;
  dispose: () => void;
}

export interface RuntimeGameplayAssemblyOptions extends RuntimeGameplaySessionControllerOptions {
  pluginManager?: RuntimePluginManager | null;
}

export interface RuntimeGameplayAssembly {
  readonly pluginManager: RuntimePluginManager | null;
  readonly gameplaySession: RuntimeGameplaySessionController;
  dispose: () => Promise<void>;
}

/** Plan 069.3 — sentinel agent id for the player in NPC collision (can't
 *  clash with an NPC presenceId). */
const PLAYER_COLLISION_AGENT_ID = "__player__";
const DEFAULT_AGENT_RADIUS = 0.35;

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
const DEBUG_BILLBOARD_STYLE = {
  fontSize: 11,
  color: "#eef6ff",
  backgroundColor: "rgba(17, 17, 27, 0.78)",
  padding: "5px 8px",
  maxWidth: 260
} as const;

interface DebugBillboardBinding {
  entity: Entity;
  entityKind: DebugEntityBillboardKind;
  definitionId: string | null;
  displayName: string;
  sceneId: string | null;
}

function cloneSelectionMetadata(options: {
  selectionMetadata?: Record<string, unknown>;
  npcMetadata?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const { selectionMetadata, npcMetadata } = options;
  if (!selectionMetadata && !npcMetadata) {
    return undefined;
  }

  return {
    ...(selectionMetadata ? { ...selectionMetadata } : {}),
    ...(npcMetadata ? { ...npcMetadata } : {})
  };
}

function toActiveQuestContext(
  trackedQuest: QuestTrackerView | null | undefined
): ConversationSelectionContext["activeQuest"] {
  if (!trackedQuest) {
    return null;
  }

  return {
    questDefinitionId: trackedQuest.questDefinitionId,
    displayName: trackedQuest.displayName,
    stageDisplayName: trackedQuest.stageDisplayName,
    objectives: trackedQuest.objectives.map((objective) => ({
      nodeId: objective.nodeId,
      displayName: objective.displayName,
      description: objective.description
    }))
  };
}

export function createConversationSelectionFromNpc(options: {
  npcDefinition: NPCDefinition;
  dialogueDefinitionId?: string | null;
  trackedQuest?: QuestTrackerView | null;
  metadata?: Record<string, unknown>;
}): ConversationSelectionContext | null {
  const {
    npcDefinition,
    dialogueDefinitionId = null,
    trackedQuest = null,
    metadata
  } = options;
  const selectionMetadata = cloneSelectionMetadata({
    selectionMetadata: metadata,
    npcMetadata: npcDefinition.metadata
  });

  if (npcDefinition.interactionMode === "scripted") {
    if (!dialogueDefinitionId) {
      return null;
    }

    return {
      conversationKind: "scripted-dialogue",
      dialogueDefinitionId,
      npcDefinitionId: npcDefinition.definitionId,
      npcDisplayName: npcDefinition.displayName,
      interactionMode: "scripted",
      ...(selectionMetadata ? { metadata: selectionMetadata } : {})
    };
  }

  return {
    conversationKind: "free-form",
    npcDefinitionId: npcDefinition.definitionId,
    npcDisplayName: npcDefinition.displayName,
    npcDescription: npcDefinition.description ?? null,
    interactionMode: npcDefinition.interactionMode,
    lorePageId: npcDefinition.lorePageId,
    activeQuest: toActiveQuestContext(trackedQuest),
    scriptedFollowupDialogueDefinitionId: dialogueDefinitionId,
    ...(selectionMetadata ? { metadata: selectionMetadata } : {})
  };
}

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
    mechanics,
    contentLibrary,
    collisionWorld,
    getPathfinder,
    soundEventBindings,
    audioMixer,
    pluginManager,
    onItemPresenceCollected,
    onSpellCastSuccess,
    onAudioCommands,
    shouldSkipItemPresence
  } = options;
  assertValidMechanicsDefinition(mechanics, {
    consumers: collectMechanicsConsumerInvocations({
      spellDefinitions,
      itemDefinitions
    })
  });
  // Plan 058 §058.1 — compose base + active-Scene overlay ONCE at
  // assembly setup (the region is fixed for the assembly's
  // lifetime). Every presence / inspectable read below goes
  // through this composed view, never region fields directly.
  const regionContents = activeRegion
    ? composeRegionContents(activeRegion, options.activeScene ?? null)
    : null;

  const decoratorContributions = (
    pluginManager?.getContributions("dialogue.entryDecorator") ?? []
  ).sort((a, b) => a.priority - b.priority);
  const debugHudCardContributions =
    pluginManager?.getContributions("debug.hudCard") ?? [];
  const debugEntityBillboardContributions =
    pluginManager?.getContributions("debug.entityBillboard") ?? [];
  const entryDecorators = decoratorContributions.map((c) => c.payload.decorate);
  const hoverHandlers = decoratorContributions
    .map((c) => c.payload.onTermHover)
    .filter((h): h is NonNullable<typeof h> => h != null);
  const dialoguePanel = createRuntimeDialoguePanel(root, {
    entryDecorators,
    actionRegistry: options.actionRegistry,
    uiStateStore: options.uiStateStore,
    onTermHover:
      hoverHandlers.length > 0
        ? (event) => {
            const hoverEvent = {
              term: event.term,
              lang: "",
              dwellMs: event.dwellMs
            };
            for (const handler of hoverHandlers) handler(hoverEvent);
          }
        : undefined
  });
  const questTracker = createRuntimeQuestTracker(root);
  const questJournal = createRuntimeQuestJournal(root, {
    actionRegistry: options.actionRegistry
  });
  const questNotificationCenter = createRuntimeQuestNotificationCenter(root);
  const casterManager = new CasterManager();
  const casterSystem = new CasterSystem(casterManager);
  const spellMenuUi = createRuntimeSpellMenuUI(root, casterManager, {
    actionRegistry: options.actionRegistry
  });
  const inventoryManager = new InventoryManager();
  const inventoryUi = createRuntimeInventoryUI(root, {
    getAssetUrl: options.getAssetUrl,
    actionRegistry: options.actionRegistry
  });
  const itemViewUi = createRuntimeItemViewUI(root, {
    documentDefinitions,
    actionRegistry: options.actionRegistry
  });
  const itemPickupNotifications =
    createRuntimeItemPickupNotificationCenter(root);
  const interactionPrompt = createRuntimeInteractionPrompt(root);
  const documentReaderUi = createRuntimeDocumentReaderUI(root, {
    getAssetUrl: options.getAssetUrl,
    actionRegistry: options.actionRegistry
  });
  const dialogueManager = new DialogueManager(dialoguePanel);
  const questManager = new QuestManager();
  const interactionSystem = new InteractionSystem();
  const questSystem = new QuestSystem(questManager);
  const audioController = createRuntimeAudioController({
    contentLibrary:
      contentLibrary ?? createEmptyContentLibrarySnapshot("runtime-audio"),
    soundEventBindings: soundEventBindings ?? {},
    mixer: audioMixer ?? createDefaultAudioMixerSettings(),
    activeRegion
  });
  // Plan 059 §059.1 — start the Scene's background music. The
  // host resolves the cue (Scene audioOverride ?? project
  // default); null means silence. Idempotent in the channel, so
  // re-assembly with the same track doesn't restart it.
  audioController.setMusicTrack(options.backgroundMusicCueId ?? null);
  function flushAudioCommands() {
    const commands = audioController.drainCommands();
    if (commands.length > 0) {
      onAudioCommands?.(commands);
    }
  }
  flushAudioCommands();
  const blackboard = createRuntimeBlackboard({
    definitions: [
      ...RUNTIME_BLACKBOARD_FACT_DEFINITIONS,
      ...(pluginManager
        ?.getPlugins()
        .flatMap((plugin) => plugin.blackboardFactDefinitions ?? []) ?? [])
    ]
  });
  const questDialogueCoordinator = createRuntimeQuestDialogueCoordinator();
  const conversationProviders: ConversationProvider[] =
    pluginManager
      ?.getContributions("conversation.provider")
      .map((entry) => entry.payload.provider) ?? [];
  const conversationMiddlewares: ConversationMiddleware[] =
    pluginManager
      ?.getContributions("conversation.middleware")
      .map((entry) => entry.payload.middleware) ?? [];
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
  let npcBehaviorSystem: RuntimeNpcBehaviorSystem | null = null;
  const worldTimeStore = createWorldTimeStore();
  const recentEventCollector = createRecentEventCollector();
  worldTimeStore.setBandChangeCallback((band) => setWorldTimeOfDay(blackboard, band));
  worldTimeStore.setDayChangeCallback((day) => {
    setWorldDay(blackboard, day);
    recentEventCollector.onDayAdvance(day);
  });
  worldTimeStore.setDayRestoreCallback((day) => setWorldDay(blackboard, day));
  setWorldTimeOfDay(blackboard, worldTimeStore.getBand());
  setWorldDay(blackboard, worldTimeStore.getDay());
  const playerKnownFactsStore = createPlayerKnownFactsStore();
  playerKnownFactsStore.setChangeCallback((texts) => setPlayerKnownFacts(blackboard, texts));
  setPlayerKnownFacts(blackboard, []);
  const billboardSystem = new BillboardSystem();
  const billboardOnlyEntities = new Set<Entity>();
  const debugBillboardBindings = new Map<Entity, DebugBillboardBinding>();
  const debugBillboardWarningKeys = new Set<string>();
  let debugBillboardsInitialized = false;
  let debugBillboardsEnabled = false;
  // Plan 069.5 — the static collision world, shared by reference with the
  // player CollisionSystem (host) and the NPC collision context below, so a
  // single per-frame containment-gate refresh reaches both resolve paths.
  const sharedCollisionWorld = collisionWorld ?? createEmptyCollisionWorld();

  // Plan 069.5 — fire an authored on-enter trigger action: play (enter) /
  // stop (exit) the cue and, on enter, set the world flag. Player-only.
  function fireTriggerAction(volume: RegionVolumeDefinition, kind: "enter" | "exit") {
    const trigger = volume.trigger;
    if (!trigger) {
      return;
    }
    const instanceKey = `region:${activeRegion?.identity.id ?? "region"}:trigger:${volume.volumeId}`;
    if (kind === "exit") {
      if (trigger.action.audioCueId) {
        audioController.stopInstance(instanceKey);
      }
      return;
    }
    if (trigger.action.audioCueId) {
      audioController.playCue({
        cueDefinitionId: trigger.action.audioCueId,
        instanceKey,
        position: volume.bounds.center
      });
    }
    const flag = trigger.action.setWorldFlag;
    if (flag?.key) {
      questManager.setFlag(flag.key, resolveWorldFlagWriteValue(flag));
    }
  }

  const spatialResolverSystem = activeRegion
    ? createRuntimeSpatialResolverSystem({
        blackboard,
        region: activeRegion,
        playerEntityId: playerDefinition.definitionId,
        confirmationFrames: SPATIAL_AREA_CONFIRMATION_FRAMES,
        logDebug(event, payload) {
          console.info(`[runtime-core] ${event}`, payload ?? {});
        },
        onTriggerEvent({ volume, kind }) {
          fireTriggerAction(volume, kind);
        }
      })
    : null;

  function logConversationDebug(
    event: string,
    payload?: Record<string, unknown>
  ) {
    console.info(`[runtime-core] ${event}`, payload ?? {});
  }

  function warnDebugBillboardOnce(
    key: string,
    payload: Record<string, unknown>
  ) {
    if (debugBillboardWarningKeys.has(key)) {
      return;
    }
    debugBillboardWarningKeys.add(key);
    console.warn("[runtime-core] debug-billboard-warning", payload);
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

    return regionContents?.playerPresence?.transform.position ?? [0, 0, 0];
  }

  function resolvePlayerEntity(): Entity | null {
    return world.query(PlayerControlled, Position)[0] ?? null;
  }

  function resolvePlayerStatCarrier(): StatCarrier | null {
    const playerEntity = resolvePlayerEntity();
    if (playerEntity === null) return null;
    return world.getComponent(playerEntity, Caster)?.stats ?? null;
  }

  const mechanicsEmitContributions =
    pluginManager?.getContributions("mechanics.emitHandler") ?? [];
  const pluginConfigById = new Map(
    pluginManager
      ?.getPlugins()
      .map((plugin) => [plugin.pluginId, plugin.config ?? {}]) ?? []
  );
  const mechanicsEmitHandlers = new Map<
    string,
    Array<(dispatch: MechanicsEmitDispatch) => void>
  >();
  const mechanicsEmitDisposers: Array<() => void> = [];

  function dispatchCastableFromPlugin(
    invocation: CastableInvocation
  ): CastableExecutionResult {
    const caster = resolvePlayerStatCarrier();
    if (!caster) {
      return {
        status: "runtime-error",
        castable: null,
        error: "No player caster available."
      };
    }
    const executor = createCastableExecutor({
      mechanics,
      emit: (kind, payload) =>
        dispatchMechanicsEmit({
          emitKind: kind,
          payload,
          caster,
          target: null
        })
    });
    return executor.execute({
      invocation,
      caster,
      target: null
    });
  }

  function dispatchMechanicsEmit(dispatch: MechanicsEmitDispatch): void {
    const handlers = mechanicsEmitHandlers.get(dispatch.emitKind) ?? [];
    for (const handler of handlers) {
      handler(dispatch);
    }
  }

  function setupMechanicsEmitHandlers(): void {
    for (const contribution of mechanicsEmitContributions) {
      const setupResult = contribution.payload.setup({
        mountRoot: root,
        config: pluginConfigById.get(contribution.pluginId) ?? {},
        dispatchCastable: dispatchCastableFromPlugin,
        claimInput: (lockId) => inputManager.addMovementLock(lockId),
        releaseInput: (lockId) => inputManager.removeMovementLock(lockId)
      });

      const subscribedKinds = new Set(contribution.payload.emitKinds);
      for (const emitKind of subscribedKinds) {
        const existing = mechanicsEmitHandlers.get(emitKind) ?? [];
        existing.push(setupResult.handle);
        mechanicsEmitHandlers.set(emitKind, existing);
      }
      if (setupResult.dispose) {
        mechanicsEmitDisposers.push(setupResult.dispose);
      }
    }
  }

  function getDebugHudSnapshot(): DebugHudGameplaySessionSnapshot {
    const playerPosition = getEntityPosition(
      blackboard,
      playerDefinition.definitionId
    );
    const playerArea = getEntityCurrentArea(
      blackboard,
      playerDefinition.definitionId
    );

    return {
      activeEntityCount: world.getEntities().size,
      activeSystemCount: world.getSystemCount(),
      activeNpcCount: npcInteractableEntities.size,
      activeQuestCount: questManager.getJournalData().active.length,
      currentRegionId: activeRegion?.identity.id ?? null,
      // Plan 058 — the narrative Scene, not the visual scene (the
      // pre-058 field misleadingly reported the region id here).
      currentSceneName: options.activeScene?.displayName ?? null,
      currentAreaDisplayName: playerArea?.area?.displayName ?? null,
      playerPosition: playerPosition
        ? {
            x: playerPosition.x,
            y: playerPosition.y,
            z: playerPosition.z
          }
        : null,
      dialogueActive: dialogueManager.isDialogueActive()
    };
  }

  function syncBlackboardSpatialFacts() {
    const region = activeRegion;
    if (!region || !spatialResolverSystem) {
      return;
    }

    const [playerX, playerY, playerZ] = resolvePlayerPositionTuple();
    spatialResolverSystem.sync({
      playerPosition: { x: playerX, y: playerY, z: playerZ },
      npcPositions: (regionContents?.npcPresences ?? []).map((presence) => {
        const runtimeNpcEntity =
          npcInteractableEntities.get(presence.presenceId)?.entity ?? null;
        const runtimePosition =
          runtimeNpcEntity !== null
            ? world.getComponent(runtimeNpcEntity, Position)
            : null;
        const [x, y, z] = runtimePosition
          ? [runtimePosition.x, runtimePosition.y, runtimePosition.z]
          : presence.transform.position;
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
      objectives: questManager.getActiveObjectivesForTrackedQuest().map((objective) => ({
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
      const activeQuestStage = trackedQuest
        ? getActiveQuestStage(blackboard, trackedQuest.questId)
        : null;
      const activeQuestObjectives = trackedQuest
        ? getActiveQuestObjectives(blackboard, trackedQuest.questId)
        : null;
      const playerLocation = getEntityLocation(
        blackboard,
        playerDefinition.definitionId
      );
      const playerPosition = getEntityPosition(
        blackboard,
        playerDefinition.definitionId
      );
      const playerArea = getEntityCurrentArea(
        blackboard,
        playerDefinition.definitionId
      );
      const npcLocation = context.selection.npcDefinitionId
        ? getEntityLocation(blackboard, context.selection.npcDefinitionId)
        : null;
      const npcPosition = context.selection.npcDefinitionId
        ? getEntityPosition(blackboard, context.selection.npcDefinitionId)
        : null;
      const npcArea = context.selection.npcDefinitionId
        ? getEntityCurrentArea(blackboard, context.selection.npcDefinitionId)
        : null;
      const npcPlayerRelation = context.selection.npcDefinitionId
        ? getEntityPlayerSpatialRelation(
            blackboard,
            context.selection.npcDefinitionId
          )
        : null;
      const npcMovement = context.selection.npcDefinitionId
        ? getEntityMovement(blackboard, context.selection.npcDefinitionId)
        : null;
      const npcCurrentTask = context.selection.npcDefinitionId
        ? (npcBehaviorSystem?.getCurrentTask(
            context.selection.npcDefinitionId
          ) ?? null)
        : null;
      const npcCurrentActivity = context.selection.npcDefinitionId
        ? getEntityCurrentActivity(
            blackboard,
            context.selection.npcDefinitionId
          )
        : null;
      const npcCurrentGoal = context.selection.npcDefinitionId
        ? getEntityCurrentGoal(blackboard, context.selection.npcDefinitionId)
        : null;
      const npcBehavior = context.selection.npcDefinitionId
        ? {
            movement: npcMovement,
            task: npcCurrentTask,
            activity: npcCurrentActivity,
            goal: npcCurrentGoal
          }
        : null;
      // Plan 077.3 (D4): read the world-narrative surfacing count so the NPC
      // prompt can reflect how many times the objective has been raised.
      const goalSurfacedCount = trackedQuest
        ? getGoalSurfacedCount(blackboard, trackedQuest.questId)
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
        npcBehavior,
        trackedQuest,
        activeQuestStage,
        activeQuestObjectives,
        goalSurfacedCount,
        timeOfDay: getTimeOfDayBand(blackboard),
        knownFacts: getPlayerKnownFacts(blackboard),
        recentWorldEvents: recentEventCollector.getRecentEvents()
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
      if (
        builtInSpeaker.kind === "player" ||
        builtInSpeaker.kind === "player-vo"
      ) {
        return playerDefinition.displayName;
      }
      return builtInSpeaker.displayName;
    }

    return npcDefinitions.find((npc) => npc.definitionId === speakerId)
      ?.displayName;
  }

  function syncQuestUi() {
    questTracker.update(questManager.getTrackedQuest());
    questJournal.update(questManager.getJournalData());
  }

  // Single enforcer for NPC interactable availability, used both at
  // interactable creation and on every sync. Missing definition falls to
  // the scripted/coordinator path.
  function resolveNpcInteractableAvailability(npcDefinitionId: string): boolean {
    const npcDefinition = npcDefinitions.find(
      (candidate) => candidate.definitionId === npcDefinitionId
    );
    if (!npcDefinition || npcDefinition.interactionMode === "scripted") {
      return questDialogueCoordinator.isNpcInteractableAvailable(npcDefinitionId);
    }
    return conversationProviders.length > 0;
  }

  function syncNpcInteractionAvailability() {
    for (const {
      npcDefinitionId,
      entity
    } of npcInteractableEntities.values()) {
      const interactable = world.getComponent(entity, Interactable);
      if (!interactable) continue;
      interactable.available = resolveNpcInteractableAvailability(npcDefinitionId);
    }
  }

  function resolveNpcConversationSelection(
    npcDefinitionId: string
  ): ConversationSelectionContext | null {
    const npcDefinition =
      npcDefinitions.find(
        (candidate) => candidate.definitionId === npcDefinitionId
      ) ?? null;
    if (!npcDefinition) {
      logConversationDebug("conversation-selection-missing-npc", {
        npcDefinitionId
      });
      return null;
    }

    if (npcDefinition.interactionMode === "scripted") {
      const dialogueDefinitionId =
        questDialogueCoordinator.resolveNpcDialogueDefinitionId(
          npcDefinitionId
        );
      if (!dialogueDefinitionId) {
        logConversationDebug(
          "conversation-selection-scripted-missing-dialogue",
          {
            npcDefinitionId,
            interactionMode: npcDefinition.interactionMode
          }
        );
        return null;
      }
      const selection = createConversationSelectionFromNpc({
        npcDefinition,
        dialogueDefinitionId
      });
      if (!selection) {
        return null;
      }
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

    const selection = createConversationSelectionFromNpc({
      npcDefinition,
      dialogueDefinitionId,
      trackedQuest
    });
    if (!selection) {
      return null;
    }
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
      case "notify-quest-event":
        questManager.notifyEvent(proposal.eventName);
        return;
      case "start-scripted-followup":
        pendingScriptedFollowupDialogueId = proposal.dialogueDefinitionId;
        return;
      case "request-close":
        return;
      // Plan 077 §077.3a (D4): coarse proxy for "NPC was prompted to voice
      // the quest objective". Sugaragent cannot call setFact directly
      // (assertWriteAllowed throws -- narrative-system != sugaragent). This
      // handler performs the owner-side write on runtime-core's behalf.
      case "bump-goal-surfaced":
        bumpGoalSurfacedCount(blackboard, proposal.questId);
        return;
      default: {
        const exhaustive: never = proposal;
        console.debug(
          "[runtime-core] unhandled conversation action proposal",
          exhaustive
        );
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
    if (!regionContents) return;

    for (const presence of regionContents.npcPresences) {
      const npcDefinition = npcDefinitions.find(
        (definition) => definition.definitionId === presence.npcDefinitionId
      );
      const interactableEntity = world.createEntity();
      world.addComponent(
        interactableEntity,
        new Position(...presence.transform.position)
      );
      world.addComponent(
        interactableEntity,
        new Interactable(
          "npc",
          presence.presenceId,
          presence.npcDefinitionId,
          `Talk to ${npcDefinition?.displayName ?? "NPC"}`,
          2.0,
          resolveNpcInteractableAvailability(presence.npcDefinitionId)
        )
      );
      npcInteractableEntities.set(presence.presenceId, {
        npcDefinitionId: presence.npcDefinitionId,
        entity: interactableEntity
      });
    }
  }

  function registerOneItemInteractable(presence: RegionItemPresence) {
    const itemDefinition = itemDefinitions.find(
      (definition) => definition.definitionId === presence.itemDefinitionId
    );
    const promptText =
      itemDefinition?.interactionView.kind === "trigger-castable"
        ? itemDefinition.interactionView.title.trim() ||
          `Interact with ${itemDefinition.displayName}`
        : `Pick up ${itemDefinition?.displayName ?? "Item"}`;
    const interactableEntity = world.createEntity();
    world.addComponent(
      interactableEntity,
      new Position(...presence.transform.position)
    );
    world.addComponent(
      interactableEntity,
      new Interactable(
        "item",
        presence.presenceId,
        presence.itemDefinitionId,
        promptText,
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

  function registerItemInteractables() {
    if (!regionContents) return;
    // Plan 057 — iterate through the shared filter helper so
    // the ECS spawn path here and the visual mesh spawn path
    // (in target-web's runtimeHost) apply the same filter set.
    // Any future filter (Plan 058 Scene gating, etc.)
    // composes into `shouldSkipItemPresence` at the host and
    // both paths pick it up automatically.
    iterateActiveItemPresences(
      regionContents.itemPresences,
      {
        shouldSkip: (presenceId) =>
          shouldSkipItemPresence?.(presenceId) ?? false
      },
      registerOneItemInteractable
    );
  }

  function registerInspectableInteractables() {
    if (!regionContents) return;

    // Composed view: inspectables can be base-scope (permanent
    // statue) or overlay-scope (Scene-specific prop) — both spawn.
    for (const asset of regionContents.placedAssets) {
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

    if (
      !inventoryManager.addItem(
        itemDefinition.definitionId,
        itemPresence.quantity
      )
    ) {
      return;
    }

    const interactable = world.getComponent(itemPresence.entity, Interactable);
    if (interactable) {
      interactable.available = false;
    }
    world.destroyEntity(itemPresence.entity);
    itemInteractableEntities.delete(presenceId);
    itemPickupNotifications.push(
      itemDefinition.displayName,
      itemPresence.quantity
    );
    audioController.emitEvent("item.pickup", {
      instanceKey: `item.pickup:${presenceId}`
    });
    onItemPresenceCollected?.(presenceId);
    syncInteractionPrompt();
  }

  function executeItemCastableInteraction(presenceId: string): void {
    const itemPresence = itemInteractableEntities.get(presenceId);
    if (!itemPresence) return;
    const itemDefinition = itemDefinitions.find(
      (definition) => definition.definitionId === itemPresence.itemDefinitionId
    );
    if (!itemDefinition) return;
    const caster = resolvePlayerStatCarrier();
    if (!caster) {
      logConversationDebug("item-castable-missing-caster", {
        presenceId,
        itemDefinitionId: itemDefinition.definitionId
      });
      return;
    }

    const result = executeTriggerCastableItemInteraction({
      mechanics,
      itemDefinition,
      caster,
      emit: (kind, payload) =>
        dispatchMechanicsEmit({
          emitKind: kind,
          payload,
          caster,
          target: null
        })
    });
    if (result.status !== "success") {
      logConversationDebug("item-castable-execution-failed", {
        presenceId,
        itemDefinitionId: itemDefinition.definitionId,
        status: result.status,
        error: result.error ?? null
      });
    }
  }

  function createBillboard(options: {
    entity?: Entity;
    position?: { x: number; y: number; z: number };
    descriptor: BillboardDescriptor;
    component?: BillboardComponentOptions;
  }): Entity {
    const targetEntity = options.entity ?? world.createEntity();
    const existingPosition = world.getComponent(targetEntity, Position);

    if (options.position) {
      if (existingPosition) {
        existingPosition.x = options.position.x;
        existingPosition.y = options.position.y;
        existingPosition.z = options.position.z;
      } else {
        world.addComponent(
          targetEntity,
          new Position(
            options.position.x,
            options.position.y,
            options.position.z
          )
        );
      }
    } else if (!existingPosition) {
      throw new Error(
        "Billboards require a Position component. Provide an entity with Position or pass options.position."
      );
    }

    const existingBillboard = world.getComponent(
      targetEntity,
      BillboardComponent
    );
    if (existingBillboard) {
      const next = new BillboardComponent(
        options.descriptor,
        options.component
      );
      existingBillboard.descriptor = next.descriptor;
      existingBillboard.orientation = next.orientation;
      existingBillboard.displayMode = next.displayMode;
      existingBillboard.size = next.size;
      existingBillboard.offset = next.offset;
      existingBillboard.lodThresholds = next.lodThresholds;
      existingBillboard.enabled = next.enabled;
      existingBillboard.visible = next.visible;
      existingBillboard.lodState = next.lodState;
    } else {
      world.addComponent(
        targetEntity,
        new BillboardComponent(options.descriptor, options.component)
      );
    }

    if (options.entity == null) {
      billboardOnlyEntities.add(targetEntity);
    }

    return targetEntity;
  }

  function destroyBillboard(entity: Entity) {
    if (billboardOnlyEntities.has(entity)) {
      billboardOnlyEntities.delete(entity);
      world.destroyEntity(entity);
      return;
    }

    world.removeComponent(entity, BillboardComponent);
  }

  function buildEntityBillboardContext(
    binding: DebugBillboardBinding
  ): EntityBillboardContext {
    return {
      entityId: binding.entity,
      entityKind: binding.entityKind,
      definitionId: binding.definitionId,
      displayName: binding.displayName,
      sceneId: binding.sceneId,
      blackboard
    };
  }

  function buildCoreDebugBillboardLines(
    binding: DebugBillboardBinding
  ): string[] {
    const lines = [binding.displayName];

    if (binding.entityKind === "npc" && binding.definitionId) {
      const currentTask =
        npcBehaviorSystem?.getCurrentTask(binding.definitionId) ?? null;
      const activity = getEntityCurrentActivity(
        blackboard,
        binding.definitionId
      );
      const area = getEntityCurrentArea(blackboard, binding.definitionId);
      const relation = getEntityPlayerSpatialRelation(
        blackboard,
        binding.definitionId
      );

      if (currentTask?.displayName) {
        lines.push(`task: ${currentTask.displayName}`);
      }
      if (activity?.activity) {
        lines.push(`activity: ${activity.activity}`);
      }
      if (area?.area?.displayName) {
        lines.push(`area: ${area.area.displayName}`);
      }
      if (relation?.proximityBand) {
        lines.push(`proximity: ${relation.proximityBand}`);
      }
      return lines;
    }

    if (binding.entityKind === "player") {
      const area = getEntityCurrentArea(
        blackboard,
        playerDefinition.definitionId
      );
      const position = getEntityPosition(
        blackboard,
        playerDefinition.definitionId
      );
      if (area?.area?.displayName) {
        lines.push(`area: ${area.area.displayName}`);
      }
      if (position) {
        lines.push(
          `pos: ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`
        );
      }
    }

    return lines;
  }

  function buildPluginDebugBillboardLines(
    binding: DebugBillboardBinding
  ): string[] {
    const context = buildEntityBillboardContext(binding);
    const groupedLines: string[][] = [];

    for (const contribution of debugEntityBillboardContributions) {
      const lines = contribution.payload
        .getLines(context)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > 0) {
        groupedLines.push(lines);
      }
    }

    if (groupedLines.length === 0) {
      return [];
    }

    const merged: string[] = [];
    groupedLines.forEach((group, index) => {
      if (index > 0) {
        merged.push("···");
      }
      merged.push(...group);
    });
    return merged;
  }

  function applyDebugBillboardEnabledState() {
    for (const binding of debugBillboardBindings.values()) {
      const billboard = world.getComponent(binding.entity, BillboardComponent);
      if (!billboard) {
        continue;
      }
      billboard.enabled = debugBillboardsEnabled;
    }
  }

  function initializeDebugBillboards() {
    if (debugBillboardsInitialized) {
      return;
    }

    const playerEntity = resolvePlayerEntity();
    if (playerEntity !== null) {
      debugBillboardBindings.set(playerEntity, {
        entity: playerEntity,
        entityKind: "player",
        definitionId: playerDefinition.definitionId,
        displayName: playerDefinition.displayName,
        sceneId: activeRegion?.identity.id ?? null
      });
      createBillboard({
        entity: playerEntity,
        descriptor: {
          kind: "text",
          content: playerDefinition.displayName,
          style: DEBUG_BILLBOARD_STYLE
        },
        component: {
          orientation: "spherical",
          displayMode: "overlay",
          size: { width: 1.4, height: 0.4 },
          offset: { x: 0, y: 2.1, z: 0 },
          enabled: false
        }
      });
    }

    for (const entry of npcInteractableEntities.values()) {
      const npcDefinition =
        npcDefinitions.find(
          (candidate) => candidate.definitionId === entry.npcDefinitionId
        ) ?? null;
      debugBillboardBindings.set(entry.entity, {
        entity: entry.entity,
        entityKind: "npc",
        definitionId: entry.npcDefinitionId,
        displayName: npcDefinition?.displayName ?? "NPC",
        sceneId: activeRegion?.identity.id ?? null
      });
      createBillboard({
        entity: entry.entity,
        descriptor: {
          kind: "text",
          content: npcDefinition?.displayName ?? "NPC",
          style: DEBUG_BILLBOARD_STYLE
        },
        component: {
          orientation: "spherical",
          displayMode: "overlay",
          size: { width: 1.6, height: 0.5 },
          offset: { x: 0, y: 2.2, z: 0 },
          enabled: false
        }
      });
    }

    debugBillboardsInitialized = true;
    applyDebugBillboardEnabledState();
    refreshDebugBillboards();
  }

  function refreshDebugBillboards() {
    if (!debugBillboardsInitialized) {
      return;
    }

    for (const binding of debugBillboardBindings.values()) {
      const billboard = world.getComponent(binding.entity, BillboardComponent);
      if (!billboard) {
        warnDebugBillboardOnce(`missing:${binding.entity}`, {
          entity: binding.entity,
          definitionId: binding.definitionId,
          displayName: binding.displayName,
          reason: "missing-billboard-component"
        });
        continue;
      }
      if (billboard.descriptor.kind !== "text") {
        warnDebugBillboardOnce(`non-text:${binding.entity}`, {
          entity: binding.entity,
          definitionId: binding.definitionId,
          displayName: binding.displayName,
          descriptorKind: billboard.descriptor.kind,
          reason: "expected-text-billboard"
        });
        continue;
      }

      const lines = buildCoreDebugBillboardLines(binding);
      lines.push(...buildPluginDebugBillboardLines(binding));
      billboard.descriptor = {
        ...billboard.descriptor,
        content: lines.join("\n"),
        style: DEBUG_BILLBOARD_STYLE
      };
    }
  }

  function setDebugBillboardsEnabled(enabled: boolean) {
    debugBillboardsEnabled = enabled;
    applyDebugBillboardEnabledState();
    if (enabled) {
      refreshDebugBillboards();
    }
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

  questDialogueCoordinator.loadDefinitions(
    dialogueDefinitions,
    questDefinitions
  );
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
  questManager.setCanCastSpellProvider(
    (spellDefinitionId) => casterManager.canCastSpell(spellDefinitionId).canCast
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
    const count = Number.isFinite(numericValue)
      ? Math.max(1, Math.floor(numericValue))
      : 1;

    if (action.type === "giveItem" && action.targetId) {
      inventoryManager.addItem(action.targetId, count);
      return;
    }

    if (action.type === "removeItem" && action.targetId) {
      inventoryManager.removeItem(action.targetId, count);
      return;
    }

    // Plan 058 §058.5 — Scene progression actions belong to the
    // host (campaign.progression lives there), not the assembly.
    if (
      action.type === "unlockScene" ||
      action.type === "advanceToNextScene"
    ) {
      options.onSceneAction?.({
        type: action.type,
        sceneId: action.targetId ?? null
      });
    }

    if (action.type === "set-time-of-day" && action.targetId) {
      worldTimeStore.setTimeBand(action.targetId as TimeOfDayBand);
      return;
    }

    if (action.type === "advance-day") {
      worldTimeStore.advanceDay();
      return;
    }

    if (
      action.type === "learn-fact" &&
      action.targetId &&
      typeof action.value === "string"
    ) {
      playerKnownFactsStore.learnFact(action.targetId, action.value);
      return;
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
    recentEventCollector.onQuestEvent(event);
    if (event.type === "quest-complete") {
      audioController.emitEvent("quest.reward", {
        instanceKey: `quest.reward:${event.questDefinitionId}`
      });
    }
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
      documentReaderUi.show(documentDefinition, {
        kicker: "Inventory document"
      });
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
    audioController.emitEvent("interaction.activate", {
      instanceKey: `interaction.activate:${nearby.type}:${nearby.instanceId}`
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
      const itemDefinition = itemDefinitions.find(
        (definition) => definition.definitionId === nearby.targetId
      );
      if (itemDefinition?.interactionView.kind === "trigger-castable") {
        executeItemCastableInteraction(nearby.instanceId);
        return;
      }
      collectItemPresence(nearby.instanceId);
      return;
    }

    if (nearby.type === "inspectable") {
      const inspectable = inspectableInteractableEntities.get(
        nearby.instanceId
      );
      if (!inspectable) return;

      const documentDefinition = documentDefinitions.find(
        (definition) =>
          definition.definitionId === inspectable.documentDefinitionId
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
  casterManager.registerMechanics(mechanics);
  casterManager.registerDefinitions(spellDefinitions);
  casterManager.setMechanicsEmitHandler(dispatchMechanicsEmit);
  setupMechanicsEmitHandlers();
  casterManager.setSpellCastHandler((spell, result) => {
    questManager.notifySpellCast(spell.definitionId);
    audioController.emitEvent("spell.cast-success", {
      instanceKey: `spell.cast-success:${spell.definitionId}`
    });
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
  // Plan 069.3 — agent radii are stable; precompute once. Hoisted so
  // getNpcAgents() (called by the player CollisionSystem each frame) can
  // use accurate per-NPC radii without re-deriving them on every call.
  const npcAgentRadiusById = new Map(
    npcDefinitions.map((definition) => [
      definition.definitionId,
      computeNpcAgentDimensions(definition).radius
    ])
  );
  if (activeRegion) {
    // Player id is a sentinel that can't collide with an NPC presenceId.
    const playerAgentRadius =
      computePlayerAgentDimensions(playerDefinition).radius;
    npcBehaviorSystem = createRuntimeNpcBehaviorSystem({
      region: activeRegion,
      world,
      blackboard,
      getNpcEntities: () =>
        Array.from(npcInteractableEntities.entries()).map(
          ([presenceId, entry]) => ({
            presenceId,
            npcDefinitionId: entry.npcDefinitionId,
            entity: entry.entity
          })
        ),
      hasWorldFlag: (key, value) => questManager.hasFlag(key, value),
      // Plan 069.9 — NPCs follow the baked navmesh (host loads it async).
      getPathfinder,
      // Plan 069.3 — per-sync snapshot of the collision world + every agent
      // circle (player + NPCs), so NPC moves resolve against props and each
      // other through the shared resolveMove.
      getCollisionContext: () => {
        const agents: NpcCollisionAgent[] = [];
        const playerEntity = resolvePlayerEntity();
        if (playerEntity !== null) {
          const playerPos = world.getComponent(playerEntity, Position);
          if (playerPos) {
            agents.push({
              id: PLAYER_COLLISION_AGENT_ID,
              x: playerPos.x,
              z: playerPos.z,
              radius: playerAgentRadius
            });
          }
        }
        for (const [presenceId, entry] of npcInteractableEntities.entries()) {
          const npcPos = world.getComponent(entry.entity, Position);
          if (!npcPos) {
            continue;
          }
          agents.push({
            id: presenceId,
            x: npcPos.x,
            z: npcPos.z,
            radius:
              npcAgentRadiusById.get(entry.npcDefinitionId) ??
              DEFAULT_AGENT_RADIUS
          });
        }
        return { world: sharedCollisionWorld, agents };
      },
      logDebug(event, payload) {
        console.info(`[runtime-core] ${event}`, payload ?? {});
      }
    });
  }
  registerItemInteractables();
  registerInspectableInteractables();
  // Plan 055 §055.4 — startInitialQuests is now called by the
  // runtime host AFTER the Phase 2 save-participant deserialize
  // finishes. The quest.manager participant needs to populate
  // activeQuests + completedQuestIds from the save BEFORE
  // startInitialQuests runs, otherwise fresh quest states would
  // stomp restored progress. Exposed via
  // `assembly.startInitialQuests()` below.
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
    inventoryManager,
    casterManager,
    npcBehaviorSystem,
    worldTimeStore,
    playerKnownFactsStore,
    interactionSystem,
    questSystem,
    blackboard,
    audioController,
    // Plan 055 §055.4 — the host calls this AFTER the Phase 2
    // save-participant deserialize so quest.manager's restored
    // activeQuests + completedQuestIds are in place before
    // startQuest short-circuits kick in. Called unconditionally
    // (idempotent) for both fresh and returning players; already-
    // active or already-completed quests are no-op'd inside
    // startQuest.
    startInitialQuests: () => questDialogueCoordinator.startInitialQuests(),
    update(deltaSeconds = 1 / 60) {
      blackboard.advanceFrame();
      const trackedQuest = questManager.getTrackedQuest();
      // Plan 069.5 — re-evaluate conditional containment gates against the
      // current quest/flag state BEFORE any move resolves this frame (NPC
      // sync here; the player CollisionSystem reads the same world next tick).
      if (sharedCollisionWorld.gates.length > 0) {
        applyVolumeColliderGates(sharedCollisionWorld, {
          activeQuest: trackedQuest
            ? {
                questDefinitionId: trackedQuest.questDefinitionId,
                stageId: trackedQuest.stageId
              }
            : null,
          hasWorldFlag: (key, value) => questManager.hasFlag(key, value)
        });
      }
      npcBehaviorSystem?.sync({
        deltaSeconds,
        activeQuest: trackedQuest
          ? {
              questDefinitionId: trackedQuest.questDefinitionId,
              stageId: trackedQuest.stageId
            }
          : null
      });
      syncBlackboardSpatialFacts();
      syncBlackboardQuestFacts();
      spellMenuUi.update();
      flushAudioCommands();
    },
    syncBillboards(cameraSnapshot, deltaSeconds = 1 / 60) {
      billboardSystem.update(world, deltaSeconds, cameraSnapshot);
    },
    createBillboard,
    destroyBillboard,
    getBillboardBindings() {
      const bindings: Array<{
        entity: Entity;
        sceneInstanceId: string | null;
        kind: "player" | "npc" | "item" | "inspectable";
      }> = [];
      const playerEntity = resolvePlayerEntity();
      if (playerEntity !== null) {
        bindings.push({
          entity: playerEntity,
          sceneInstanceId: null,
          kind: "player"
        });
      }
      for (const [presenceId, entry] of npcInteractableEntities.entries()) {
        bindings.push({
          entity: entry.entity,
          sceneInstanceId: presenceId,
          kind: "npc"
        });
      }
      for (const [presenceId, entry] of itemInteractableEntities.entries()) {
        bindings.push({
          entity: entry.entity,
          sceneInstanceId: presenceId,
          kind: "item"
        });
      }
      for (const [
        instanceId,
        entry
      ] of inspectableInteractableEntities.entries()) {
        bindings.push({
          entity: entry.entity,
          sceneInstanceId: instanceId,
          kind: "inspectable"
        });
      }
      return bindings;
    },
    getNpcRuntimeSnapshots() {
      return Array.from(npcInteractableEntities.entries()).flatMap(
        ([presenceId, entry]) => {
          const position = world.getComponent(entry.entity, Position);
          if (!position) {
            return [];
          }
          return [
            {
              presenceId,
              npcDefinitionId: entry.npcDefinitionId,
              position: [position.x, position.y, position.z] as [
                number,
                number,
                number
              ]
            }
          ];
        }
      );
    },
    getNpcAgents(): CircleObstacle[] {
      const agents: CircleObstacle[] = [];
      for (const [presenceId, entry] of npcInteractableEntities.entries()) {
        const pos = world.getComponent(entry.entity, Position);
        if (!pos) continue;
        agents.push({
          id: presenceId,
          x: pos.x,
          z: pos.z,
          radius: npcAgentRadiusById.get(entry.npcDefinitionId) ?? DEFAULT_AGENT_RADIUS
        });
      }
      return agents;
    },
    initializeDebugBillboards,
    refreshDebugBillboards,
    setDebugBillboardsEnabled,
    getDebugHudCardContributions() {
      return debugHudCardContributions;
    },
    getDebugHudSnapshot,
    setMusicTrack(cueDefinitionId, musicOptions) {
      audioController.setMusicTrack(cueDefinitionId, musicOptions);
      flushAudioCommands();
    },
    toggleInventory: inventoryUi.toggle,
    toggleCaster: spellMenuUi.toggle,
    dispose() {
      for (const dispose of [...mechanicsEmitDisposers].reverse()) {
        dispose();
      }
      mechanicsEmitDisposers.length = 0;
      mechanicsEmitHandlers.clear();
      npcBehaviorSystem?.reset();
      spatialResolverSystem?.reset();
      debugBillboardWarningKeys.clear();
      for (const entity of debugBillboardBindings.keys()) {
        world.removeComponent(entity, BillboardComponent);
      }
      debugBillboardBindings.clear();
      for (const entity of billboardOnlyEntities) {
        world.destroyEntity(entity);
      }
      billboardOnlyEntities.clear();
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
  const gameplaySession = createRuntimeGameplaySessionController(options);

  if (pluginManager) {
    void pluginManager.init({
      blackboard: gameplaySession.blackboard,
      activeRegion: options.activeRegion,
      activeScene: options.activeScene ?? null,
      playerDefinition: options.playerDefinition,
      spellDefinitions: options.spellDefinitions,
      itemDefinitions: options.itemDefinitions,
      documentDefinitions: options.documentDefinitions,
      npcDefinitions: options.npcDefinitions,
      dialogueDefinitions: options.dialogueDefinitions,
      questDefinitions: options.questDefinitions
    });
    options.world.addSystem(new RuntimePluginSystem(pluginManager));
  }

  return {
    pluginManager,
    gameplaySession,
    async dispose() {
      gameplaySession.dispose();
      await pluginManager?.dispose();
    }
  };
}
