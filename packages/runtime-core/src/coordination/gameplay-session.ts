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
  type NPCAnimationSlot,
  type NPCDefinition,
  type NPCInteractionMode,
  resolveEffectiveInteractionMode,
  type PlayerDefinition,
  createWorldFlagNameResolver,
  type WorldFlagDefinition,
  type QuestDefinition,
  type RegionItemPresence,
  type RegionNPCPresence,
  type Scene,
  type SpellDefinition,
  type RegionDocument,
  type RegionVolumeDefinition,
  type SoundEventBindingMap,
  type QuestActionDefinition
} from "@sugarmagic/domain";
import {
  WorldFlagManager,
  coerceAuthoredWorldFlagValue
} from "../world-flags/WorldFlagManager";
import { createWorldFlagProjection } from "../world-flags/projection";
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
import type { NpcInteractionModeStore } from "../npc/interaction-mode-store";
import type { TelemetryCollector } from "../telemetry";
import {
  resolveWorldFlagWriteValue,
  evaluateRegionQuestBinding,
  type RegionConditionContext,
  type QuestProgressReader
} from "../region-conditions";
import {
  createRuntimeQuestJournal,
  createRuntimeQuestNotificationCenter,
  type QuestTrackerView,
  type QuestActionSource,
  questActionInstanceKey,
  describeQuestActionSource,
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
  RuntimePluginManager,
  RuntimePluginContribution
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
import { buildLocationReference, isRegionAreaDescendant } from "../spatial";
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
  /**
   * Requests a NAMED camera move. Injected by the host, which owns the live
   * camera -- the session asks for a framing by name and never sees a camera,
   * the same shape as claimInput / releaseInput.
   *
   * Optional: a host without a camera (tests, headless) simply omits it and
   * everything else behaves identically.
   */
  cameraMoves?: {
    request: (moveName: string) => void;
    release: (moveName: string) => void;
  };
  activeRegion: RegionDocument | null;
  /**
   * Plan 058 §058.1 — the active narrative Scene whose overlay
   * composes onto the region base. The assembly reads presences
   * and inspectable assets from the COMPOSED view (Pattern 1),
   * never from the region directly. Null composes base-only.
   */
  activeScene?: Scene | null;
  /**
   * Quest story-progression actions (unlockEpisode /
   * advanceToNextScene) forward here; the host owns
   * campaign.progression and the world reload that a Scene change
   * implies.
   */
  onSceneAction?: (action: {
    type: "unlockEpisode" | "advanceToNextScene";
    episodeId?: string | null;
    sceneId: string | null;
  }) => void;
  /**
   * Walk the player into another region, landing on one of its markers.
   *
   * Separate from `onSceneAction` on purpose: that one is story
   * progression -- the story moves on and the Scene changes. This is a
   * doorway. The story does not change; the player is just somewhere else.
   * The host owns it either way, because standing a region up is its job.
   */
  onRegionChange?: (input: {
    regionId: string;
    markerId: string | null;
  }) => void;
  /**
   * Plays one of an NPC's bound animation slots as a one-shot, on every
   * presence of that NPC. The mixer lives in the host, so the quest action
   * handler forwards here rather than reaching for it.
   */
  onPlayNpcAnimation?: (request: {
    npcDefinitionId: string;
    slot: NPCAnimationSlot;
    repeatCount: number;
  }) => void;
  /**
   * Plan 059 §059.1 — the background-music sound cue to start at
   * assembly boot, already resolved by the host (Scene
   * `audioOverride.backgroundMusicId` ?? project
   * `musicBindings.defaultBackgroundMusicId`). Null = silence.
   */
  backgroundMusicCueId?: string | null;
  playerDefinition: PlayerDefinition;
  /** The project's flag registry. Resolves flag references to store keys. */
  worldFlagDefinitions: WorldFlagDefinition[];
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  /**
   * Quest-set overrides of an NPC's authored interaction mode.
   * The host owns the store so it outlives the assembly and rides
   * the save; the assembly reads it and writes through
   * `onSetNpcInteractionMode`.
   */
  npcInteractionModeStore?: NpcInteractionModeStore | null;
  /**
   * Where plugins send telemetry. Host-built, because only the host knows the
   * gateway URL and the identity to authenticate with; null when there is
   * nowhere to send it, and plugins fall back to a no-op collector.
   */
  telemetry?: TelemetryCollector | null;
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  mechanics: MechanicsDefinition;
  contentLibrary?: ContentLibrarySnapshot;
  soundEventBindings?: SoundEventBindingMap;
  audioMixer?: AudioMixerSettings;
  pluginManager?: RuntimePluginManager | null;
  /** Plan 092.3 — path -> serving URL, so a plugin can fetch an artifact it
   *  shipped. Threaded to plugin init; see RuntimePluginContext.assetSources. */
  assetSources?: Record<string, string>;
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
   * Painted frame art for the framed gameplay panels: the caster frame
   * (spell menu) and the plain frame (inventory list). The host target
   * bundles the images and injects the URLs; absent, the panels render
   * their plain CSS fallback.
   */
  frameArt?: import("../framed-panel").FramedPanelArtSet;
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
  /**
   * The runtime context a conversation with this NPC would get right now; null
   * for no NPC. See the builder's own comment -- anything pre-computing a value
   * a later turn reads must go through this rather than rebuild it.
   */
  buildConversationRuntimeContext: (
    npcDefinitionId: string | null
  ) => ConversationRuntimeContext;
  readonly dialogueManager: DialogueManager;
  readonly questManager: QuestManager;
  /** The project's world flags. Quests are one caller of six. */
  readonly worldFlagManager: WorldFlagManager;
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
    /** Metres per second, for picking the animation slot to play. */
    speedMetersPerSecond: number;
    /** Yaw to face, or null while the NPC has never moved. */
    headingRadians: number | null;
  }>;
  /** Plan 079.2 -- true when the presence's condition is satisfied (or the
   *  presence has no condition). False while the ECS entity is despawned. */
  isPresenceActive: (presenceId: string) => boolean;
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
  /** 081.8 -- submits the active quest_form response through the dialogue panel. */
  submitQuestFormResponse: (response: import("../conversation").ConversationQuestFormResponse) => void;
  /** 081.8 -- cancels the active quest form conversation. */
  cancelQuestForm: () => void;
  dispose: () => void;
}

export interface RuntimeGameplayAssemblyOptions extends RuntimeGameplaySessionControllerOptions {
  pluginManager?: RuntimePluginManager | null;
  /** Threaded to plugin init; see RuntimePluginContext.preNewGameStepAnswers.
   *  Opaque here -- a plugin looks up its own step id. */
  preNewGameStepAnswers?: Readonly<Record<string, string>>;
}

export interface RuntimeGameplayAssembly {
  readonly pluginManager: RuntimePluginManager | null;
  readonly gameplaySession: RuntimeGameplaySessionController;
  /**
   * Tell every plugin the world has been rebuilt for another region. Call
   * after a mid-session region change; `init` is guarded against running
   * twice, so this is the only way a plugin hears about it.
   */
  notifyPluginsOfRegion: () => Promise<void>;
  /**
   * Settles when every plugin's `init` has run.
   *
   * Boot does not wait on this -- a plugin that is slow to initialize must not
   * hold up the first frame. But anything that reads state a plugin sets up in
   * `init` has to await it, or it reads whatever was there before. That is not
   * a race you can see in a diff: `init` is kicked off without awaiting, so a
   * later synchronous read appears to be "after" it and is only actually after
   * it when that plugin happens to be first in the project's list.
   */
  readonly pluginsInitialized: Promise<void>;
  /**
   * Free what this assembly built, and only that. The plugin manager is
   * the caller's and spans the whole page, so it is not touched here.
   * Synchronous, so a region teardown finishes before the rebuild starts.
   */
  dispose: () => void;
}

/** Plan 069.3 — sentinel agent id for the player in NPC collision (can't
 *  clash with an NPC presenceId). */
const PLAYER_COLLISION_AGENT_ID = "__player__";
const DEFAULT_AGENT_RADIUS = 0.35;

const DIALOGUE_LOCK_ID = "runtime-dialogue";
/**
 * The framing a conversation asks for. A NAME, not a camera: see
 * packages/runtime-core/src/camera/moves.ts for what it resolves to.
 */
const DIALOGUE_CAMERA_MOVE = "dialogue-focus";
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
  regionId: string | null;
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
      description: objective.description,
      objectiveSubtype: objective.objectiveSubtype,
      targetId: objective.targetId
    }))
  };
}

export function createConversationSelectionFromNpc(options: {
  npcDefinition: NPCDefinition;
  dialogueDefinitionId?: string | null;
  trackedQuest?: QuestTrackerView | null;
  metadata?: Record<string, unknown>;
  /** A quest-set override of the NPC's authored mode, or null. */
  interactionModeOverride?: NPCInteractionMode | null;
  /** The page for the character the player is playing, from PlayerDefinition. */
  playerLorePageId?: string | null;
}): ConversationSelectionContext | null {
  const {
    npcDefinition,
    dialogueDefinitionId = null,
    trackedQuest = null,
    metadata,
    interactionModeOverride = null,
    playerLorePageId = null
  } = options;
  const selectionMetadata = cloneSelectionMetadata({
    selectionMetadata: metadata,
    npcMetadata: npcDefinition.metadata
  });
  // The EFFECTIVE mode, not the authored one -- a quest may have
  // flipped this NPC. Everything downstream routes on the derived
  // `conversationKind`, so resolving here is what makes the flip
  // reach sugaragent and the teacher middleware.
  const { mode: interactionMode } = resolveEffectiveInteractionMode(
    npcDefinition.interactionMode,
    interactionModeOverride
  );

  if (interactionMode === "scripted") {
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
    interactionMode,
    lorePageId: npcDefinition.lorePageId,
    playerLorePageId,
    recoveryStrategies: npcDefinition.recoveryStrategies,
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
    worldFlagDefinitions,
    spellDefinitions,
    itemDefinitions,
    documentDefinitions,
    npcDefinitions,
    npcInteractionModeStore = null,
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
  // 090.12: first plugin that can answer a lookup wins. Plugins that do not
  // supply one are simply skipped, so the gesture stays inert rather than
  // erroring when no language plugin is loaded.
  const lookupHandlers = decoratorContributions
    .map((c) => c.payload.lookupSelection)
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
        : undefined,
    onSelectionLookup:
      lookupHandlers.length > 0
        ? (selection) => {
            for (const handler of lookupHandlers) {
              const result = handler(selection);
              if (result) return result;
            }
            return null;
          }
        : undefined
  });
  const questJournal = createRuntimeQuestJournal(root, {
    actionRegistry: options.actionRegistry
  });
  const questNotificationCenter = createRuntimeQuestNotificationCenter(root);
  const casterManager = new CasterManager();
  const casterSystem = new CasterSystem(casterManager);
  const spellMenuUi = createRuntimeSpellMenuUI(root, casterManager, {
    actionRegistry: options.actionRegistry,
    frameArt: options.frameArt?.caster,
    // A spell's icon points at a content-library asset definition. Only
    // image assets can render in the slot; anything else (a model, no
    // icon at all) falls back to the slot's initial-letter glyph.
    getSpellIconUrl: (spell) => {
      if (!spell.iconAssetDefinitionId) return undefined;
      const asset = contentLibrary?.assetDefinitions.find(
        (definition) => definition.definitionId === spell.iconAssetDefinitionId
      );
      if (!asset?.source.mimeType?.startsWith("image/")) return undefined;
      return options.getAssetUrl?.(asset.source.relativeAssetPath);
    }
  });
  const inventoryManager = new InventoryManager();
  const inventoryUi = createRuntimeInventoryUI(root, {
    getAssetUrl: options.getAssetUrl,
    actionRegistry: options.actionRegistry,
    frameArt: options.frameArt?.plain
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
  const worldFlagManager = new WorldFlagManager();
  const questManager = new QuestManager();
  questManager.setWorldFlagManager(worldFlagManager);
  /**
   * The contribution whose form is on screen. Held so the submit goes back to
   * the plugin that produced it rather than being broadcast to all of them.
   */
  let activeAssessment:
    | Extract<RuntimePluginContribution, { kind: "quest.assessment" }>
    | null = null;
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
  // Wired here rather than beside the name resolver below, so that a flag
  // written before the session finishes assembling still reaches the
  // blackboard.
  worldFlagManager.setWriteObserver(
    createWorldFlagProjection({ blackboard, definitions: worldFlagDefinitions })
  );
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
  /**
   * A volume runs its own actions when the player crosses in and back out,
   * from the same list a quest node runs. An ambient bed is a `playCue` on
   * enter paired with a `stopCue` on exit; both resolve to one instance
   * because the key names the volume.
   */
  function runVolumeActions(
    volume: RegionVolumeDefinition,
    kind: "enter" | "exit"
  ) {
    const actions =
      kind === "enter" ? volume.onEnterActions : volume.onExitActions;
    if (actions.length === 0) return;
    const source = {
      kind: "volume" as const,
      regionId: activeRegion?.identity.id ?? "region",
      volumeId: volume.volumeId
    };
    for (const action of actions) {
      runQuestAction(action, source);
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
        onVolumeCrossing({ volume, kind }) {
          runVolumeActions(volume, kind);
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
        claimInput: (lockId) => inputManager.addWorldInputLock(lockId),
        releaseInput: (lockId) => inputManager.removeWorldInputLock(lockId)
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
      npcPositions: (regionContents?.npcPresences ?? [])
        .filter((presence) => npcInteractableEntities.has(presence.presenceId))
        .map((presence) => {
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
        description: objective.description,
        objectiveSubtype: objective.objectiveSubtype,
        targetId: objective.targetId
      }))
    });
    lastTrackedQuestDefinitionId = trackedQuest.questDefinitionId;
  }

  /**
   * ASSESSMENT OBJECTIVES OPEN A FORM, NOT A CONVERSATION.
   *
   * The quest graph says an objective is an assessment and which NPC it
   * targets. This layer knows nothing about placement, questionnaires or CEFR
   * bands -- it asks whoever owns assessments for a form and hands the answers
   * back.
   *
   * Returns false when there is nothing to show, so the caller falls through to
   * an ordinary conversation. An NPC hosting an assessment keeps their authored
   * dialogue for every other node in the quest.
   */
  function tryOpenAssessmentForm(npcDefinitionId: string): boolean {
    const contributions =
      pluginManager?.getContributions("quest.assessment") ?? [];
    if (contributions.length === 0) return false;

    const objective = questManager
      .getActiveObjectivesForTrackedQuest()
      .find(
        (candidate) =>
          candidate.objectiveSubtype === "assessment" &&
          candidate.targetId === npcDefinitionId
      );
    if (!objective) return false;

    for (const contribution of contributions) {
      const form = contribution.payload.getForm({
        objectiveNodeId: objective.nodeId,
        targetId: objective.targetId ?? null
      });
      if (!form) continue;
      activeAssessment = contribution;
      options.uiStateStore?.setState({
        questFormOpen: true,
        questFormDefinition: form
      });
      return true;
    }
    // An assessment objective with no plugin willing to supply a form is a
    // dead node: the player would walk up and nothing would happen. Say so.
    console.warn(
      "[gameplay-session] assessment objective has no form provider; falling back to conversation.",
      { objectiveNodeId: objective.nodeId, targetId: objective.targetId }
    );
    return false;
  }

  /**
   * Builds the runtime half of a conversation's context: where things are, what
   * the quest is doing, what time it is, what the player knows.
   *
   * EXTRACTED FROM THE MIDDLEWARE, AND THE EXTRACTION IS LOAD-BEARING
   * (sugarmagic-latency-00m). The Teacher's situation key is built from quest
   * stage, objectives and time of day, all of which live here. Anything that
   * wants to pre-compute a directive -- a warm-up before a conversation exists
   * -- must produce a key IDENTICAL to the one the real turn will produce, and
   * two separate constructions would drift until the keys silently stopped
   * matching. So there is one builder, parameterized by NPC rather than split
   * in half: pass null for a caller that has no conversation yet.
   */
  function buildConversationRuntimeContext(
    npcDefinitionId: string | null
  ): ConversationRuntimeContext {
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
      const npcLocation = npcDefinitionId
        ? getEntityLocation(blackboard, npcDefinitionId)
        : null;
      const npcPosition = npcDefinitionId
        ? getEntityPosition(blackboard, npcDefinitionId)
        : null;
      const npcArea = npcDefinitionId
        ? getEntityCurrentArea(blackboard, npcDefinitionId)
        : null;
      const npcPlayerRelation = npcDefinitionId
        ? getEntityPlayerSpatialRelation(
            blackboard,
            npcDefinitionId
          )
        : null;
      const npcMovement = npcDefinitionId
        ? getEntityMovement(blackboard, npcDefinitionId)
        : null;
      const npcCurrentTask = npcDefinitionId
        ? (npcBehaviorSystem?.getCurrentTask(
            npcDefinitionId
          ) ?? null)
        : null;
      const npcCurrentActivity = npcDefinitionId
        ? getEntityCurrentActivity(
            blackboard,
            npcDefinitionId
          )
        : null;
      const npcCurrentGoal = npcDefinitionId
        ? getEntityCurrentGoal(blackboard, npcDefinitionId)
        : null;
      const npcBehavior = npcDefinitionId
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

    return {
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
  }

  const runtimeBlackboardConversationMiddleware: ConversationMiddleware = {
    middlewareId: "runtime.blackboard-context",
    displayName: "Runtime Blackboard Context",
    priority: -100,
    stage: "context",
    prepare(context) {
      return {
        ...context,
        runtimeContext: buildConversationRuntimeContext(
          context.selection.npcDefinitionId ?? null
        )
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
    // The always-on corner quest panel was removed: quest-start / stage-advance /
    // objective-complete already surface as toasts (QuestNotification), and the
    // persistent tracker is planned as a bottom-bar HUD element (a UINode in
    // HUDDefinition, alongside inventory/caster/home) rather than this
    // hardcoded imperative widget. The journal remains the full quest view.
    questJournal.update(questManager.getJournalData());
  }

  /** The quest-set override for this NPC, or null. */
  function getNpcInteractionModeOverride(
    npcDefinitionId: string
  ): NPCInteractionMode | null {
    return npcInteractionModeStore?.get(npcDefinitionId) ?? null;
  }

  /**
   * An NPC's mode AS IT STANDS -- the authored definition unless a
   * quest has overridden it. Every branch on scripted-vs-agent in
   * this file goes through here; reading
   * `npcDefinition.interactionMode` directly would ignore the
   * override and give a second answer.
   */
  function effectiveInteractionModeOf(
    npcDefinition: NPCDefinition
  ): NPCInteractionMode {
    return resolveEffectiveInteractionMode(
      npcDefinition.interactionMode,
      getNpcInteractionModeOverride(npcDefinition.definitionId)
    ).mode;
  }

  // Single enforcer for NPC interactable availability, used both at
  // interactable creation and on every sync. Missing definition falls to
  // the scripted/coordinator path.
  function resolveNpcInteractableAvailability(npcDefinitionId: string): boolean {
    const npcDefinition = npcDefinitions.find(
      (candidate) => candidate.definitionId === npcDefinitionId
    );
    if (
      !npcDefinition ||
      effectiveInteractionModeOf(npcDefinition) === "scripted"
    ) {
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

    if (effectiveInteractionModeOf(npcDefinition) === "scripted") {
      const dialogueDefinitionId =
        questDialogueCoordinator.resolveNpcDialogueDefinitionId(
          npcDefinitionId
        );
      if (!dialogueDefinitionId) {
        logConversationDebug(
          "conversation-selection-scripted-missing-dialogue",
          {
            npcDefinitionId,
            interactionMode: effectiveInteractionModeOf(npcDefinition)
          }
        );
        return null;
      }
      const selection = createConversationSelectionFromNpc({
        npcDefinition,
        interactionModeOverride: getNpcInteractionModeOverride(npcDefinitionId),
        dialogueDefinitionId,
        playerLorePageId: playerDefinition.lorePageId
      });
      if (!selection) {
        return null;
      }
      logConversationDebug("conversation-selection-resolved", {
        npcDefinitionId,
        npcDisplayName: npcDefinition.displayName,
        interactionMode: effectiveInteractionModeOf(npcDefinition),
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
      interactionModeOverride: getNpcInteractionModeOverride(npcDefinitionId),
      dialogueDefinitionId,
      trackedQuest,
      playerLorePageId: playerDefinition.lorePageId
    });
    if (!selection) {
      return null;
    }
    logConversationDebug("conversation-selection-resolved", {
      npcDefinitionId,
      npcDisplayName: npcDefinition.displayName,
      interactionMode: effectiveInteractionModeOf(npcDefinition),
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
        worldFlagManager.setFlag(proposal.key, proposal.value);
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

  function spawnNpcInteractable(presence: RegionNPCPresence) {
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
    if (debugBillboardsInitialized) {
      debugBillboardBindings.set(interactableEntity, {
        entity: interactableEntity,
        entityKind: "npc",
        definitionId: presence.npcDefinitionId,
        displayName: npcDefinition?.displayName ?? "NPC",
        regionId: activeRegion?.identity.id ?? null
      });
      createBillboard({
        entity: interactableEntity,
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
      applyDebugBillboardEnabledState();
    }
  }

  function despawnNpcInteractable(presenceId: string) {
    const entry = npcInteractableEntities.get(presenceId);
    if (!entry) return;
    world.destroyEntity(entry.entity);
    npcInteractableEntities.delete(presenceId);
    debugBillboardBindings.delete(entry.entity);
  }

  /**
   * The four quest progress questions a story point can ask. One builder so
   * every gate -- NPC placements, containment volumes, behavior tasks --
   * answers them the same way.
   */
  function buildQuestProgressReader(): QuestProgressReader {
    return {
      isNodeCompleted: (questDefinitionId: string, nodeId: string) =>
        questManager.isNodeCompleted(questDefinitionId, nodeId),
      isNodeActive: (questDefinitionId: string, nodeId: string) =>
        questManager.isNodeActive(questDefinitionId, nodeId),
      isQuestCompleted: (questDefinitionId: string) =>
        questManager.isQuestCompleted(questDefinitionId),
      isStageCompleted: (questDefinitionId: string, stageId: string) =>
        questManager.isStageCompleted(questDefinitionId, stageId)
    };
  }

  function buildPresenceQuestContext(): RegionConditionContext {
    return {
      activeQuests: questManager.getActiveQuestStates(),
      hasWorldFlag: (worldFlagId: string, value?: unknown) =>
        worldFlagManager.hasFlagById(worldFlagId, value),
      ...buildQuestProgressReader()
    };
  }

  function reconcileNpcPresences() {
    if (!regionContents) return;
    const ctx = buildPresenceQuestContext();
    for (const presence of regionContents.npcPresences) {
      const active = presence.condition === null
        || evaluateRegionQuestBinding(presence.condition, ctx);
      const spawned = npcInteractableEntities.has(presence.presenceId);
      if (active && !spawned) {
        spawnNpcInteractable(presence);
      } else if (!active && spawned) {
        despawnNpcInteractable(presence.presenceId);
      }
    }
  }

  function registerNpcInteractables() {
    if (!regionContents) return;
    // Plan 079.2 -- filter by condition at initial load; reconcileNpcPresences
    // then keeps the set live each frame.
    const ctx = buildPresenceQuestContext();
    for (const presence of regionContents.npcPresences) {
      if (presence.condition === null || evaluateRegionQuestBinding(presence.condition, ctx)) {
        spawnNpcInteractable(presence);
      }
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
    // DEFERRED (079): upgrade this to a per-frame dynamic reconciler (same as
    // reconcileNpcPresences) so items can appear/disappear mid-region on a
    // condition change. Today this is load-time only; items authored with a
    // condition field would need the reconciler treatment. Revisit trigger:
    // when an authored item presence needs a quest/flag condition gate
    // (parallel to NPC presence gating, Plan 079).
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
      regionId: binding.regionId,
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
        regionId: activeRegion?.identity.id ?? null
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
        regionId: activeRegion?.identity.id ?? null
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
    inputManager.addWorldInputLock(DIALOGUE_LOCK_ID);
    // Framing the conversation belongs HERE rather than in sugarlang: this seam
    // already brackets "a conversation is happening" and already owns the input
    // lock, and putting it here means SCRIPTED dialogue is framed too, not only
    // agent conversations. A plugin can still ask for a different named move.
    options.cameraMoves?.request(DIALOGUE_CAMERA_MOVE);
    inputManager.consumeInteract();
    syncInteractionPrompt();
  });
  dialogueManager.setOnNodeEnter((nodeId) => {
    questDialogueCoordinator.handleDialogueNodeEnter(nodeId);
  });
  dialogueManager.setOnEnd((dialogueDefinitionId, reason) => {
    inputManager.removeWorldInputLock(DIALOGUE_LOCK_ID);
    // Released, not awaited: control comes back NOW and the camera catches up
    // on its own. Gating input on an animation is what makes a return feel
    // like lag rather than like grace.
    options.cameraMoves?.release(DIALOGUE_CAMERA_MOVE);
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
  questDialogueCoordinator.attach(dialogueManager, questManager, worldFlagManager, {
    hasItem: (itemDefinitionId, count) =>
      inventoryManager.hasItem(itemDefinitionId, count),
    hasSpell: (spellDefinitionId) => casterManager.hasSpell(spellDefinitionId),
    canCastSpell: (spellDefinitionId) =>
      casterManager.canCastSpell(spellDefinitionId).canCast
  });

  questManager.registerDefinitions(questDefinitions);
  worldFlagManager.setWorldFlagNameResolver(
    createWorldFlagNameResolver(worldFlagDefinitions)
  );
  // A flag written from outside the quest system still has to re-evaluate
  // quest conditions -- a spell effect or an agent proposal can satisfy one.
  worldFlagManager.setChangeHandler(() => questManager.update());
  questManager.setInventoryCountProvider((itemDefinitionId) =>
    inventoryManager.getQuantity(itemDefinitionId)
  );
  questManager.setHasSpellProvider((spellDefinitionId) =>
    casterManager.hasSpell(spellDefinitionId)
  );
  questManager.setCanCastSpellProvider(
    (spellDefinitionId) => casterManager.canCastSpell(spellDefinitionId).canCast
  );
  // A location objective completes on the target area or anything nested
  // inside it, so standing in the Fruit Stall satisfies an objective on the
  // Market that contains it, however deep the nesting goes.
  questManager.setPlayerAreaProvider((areaId) => {
    if (!activeRegion) {
      return false;
    }
    const playerArea = getEntityCurrentArea(
      blackboard,
      playerDefinition.definitionId
    );
    const currentAreaId = playerArea?.area?.areaId ?? null;
    if (!currentAreaId) {
      return false;
    }
    return (
      currentAreaId === areaId ||
      isRegionAreaDescendant(activeRegion, currentAreaId, areaId)
    );
  });
  // Only ever called for a dialogue narrative that has a dialogue attached --
  // activateNode guards on exactly that before calling out.
  questManager.setNarrativeHandler((node) => {
    if (node.dialogueDefinitionId) {
      void dialogueManager.start(node.dialogueDefinitionId);
    }
  });
  questManager.setStageTimeOfDayHandler((band) => worldTimeStore.setTimeBand(band));
  // [LAW:single-enforcer] One runner for every action, whatever ran it.
  // A volume with its own copy would drift from the quest one the first
  // time an action is added.
  function runQuestAction(action: QuestActionDefinition, source: QuestActionSource) {
    switch (action.type) {
      case "giveItem":
        if (action.itemDefinitionId) {
          inventoryManager.addItem(action.itemDefinitionId, action.count);
        }
        return;

      case "removeItem":
        if (action.itemDefinitionId) {
          inventoryManager.removeItem(action.itemDefinitionId, action.count);
        }
        return;

      // The instance key names the source, so two nodes playing the same cue
      // are separate instances -- a cue set to restart or ignore-while-playing
      // applies per source, not across the quest.
      case "playCue":
        audioController.playCue({
          cueDefinitionId: action.cueDefinitionId,
          instanceKey: questActionInstanceKey(source, action.cueDefinitionId),
          source: describeQuestActionSource(source)
        });
        return;

      case "stopCue":
        audioController.stopInstance(
          questActionInstanceKey(source, action.cueDefinitionId)
        );
        return;

      case "setNpcInteractionMode": {
        if (!action.npcDefinitionId || !npcInteractionModeStore) return;
        // A no-op flip must not invalidate the Teacher warm, so the
        // store reports whether anything actually changed.
        const changed = npcInteractionModeStore.set(
          action.npcDefinitionId,
          action.mode
        );
        if (!changed) return;
        // The NPC may have just become interactable, or stopped being
        // so: availability is resolved per sync from the effective
        // mode, and this makes the change visible without waiting for
        // the player to walk away and back.
        syncNpcInteractionAvailability();
        return;
      }

      // Story progression actions belong to the host
      // (campaign.progression lives there), not the assembly.
      case "unlockEpisode":
        options.onSceneAction?.({
          type: action.type,
          episodeId: action.episodeId,
          sceneId: null
        });
        return;
      case "advanceToNextScene":
        options.onSceneAction?.({
          type: action.type,
          sceneId: action.sceneId
        });
        return;

      case "playAnimation":
        if (action.npcDefinitionId && action.slot) {
          options.onPlayNpcAnimation?.({
            npcDefinitionId: action.npcDefinitionId,
            slot: action.slot,
            repeatCount: action.repeatCount
          });
        }
        return;

      case "set-time-of-day":
        worldTimeStore.setTimeBand(action.band);
        return;

      case "advance-day":
        worldTimeStore.advanceDay();
        return;

      case "learn-fact":
        if (action.factId && action.displayText) {
          playerKnownFactsStore.learnFact(action.factId, action.displayText);
        }
        return;

      // QuestManager handles these before the handler is called.
      case "setFlag":
      case "emitEvent":
        return;

      // Standing a region up is the host's job, so this forwards rather
      // than acting. A link with no region picked is authored breakage,
      // reported rather than silently doing nothing.
      case "goToRegion":
        if (!action.regionId) {
          console.warn(
            "[runtime-core] a Go to Region action names no region.",
            describeQuestActionSource(source)
          );
          return;
        }
        options.onRegionChange?.({
          regionId: action.regionId,
          markerId: action.markerId
        });
        return;

      default: {
        const exhaustive: never = action;
        console.warn(
          "[runtime-core] unhandled quest action",
          exhaustive,
          describeQuestActionSource(source)
        );
      }
    }
  }

  questManager.setActionHandler(({ action, source }) => {
    runQuestAction(action, source);
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
      inputManager.addWorldInputLock(JOURNAL_LOCK_ID);
    } else {
      inputManager.removeWorldInputLock(JOURNAL_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  questJournal.setOnTrackedQuestChange((questDefinitionId) => {
    questManager.setTrackedQuest(questDefinitionId);
  });
  spellMenuUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addWorldInputLock(SPELL_MENU_LOCK_ID);
    } else {
      inputManager.removeWorldInputLock(SPELL_MENU_LOCK_ID);
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
      inputManager.addWorldInputLock(INVENTORY_LOCK_ID);
    } else {
      inputManager.removeWorldInputLock(INVENTORY_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  /**
   * Resolve the item's display text through any registered display-text
   * resolver, then show the view.
   *
   * The resolution has to happen HERE rather than inside the item view because
   * the view renders synchronously and resolvers are async (sugarlang's reads
   * IndexedDB). With no resolver registered -- plugin disabled, uninstalled, or
   * simply not shipped -- `resolveDisplayText` returns undefined, no override is
   * passed, and the authored English renders. That is the whole
   * graceful-degradation story, and it needs no branch of its own.
   *
   * A resolver that throws must not take the item view down with it: an item
   * you cannot open is a far worse failure than one showing untranslated text.
   */
  /**
   * Which inspect request is current. Bumped on every open and on close, so a
   * resolution that settles late can tell it has been superseded.
   *
   * Resolution is genuinely slow the first time -- opening IndexedDB, and on a
   * cold session building the whole sugarlang service graph -- so "the player
   * moved on while we were resolving" is an ordinary case, not a rare race.
   * Without this, inspecting A then B shows whichever RESOLVED last rather than
   * whichever was CLICKED last, and closing mid-resolve pops the panel back
   * open with a movement lock the player never asked for.
   */
  let itemViewRequestToken = 0;

  async function showItemViewWithResolvedText(
    definition: ItemDefinition,
    quantity: number
  ): Promise<void> {
    const token = ++itemViewRequestToken;
    const resolvers =
      pluginManager?.getContributions("displayText.resolver") ?? [];
    if (resolvers.length === 0) {
      itemViewUi.show(definition, quantity);
      return;
    }

    const resolveField = async (
      field: "title" | "body",
      authored: string
    ): Promise<string | undefined> => {
      if (!authored.trim()) return undefined;
      for (const contribution of resolvers) {
        try {
          const resolved = await contribution.payload.resolve({
            subjectKind: "item-view",
            subjectId: definition.definitionId,
            field,
            text: authored
          });
          if (resolved && resolved !== authored) return resolved;
        } catch {
          // Fall through to the authored text.
        }
      }
      return undefined;
    };

    const [title, body] = await Promise.all([
      resolveField("title", definition.interactionView.title),
      resolveField("body", definition.interactionView.body)
    ]);

    // Superseded by a later inspect, or the view was closed while we resolved.
    if (token !== itemViewRequestToken) return;

    itemViewUi.show(
      definition,
      quantity,
      title === undefined && body === undefined ? undefined : { title, body }
    );
  }

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

    void showItemViewWithResolvedText(
      definition,
      inventoryManager.getQuantity(itemDefinitionId)
    );
  });
  itemViewUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addWorldInputLock(ITEM_VIEW_LOCK_ID);
    } else {
      inputManager.removeWorldInputLock(ITEM_VIEW_LOCK_ID);
      // Closing supersedes any resolution still in flight, so it cannot pop the
      // panel back open (and re-take the movement lock) after the player
      // dismissed it.
      itemViewRequestToken += 1;
    }
    syncInteractionPrompt();
  });
  documentReaderUi.setOnOpenChange((isOpen) => {
    if (isOpen) {
      inputManager.addWorldInputLock(DOCUMENT_READER_LOCK_ID);
    } else {
      inputManager.removeWorldInputLock(DOCUMENT_READER_LOCK_ID);
    }
    syncInteractionPrompt();
  });
  itemViewUi.setOnConsume((itemDefinitionId) => {
    if (!inventoryManager.removeItem(itemDefinitionId, 1)) return;
    const definition = inventoryManager.getDefinition(itemDefinitionId);
    if (!definition) return;

    const remaining = inventoryManager.getQuantity(itemDefinitionId);
    if (remaining > 0) {
      // Through the SAME entry point, or the re-render drops the resolved text:
      // `show`'s third argument is assigned unconditionally, so the two-arg
      // form clears it. Consumables are a gradable kind, so the plain call made
      // a graded stack flip back to English the moment the player used one.
      void showItemViewWithResolvedText(definition, remaining);
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
      // An assessment objective for this NPC opens its form instead of a
      // conversation -- the node says "run the assessment", not "talk".
      if (selection.npcDefinitionId && tryOpenAssessmentForm(selection.npcDefinitionId)) {
        return;
      }
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
        // `targetId` on a world-flag effect is a flag reference, and the value
        // box beside it is free text, authored the same way a quest setFlag
        // action's is -- so it coerces the same way. Without this the spell
        // writes the string "true" while a condition on the same flag reads
        // boolean true, and the gate never opens.
        worldFlagManager.setFlagById(
          effect.targetId,
          coerceAuthoredWorldFlagValue(effect.value ?? true)
        );
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
      hasWorldFlag: (worldFlagId, value) => worldFlagManager.hasFlagById(worldFlagId, value),
      questProgress: buildQuestProgressReader(),
      // Plan 069.9 — NPCs follow the baked navmesh (host loads it async).
      // DEFERRED (079): if an NPC that was pathfinding toward a conditional
      // containment gate becomes absent (condition clears), its in-flight
      // navmesh path stays queued until reconcileNpcPresences despawns the
      // entity. The behavior system's internal-Map cleanup handles the
      // bookkeeping on next sync. Revisit trigger: authored content with an
      // NPC whose presence gate and a nearby containment gate can be set/
      // cleared in rapid succession causing visually odd path-into-gate behavior.
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
    worldFlagManager,
    /**
     * The runtime context a conversation with this NPC would get right now
     * (null for no NPC).
     *
     * Exposed so a plugin can pre-compute something a real turn will later
     * read -- the Teacher warm-up (sugarmagic-latency-00m) has to produce a
     * situation key IDENTICAL to the turn's, and the only way to guarantee
     * that is to call the same builder rather than reconstruct it.
     */
    buildConversationRuntimeContext,
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
      // Which NPCs are where and which doors are passable follow EVERY quest
      // in progress, not the one the player has selected in their journal.
      const activeQuests = questManager.getActiveQuestStates();
      // Plan 069.5 — re-evaluate conditional containment gates against the
      // current quest/flag state BEFORE any move resolves this frame (NPC
      // sync here; the player CollisionSystem reads the same world next tick).
      if (sharedCollisionWorld.gates.length > 0) {
        applyVolumeColliderGates(sharedCollisionWorld, {
          activeQuests,
          hasWorldFlag: (worldFlagId, value) => worldFlagManager.hasFlagById(worldFlagId, value),
          ...buildQuestProgressReader()
        });
      }
      // Plan 079.2 -- reconcile conditional NPC presences each frame.
      reconcileNpcPresences();
      npcBehaviorSystem?.sync({ deltaSeconds, activeQuests });
      // Spatial facts are written every frame because they change every frame.
      // Quest facts are not: `questManager.setStateChangeHandler` runs
      // `syncBlackboardQuestFacts` whenever quest state actually moves, so
      // writing them here as well would rebuild the same values every frame.
      syncBlackboardSpatialFacts();
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
          // Null for an NPC the behavior system has not ticked yet, and for
          // every NPC in a region with no behaviors at all. Standing still is
          // the right answer in both cases.
          const motion = npcBehaviorSystem?.getMotion(entry.npcDefinitionId) ?? null;
          return [
            {
              presenceId,
              npcDefinitionId: entry.npcDefinitionId,
              position: [position.x, position.y, position.z] as [
                number,
                number,
                number
              ],
              speedMetersPerSecond: motion?.speedMetersPerSecond ?? 0,
              headingRadians: motion?.headingRadians ?? null
            }
          ];
        }
      );
    },
    isPresenceActive(presenceId: string): boolean {
      return npcInteractableEntities.has(presenceId);
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
    submitQuestFormResponse(response) {
      // A quest form only ever comes from an ASSESSMENT OBJECTIVE, so the
      // answers go back to the plugin that supplied it. There is no
      // conversation route: a form never travels on a turn.
      if (!activeAssessment) {
        console.warn(
          "[gameplay-session] quest form submitted with no assessment open; ignoring."
        );
        return;
      }
      {
        const contribution = activeAssessment;
        activeAssessment = null;
        options.uiStateStore?.setState({
          questFormOpen: false,
          questFormDefinition: null
        });
        void Promise.resolve(contribution.payload.submit(response))
          .then((proposals) => {
            // Same applier the conversation path uses -- one place decides what
            // a quest action means.
            for (const proposal of proposals ?? []) {
              handleConversationActionProposal(proposal);
            }
          })
          .catch((error: unknown) => {
            console.warn("[gameplay-session] assessment submit failed.", error);
          });
      }
    },
    cancelQuestForm() {
      activeAssessment = null;
      options.uiStateStore?.setState({
        questFormOpen: false,
        questFormDefinition: null
      });
    },
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

  let pluginsInitialized: Promise<void> = Promise.resolve();
  // Built once and kept, so the same context that initialized the plugins is
  // the one handed back to them when the region changes. Two constructions
  // would drift the moment either grew a field.
  let pluginContext: Parameters<
    NonNullable<typeof pluginManager>["init"]
  >[0] | null = null;
  if (pluginManager) {
    pluginContext = {
      blackboard: gameplaySession.blackboard,
      assetSources: options.assetSources,
      preNewGameStepAnswers: options.preNewGameStepAnswers ?? {},
      activeRegion: options.activeRegion,
      activeScene: options.activeScene ?? null,
      playerDefinition: options.playerDefinition,
      spellDefinitions: options.spellDefinitions,
      itemDefinitions: options.itemDefinitions,
      documentDefinitions: options.documentDefinitions,
      npcDefinitions: options.npcDefinitions,
      // The EFFECTIVE mode, so a plugin that branches on
      // scripted-vs-agent sees a quest's flip rather than only what
      // the project shipped with.
      getEffectiveNpcInteractionMode: (npcDefinitionId) => {
        const npcDefinition = options.npcDefinitions.find(
          (candidate) => candidate.definitionId === npcDefinitionId
        );
        if (!npcDefinition) return null;
        return resolveEffectiveInteractionMode(
          npcDefinition.interactionMode,
          options.npcInteractionModeStore?.get(npcDefinitionId) ?? null
        ).mode;
      },
      onNpcInteractionModeChange: (listener) =>
        options.npcInteractionModeStore?.subscribe(listener) ?? (() => {}),
      // Host-built, so the plugin emits events and nothing else. Omitted
      // rather than passed as null when there is nowhere to send them.
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      dialogueDefinitions: options.dialogueDefinitions,
      questDefinitions: options.questDefinitions,
      buildConversationRuntimeContext:
        gameplaySession.buildConversationRuntimeContext
    };
    pluginsInitialized = pluginManager.init(pluginContext);
    options.world.addSystem(new RuntimePluginSystem(pluginManager));
  }

  return {
    pluginManager,
    gameplaySession,
    pluginsInitialized,
    /**
     * Tell every plugin the world it is looking at has been rebuilt for
     * another region. `init` is guarded against running twice, so a plugin
     * that snapshotted the region at boot has no other way to hear about
     * it.
     */
    async notifyPluginsOfRegion(): Promise<void> {
      if (!pluginManager || !pluginContext) return;
      await pluginManager.notifyRegionChanged(pluginContext);
    },
    /**
     * Free what this assembly built. The plugin manager is NOT disposed:
     * it arrives through `options`, so the caller owns it and outlives any
     * one region. Disposing it here ran on every region change, and a
     * plugin whose `disposed` flag is one-way -- sugarlang's conversation
     * warmer -- never came back for the rest of the session.
     */
    dispose() {
      gameplaySession.dispose();
    }
  };
}
