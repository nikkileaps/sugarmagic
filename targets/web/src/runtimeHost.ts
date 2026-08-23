/**
 * Web runtime host for Sugarmagic.
 *
 * Keep this file limited to host/platform responsibilities:
 * - WebGPU renderer and canvas lifecycle
 * - resize handling
 * - DOM mounting/unmounting
 * - window/input attachment
 * - bootstrapping the shared runtime
 * - wiring shipped runtime UI roots into the page
 *
 * Do NOT put game mechanic rules here.
 * If the logic would still be required for a different target
 * (for example Tauri desktop or mobile) in order to play the game,
 * it belongs in `packages/runtime-core`, not here.
 *
 * Examples of logic that must stay out of this host:
 * - which NPC can currently talk
 * - whether quest dialogue overrides default dialogue
 * - whether a quest-completed NPC should stop prompting
 * - quest start/progression policy
 * - dialogue completion feeding quest state
 *
 * Host rule of thumb:
 * - needed to play the game on every target -> `runtime-core`
 * - only needed to translate shared runtime behavior into web-specific behavior -> target host
 */
import * as THREE from "three";
import { createElement } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { WebGPURenderer } from "three/webgpu";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  getCharacterAnimationDefinition,
  type ContentLibrarySnapshot,
  type DocumentDefinition,
  type DialogueDefinition,
  type ItemDefinition,
  type NPCAnimationSlot,
  type NPCDefinition,
  type PluginConfigurationRecord,
  type PlayerDefinition,
  type QuestDefinition,
  type WorldFlagDefinition,
  type SpellDefinition,
  type RegionDocument,
  type HUDDefinition,
  type MenuDefinition,
  type MechanicsDefinition,
  type SoundEventBindingMap,
  type AudioMixerSettings,
  type UITheme,
  composeRegionContents,
  migrateToScenes,
  resolveRegionVolumes,
  resolveActiveScene,
  resolveUnlockedSceneIds,
  type CreditsDefinition,
  type MusicBindings,
  type Scene
} from "@sugarmagic/domain";
import {
  type RuntimePluginEnvironment,
  SUGARPROFILE_PLUGIN_ID,
  createResolvedRuntimePluginManager,
  normalizeSugarProfilePluginConfig
} from "@sugarmagic/plugins";
import {
  createCapsuleFallback,
  createRenderView,
  createWebRenderEngine,
  createFallbackMesh,
  createRenderableReconciler,
  disposeRenderableObject,
  ensureShaderSetsAppliedToRenderables,
  type ReconciledEntry,
  type RenderableReconciler,
  type RenderView,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  BillboardComponent,
  type CameraSnapshot,
  World,
  MovementSystem,
  CollisionSystem,
  buildCollisionWorld,
  createEmptyCollisionWorld,
  loadNavMeshPathfinder,
  type NavMeshPathfinder,
  computePlayerAgentDimensions,
  PlayerControlled,
  Position,
  Velocity,
  iterateActiveItemPresences,
  resolveSceneObjects,
  assetObjectIsInstanceable,
  objectSurfaceHasScatter,
  DEFAULT_CAMERA_CONFIG,
  createCameraState,
  updateCameraFollow,
  applyCameraDrag,
  applyCameraZoom,
  computeCameraPosition,
  createCameraMoveDirector,
  createRuntimeInputManager,
  createRuntimeBootModel,
  createRuntimeDebugHud,
  createCasterStatsSaveParticipant,
  createInventoryPlayerSaveParticipant,
  createNpcBehaviorSaveParticipant,
  createPlaythroughIdentitySaveParticipant,
  createPlayerKnownFactsSaveParticipant,
  createQuestManagerSaveParticipant,
  createWorldFlagSaveParticipant,
  type QuestManagerSlice,
  createRuntimeGameplayAssembly,
  createWorldPresenceSaveParticipant,
  createWorldTimeSaveParticipant,
  WorldPresenceTracker,
  type RuntimeBannerContribution,
  createPlayerVisualController,
  createSessionHudCard,
  createSyncEngine,
  registerActiveGameId,
  registerActiveIdentityProvider,
  resolveActiveRemoteRecordStorageAdapter,
  type SyncEngine,
  resolveActiveGameSaveStore,
  resolveActiveIdentityProvider,
  upgradeLegacyPayload,
  type SessionHudSavedGameSnapshot,
  spawnRuntimePlayerEntity,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  SaveParticipantRegistry,
  type SerializedSaveStore,
  type User,
  type UserIdentityProvider,
  type SceneObject,
  type GameCameraState,
  type RuntimeBootModel,
  type RuntimeCompileProfile,
  type RuntimeContentSource,
  type RuntimeHostKind,
  UIContextSystem,
  createGameStateStore,
  pickBootLifecycle,
  createObservableValue,
  createRuntimeActionRegistry,
  createUIActionRegistry,
  createUIContextStore,
  createUIStateStore,
  registerDefaultUIActions,
  type GameStateStore,
  type MutableObservableValue,
  type ObservableValue,
  type RuntimeActionRegistry,
  QUEST_MANAGER_PARTICIPANT_ID,
  GAME_SAVE_SCHEMA_VERSION,
  createGltfLoader,
  type PreNewGameStepAnswers,
  type PreNewGameStepDefinition,
  type UIActionRegistry,
  type UIContextStore,
  type UIStateStore
} from "@sugarmagic/runtime-core";
import {
  createHostPlayerParticipant,
  type HostPlayerSlice
} from "./save/hostPlayerParticipant";
import {
  createCampaignProgressionParticipant,
  type CampaignProgressionSlice
} from "./save/campaignProgressionParticipant";
import { showEntryTitleSequence } from "./sceneTransitionCard";
import { showSceneExitOverlay } from "./creditsRoll";
import {
  runPreNewGameSteps,
  writePreNewGameStepAnswers
} from "./preNewGameSteps";
import {
  npcOneShotIsPlaying,
  playNpcOneShot,
  releaseNpcOneShot,
  type NpcAnimationState
} from "./npcOneShotAnimation";
import {
  consumeOpenEpisodesFlag,
  consumeSceneEntryFlag,
  markOpenEpisodesForNextBoot,
  markSceneEntryForNextBoot
} from "./save/sceneEntry";
import type { EpisodesViewModel } from "./ui/EpisodesScreen";
import { gameplayFrameArt } from "./ui/frameArt";
import { SUGARMAGIC_VERSION } from "./version";
import { BillboardAssetRegistry } from "./billboard/BillboardAssetRegistry";
import { BillboardRenderer } from "./billboard/BillboardRenderer";
import { TextBillboardRenderer } from "./billboard/TextBillboardRenderer";
import { createRuntimeRenderEngineProjector } from "./RenderEngineProjector";
import { GameUILayer } from "./GameUILayer";
import {
  preloadAssetSources,
  type AssetPreloadProgress
} from "./assetPreload";
import { WebAudioAdapter } from "./audio";
import { FRESH_START_SESSION_STORAGE_KEY } from "./save/freshStart";

export interface WebTargetAdapter {
  boot: RuntimeBootModel;
  platform: "web";
  assetResolution: "root-relative-authored" | "published-target-manifest";
  inputPolicy: "dom-input-host";
}

export interface WebTargetAdapterRequest {
  hostKind: RuntimeHostKind;
  compileProfile: RuntimeCompileProfile;
  contentSource: RuntimeContentSource;
}

export interface WebRuntimeHostOptions {
  root: HTMLElement;
  ownerWindow?: Window;
  request: WebTargetAdapterRequest;
}

/**
 * How long boot loads before it stops deciding for the player.
 *
 * Long enough that a normal cold start on a slow connection never sees it --
 * the assets alone allow 20s each -- and short enough that nobody sits in
 * front of a loading screen wondering whether it is stuck.
 *
 * 60s is a placeholder, not a judgement about what a player should tolerate.
 * A cold first play currently fetches ~84 MiB, over half of which is texture
 * data the renderer discards: four PBR maps are stored 16-bit and every
 * texture loads through an HTMLImageElement, which keeps 8. Re-encoding them
 * takes that category from 47.4 MiB to roughly 9-12 MiB. Once that lands this
 * should come back down -- a 60s loading screen is not a target.
 * See issue #165, "Cut, and why".
 */
export const BOOT_READINESS_TIMEOUT_MS = 60_000;

export interface WebRuntimeStartState {
  regions: RegionDocument[];
  /**
   * Plan 058 §058.1 — the project's narrative Scenes. The host
   * picks the active Scene (first by sceneOrder until Plan 058.4
   * wires `campaign.progression`) and composes its per-region
   * overlay onto the region base for every spawn read. Optional
   * for back-compat: a stale pre-058 boot.json carries regions
   * with legacy `scene` nests instead, which `migrateToScenes`
   * lifts at start().
   */
  scenes?: Scene[];
  /** Plan 059 §059.4 — player-facing label for Scenes ("Scene" /
   *  "Chapter" / ...), used by the Episodes screen. */
  scenesUiLabel?: string | null;
  /**
   * Plan 058 §058.2 — which Scene to boot into. Studio Preview
   * passes the editor's ambient Scene selection; the deployed
   * game omits it (the player's Scene comes from the
   * `campaign.progression` save slice in Plan 058.4, falling
   * through to the first Scene by order until then).
   */
  activeSceneId?: string | null;
  activeRegionId?: string | null;
  activeEnvironmentId?: string | null;
  /** Plan 059 §059.1 — project music slots (default background
   *  music + credits theme). */
  musicBindings?: MusicBindings | null;
  /** Plan 059 §059.2 — credits roll content; empty sections =
   *  the exit sequence skips the roll. */
  creditsDefinition?: CreditsDefinition | null;
  /** Plan 059 §059.3 — the game's display title, shown as the
   *  first card of the entry title sequence. */
  gameTitle?: string | null;
  /**
   * Plan 092.6 — which game this is, from `gameProject.identity.id`.
   *
   * Every database and storage key the game creates on the player's device
   * leads with it, so two projects previewed on one origin cannot read each
   * other's saves or learner data. Absent means storage refuses to open, which
   * is a build defect rather than a player condition.
   */
  gameId?: string | null;
  /**
   * Story 47.5 — pre-loaded game save record for the current user.
   * When non-null, the host hydrates from the save's payload
   * (currentRegionId, playerPosition) instead of the authored
   * defaults from boot.json. Callers (App.tsx, preview.ts) load
   * this via `GameSaveStore.load(userId)` before invoking `start`;
   * `null` is the explicit "first-time player, no save yet" signal.
   */
  savedGame?: GameSave | null;
  /**
   * Story 47.10 boot-ordering follow-up — alternative to `savedGame`
   * when the caller needs to defer the save load until AFTER provider
   * resolution (e.g. App.tsx waits for SugarProfile's Supabase auth
   * to settle, then reads from the active cloud save store keyed on
   * the credentialed userId). When set, the host awaits this promise
   * AFTER firing `onProvidersResolved` but BEFORE region resolution +
   * player spawn, so the resumed region + position match the cloud
   * save rather than a stale anonymous-local one. `savedGame` wins
   * when both are provided (back-compat for callers that already
   * have the save in hand).
   */
  savedGamePromise?: Promise<GameSave | null>;
  /**
   * Story 47.5.5 — resolved user at boot, used to populate the
   * Session debug HUD card under Studio Preview. Callers
   * construct the active `UserIdentityProvider` and capture
   * `currentUser()` before invoking `start`. Optional because the
   * card is studio-only; published-web doesn't render the HUD.
   */
  currentUser?: User | null;
  /**
   * Story 47.7.5 — fallback identity provider passed when no
   * plugin contributes an `identity.provider`. The host runs
   * `resolveActiveIdentityProvider(manager, fallback)` after
   * plugin init and uses the resolved provider for downstream
   * consumers (Session HUD card user, the providers-resolved
   * callback below). When no plugin contributes, the resolved
   * provider IS the fallback.
   */
  fallbackIdentityProvider?: UserIdentityProvider | null;
  /**
   * Story 47.7.5 — same shape for the GameSaveStore. The host
   * doesn't currently use the resolved save store internally
   * (the save load happens in App.tsx before host.start), but
   * fires it through `onProvidersResolved` so App.tsx can swap
   * its own state for the eventual SugarProfile-contributed
   * cloud store.
   */
  fallbackSaveStore?: GameSaveStore | null;
  /**
   * Story 47.7.5 — fires synchronously after plugin init + the
   * resolver call. Receives the resolved active providers (which
   * may be either the supplied fallbacks or plugin-contributed
   * overrides). App.tsx uses this to swap UserContext to the
   * SugarProfile-contributed Supabase provider once SugarProfile
   * is enabled with a configured URL + anon key.
   */
  onProvidersResolved?: (resolved: {
    identityProvider: UserIdentityProvider;
    // Always wrapped via `createSerializedSaveStore` inside
    // `resolveActiveGameSaveStore` so callers can call
    // `resetForNewGame` without checking for it.
    saveStore: SerializedSaveStore;
  }) => void;
  installedPluginIds: string[];
  pluginRuntimeEnvironment?: RuntimePluginEnvironment;
  pluginConfigurations: PluginConfigurationRecord[];
  contentLibrary: ContentLibrarySnapshot;
  mechanics: MechanicsDefinition;
  playerDefinition: PlayerDefinition;
  worldFlagDefinitions: WorldFlagDefinition[];
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  menuDefinitions: MenuDefinition[];
  hudDefinition: HUDDefinition | null;
  uiTheme: UITheme;
  soundEventBindings: SoundEventBindingMap;
  audioMixer: AudioMixerSettings;
  assetSources: Record<string, string>;
  pluginBootPayloads?: Record<string, unknown>;
  /**
   * Story 47.10.5 — authored "fresh start" record from
   * `GameProject.defaultGameSavePayload`. Used when a returning
   * player has no save (or just clicked "New Game" + reset) so the
   * runtime spawns at the project-curated starting state instead
   * of the implicit boot.json + playerPresence defaults. `null`
   * (omitted) preserves the implicit composition for projects that
   * don't author a value.
   */
  defaultGameSavePayload?: GameSavePayload | null;
  // Plan 054 §054.3 retired `onStartNewGame` and `onContinueGame`
  // from this state shape. The host owns those transitions now
  // (`host.startNewGame()` / `host.continueGame()`); ui-actions
  // dispatch goes through them directly.
  /**
   * Story 47.10.5 — when true, the host skips showing the
   * start-menu at boot and starts unpaused. Used by the "New
   * Game" flow: after clearing the save + reloading, the caller
   * sets this so the player doesn't have to click through the
   * start menu a second time to actually start playing.
   * Default (false / omitted) preserves the menu-on-boot behavior.
   */
  skipStartMenuOnBoot?: boolean;
  /**
   * What the player answered in the pre-new-game steps that ran just before
   * this boot, keyed by stepId (see `preNewGameSteps.ts`).
   *
   * Read out of sessionStorage at module load by the caller, alongside the
   * fresh-start flag, because both are written by the New Game press that
   * caused this page load. Empty on every other boot.
   */
  preNewGameStepAnswers?: PreNewGameStepAnswers;
}

/**
 * Story 51.2 — shared shape of the active identity + save
 * store pair the host resolves at the top of `start()`.
 * Previously duplicated as a local interface in target-web's
 * App.tsx and Studio's preview.tsx; now exported from the host
 * module so both sides import the same type AND can hold a
 * snapshot of it via `WebRuntimeHost.state.activeProviders`.
 */
export interface ProviderBindings {
  identityProvider: UserIdentityProvider;
  // SerializedSaveStore (the subtype with `resetForNewGame`).
  // `resolveActiveGameSaveStore` wraps unconditionally so callers
  // can rely on the reset API without per-callsite null checks.
  saveStore: SerializedSaveStore;
}

/**
 * Story 51.2 — host-owned observable stores that React + non-
 * React subscribers read from. Replaces the previous
 * `EventTarget`-based handoffs (which had a late-subscriber
 * race — see Plan 047 §47.10 incident). Subscribers attached
 * at ANY point read the current value via `getSnapshot()` at
 * subscribe time + receive change notifications going forward.
 *
 * The host mutates these; plugin code, React components, HUD
 * card getters, and gateway clients only READ.
 */
export interface WebRuntimeHostState {
  /**
   * Story 51.2 — the resolved identity + save store pair the
   * runtime is using right now. `null` until plugin bootstrap
   * settles inside `host.start()`. React subscribers should
   * use `useSyncExternalStore(activeProviders.subscribe,
   * activeProviders.getSnapshot)`.
   */
  activeProviders: ObservableValue<ProviderBindings | null>;
  /**
   * Story 51.3 — the currently-signed-in user, proxied from
   * the active identity provider's `currentUser` + `onChange`.
   * The host doesn't maintain a parallel "last known user"
   * mirror; this store IS the canonical snapshot for non-React
   * readers (Session HUD's User row, future Studio shell
   * surfaces). When `activeProviders` swaps providers, this
   * store's subscription re-attaches; reads via `getSnapshot()`
   * always return the live user.
   */
  user: ObservableValue<User | null>;
  /**
   * Story 51.3 — last autosave snapshot the Session HUD card
   * displays. Mutated by `notifyAutosaveWritten`. Same
   * snapshot+subscribe shape as the others; non-React getters
   * (`getSavedGameSnapshot: () => host.state.latestAutosave.getSnapshot()`)
   * replace the previous module-let mirror inside the host's
   * closure.
   */
  latestAutosave: ObservableValue<SessionHudSavedGameSnapshot | null>;
  /**
   * Plan 060 §060.1 — boot asset-preload progress. Non-null only
   * while the preload phase is fetching file-backed assets into
   * the HTTP cache (between save resolution and world assembly);
   * the boot overlays render "Loading assets N/M" from it. Null
   * before, and null again once the phase completes.
   */
  assetPreload: ObservableValue<AssetPreloadProgress | null>;
  /**
   * Plan 092.6 — set when boot readiness has overrun and the player is being
   * asked what to do. Null the rest of the time.
   *
   * Starting a game whose world or whose player data has not arrived looks
   * like a broken game, not a loading one -- missing ground, absent scenery, a
   * learner taught words they already know. So the choice is the player's, and
   * this is how the boot screen knows to offer it.
   */
  bootStall: ObservableValue<{ waitedMs: number } | null>;
  /**
   * Plan 054 §054.3 — the canonical Model layer for game
   * lifecycle. `lifecycle: "booting" | "start-menu" | "playing"
   * | "paused"` answers "what phase of the game is the player
   * in?" in one place. React subscribers via
   * `useSyncExternalStore(state.gameState.subscribe,
   * state.gameState.getState)`. Plugin readers + non-React
   * consumers use `state.gameState.getState()`.
   *
   * Mutated through the host's transition methods
   * (`startNewGame`, `pauseGame`, `quitToMenu`, etc.), NOT by
   * direct `setState`. The transition methods are the only
   * sanctioned way to advance the lifecycle.
   */
  gameState: GameStateStore;
  /**
   * Plan 054 §054.3 — the View / presentation store. Holds
   * `visibleMenuKey` (overlay menu key — dialogue / inventory /
   * future plugin overlays; NOT lifecycle menus after 054.4),
   * `isPaused` (legacy; derived from `gameState.lifecycle` in
   * the meantime), `savePresent` (legacy; mirrored from
   * `gameState`), `loginModalOpen` (modal flag).
   *
   * During the 054 migration window, writes to `visibleMenuKey`
   * / `isPaused` are bridged to `gameState.lifecycle` via a
   * host-installed subscription. 054.4 migrates callsites; once
   * complete, the lifecycle fields retire from this store.
   */
  uiState: UIStateStore;
}

export interface WebRuntimeHost {
  readonly boot: RuntimeBootModel;
  /**
   * Story 51.2 — host-owned observable state. See
   * `WebRuntimeHostState`. Stable across the host's lifetime
   * (the same store objects are returned for every read).
   */
  readonly state: WebRuntimeHostState;
  /**
   * Story 47.10 boot-ordering follow-up — returns a Promise so
   * callers can await full boot (provider resolution + save load +
   * scene assembly + player spawn) before hiding their loading
   * overlay. Existing call sites that fire-and-forget keep working
   * because they never awaited the result anyway.
   */
  start: (state: WebRuntimeStartState) => Promise<void>;
  dispose: () => void;
  /**
   * Story 47.10 — compose a fresh `GameSavePayload` from the host's
   * live runtime state (player ECS position, captured active region,
   * quest manager's tracked quest). Returns `null` before `start()`
   * has settled (no world, no gameplay session) so the autosave loop
   * can no-op cleanly during boot. Cheap; safe to call on any tick.
   */
  getCurrentSavePayload(): GameSavePayload | null;
  /**
   * What the player answered in the pre-new-game steps that ran just before
   * this boot, keyed by stepId. Empty on an ordinary boot. Stays readable for
   * the life of the session; reading it does not consume it.
   */
  getPreNewGameStepAnswers(): PreNewGameStepAnswers;
  /**
   * Story 47.10 follow-up — callers tell the host when a fresh save
   * was written (autosave loop) so the Session debug HUD card
   * reflects the latest snapshot. Idempotent; safe to call after
   * every successful write even when the payload didn't change.
   */
  /** Plan 092.6 — the player's answer to the still-loading prompt. */
  startWithoutFinishedLoading(): void;
  notifyAutosaveWritten(snapshot: {
    lastPlayed: string;
    payload: GameSavePayload;
  }): void;
  /**
   * Story 47.10.5 — re-open the start menu mid-session (paused).
   * Used by the deployed bundle + Studio Preview when the active
   * user transitions from null to signed-in AFTER boot (e.g. the
   * player signed out mid-game and just signed back in). Without
   * this, the LoginModal closes and the game silently resumes
   * wherever the player was — they never see Continue / New Game
   * again. Idempotent; no-op when the start menu is already
   * visible or the project has no `start-menu` definition.
   */
  showStartMenu(): void;
  /**
   * Story 50.6 — flip the `loginModalOpen` flag on the host's
   * UIStateStore. The runtime-mode resolver returns
   * "login-modal" when the flag is true, which makes the
   * keyboard action registry disable every in-game / dialogue
   * action so typing into the modal's email field can't co-fire
   * inventory etc. Callers (App.tsx, preview.tsx) call this
   * from a useEffect that mirrors their `showLoginModal` boolean
   * — true on mount, false on unmount. Idempotent.
   */
  setLoginModalOpen(open: boolean): void;
  /**
   * Plan 054 §054.3 — destructive New Game flow. Reads the
   * active providers, calls `saveStore.resetForNewGame(userId)`
   * (atomic in-flight-flush + delete + freeze), sets the fresh-
   * start sessionStorage flag, then `window.location.reload()`.
   * Never resolves on the happy path — the reload navigates the
   * page away. Callers shouldn't sequence anything after the
   * await.
   */
  startNewGame(): Promise<void>;
  /**
   * Plan 054 §054.3 — "Continue" transition. Boot already
   * loaded the save; this just transitions the lifecycle out of
   * "start-menu" into "playing" (and hides the start menu via
   * the legacy field bridge). No save side effects.
   */
  continueGame(): void;
  /**
   * Plan 054 §054.3 — pause the active game. Transitions
   * `lifecycle: "playing" -> "paused"`. No-op + warn from any
   * other lifecycle.
   */
  pauseGame(): void;
  /**
   * Plan 054 §054.3 — resume from pause. Transitions
   * `lifecycle: "paused" -> "playing"`. No-op + warn from any
   * other lifecycle.
   */
  resumeGame(): void;
  /**
   * Plan 054 §054.3 — return to start menu mid-session. Save
   * is NOT touched (player can press Continue to resume).
   * Transitions `lifecycle: "playing" | "paused" -> "start-menu"`.
   * Replaces the old `showStartMenu()` for the mid-session case
   * (boot still uses `showStartMenu()` for the initial menu open).
   */
  quitToMenu(): void;
}

const FOLIAGE_FALLBACK_COLOR = 0x8ad26a;

const gltfLoader = createGltfLoader();

/** Plan 070.2 — NPCs stash their idle AnimationMixer in the reconciler
 *  entry's `host` slot (driven each frame from the runtime loop). */
type HostEntryData = NpcAnimationState;

/** Plan 068.13a -- a placed asset is instanceable if it is a static model
 *  with no per-instance scatter / surface-ref surface (those realize
 *  grass/foliage per instance and need the per-object build). Painted-mask
 *  and scene-scoped surface differences are handled by the grouping key
 *  (`representationKey` folds in the mask, ADR 028 Gate 2), so they simply
 *  land in different groups rather than being excluded here. Skinned models
 *  are `npc`/`player` kind and never reach here; the builder also guards. */

function createCameraSnapshot(
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number
): CameraSnapshot {
  const position = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const projectionView = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  camera.getWorldPosition(position);
  camera.getWorldDirection(forward);
  frustum.setFromProjectionMatrix(projectionView);

  return {
    position: { x: position.x, y: position.y, z: position.z },
    forward: { x: forward.x, y: forward.y, z: forward.z },
    frustumPlanes: frustum.planes.map((plane) => ({
      nx: plane.normal.x,
      ny: plane.normal.y,
      nz: plane.normal.z,
      d: plane.constant
    })),
    viewport: {
      width: Math.max(1, Math.round(viewportWidth)),
      height: Math.max(1, Math.round(viewportHeight))
    },
    fov: THREE.MathUtils.degToRad(camera.fov)
  };
}

function applyBillboardLodEnforcement(input: {
  world: World;
  renderBindings: Map<number, THREE.Object3D>;
}) {
  for (const [entity, root] of input.renderBindings) {
    const billboard = input.world.getComponent(entity, BillboardComponent);
    if (!billboard) {
      root.visible = true;
      continue;
    }

    // Billboards without LOD thresholds (e.g. debug text labels) coexist
    // with the mesh — they don't replace it. Only enforce LOD switching
    // when thresholds are configured.
    if (!billboard.lodThresholds) {
      root.visible = true;
      continue;
    }

    if (billboard.lodState === "full-mesh") {
      root.visible = billboard.visible;
      continue;
    }

    root.visible = false;
  }
}

function createFoliageFallbackMesh(): THREE.Group {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.14, 1.1, 8),
    new THREE.MeshStandardMaterial({
      color: 0x7b5c3f,
      roughness: 0.82,
      metalness: 0.02
    })
  );
  trunk.position.y = 0.55;

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 12, 12),
    new THREE.MeshStandardMaterial({
      color: FOLIAGE_FALLBACK_COLOR,
      roughness: 0.95,
      metalness: 0
    })
  );
  canopy.position.y = 1.32;

  const group = new THREE.Group();
  group.add(trunk);
  group.add(canopy);
  return group;
}

function getSceneObjectFallback(object: SceneObject): THREE.Object3D {
  if (object.kind !== "asset") {
    return createCapsuleFallback(object);
  }

  return object.assetKind === "foliage"
    ? createFoliageFallbackMesh()
    : createFallbackMesh();
}

function getAllRenderableMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child);
    }
  });
  return meshes;
}

function foliageMaterialHasTexture(material: THREE.Material): boolean {
  if (!(material instanceof THREE.MeshStandardMaterial)) {
    return false;
  }

  return Boolean(material.map || material.alphaMap || material.emissiveMap);
}

function validateRenderableAsset(
  object: SceneObject,
  renderable: THREE.Object3D
): string | null {
  if (object.assetKind !== "foliage") {
    return null;
  }

  const meshes = getAllRenderableMeshes(renderable);
  if (meshes.length === 0) {
    return "Foliage GLB loaded without any mesh primitives.";
  }

  const hasUv = meshes.some((mesh) =>
    Boolean(mesh.geometry.getAttribute("uv"))
  );
  if (!hasUv) {
    return "Foliage GLB is missing UV data required for leaf texturing.";
  }

  const hasVertexColor = meshes.some((mesh) =>
    Boolean(mesh.geometry.getAttribute("color"))
  );
  if (!hasVertexColor) {
    return "Foliage GLB is missing COLOR_0 vertex color data required for canopy shading inputs.";
  }

  const hasTexture = meshes.some((mesh) => {
    const material = mesh.material;
    if (Array.isArray(material)) {
      return material.some(foliageMaterialHasTexture);
    }
    return foliageMaterialHasTexture(material);
  });
  if (!hasTexture) {
    return "Foliage GLB is missing embedded leaf texture bindings.";
  }

  return null;
}

interface SpellCastFeedbackHost {
  show: (spellName: string) => void;
  dispose: () => void;
}

interface RuntimePluginBannerHost {
  apply: (banners: RuntimeBannerContribution[]) => void;
  dispose: () => void;
}

function readRendererDebugStats(renderer: WebGPURenderer): {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
} {
  return {
    drawCalls: renderer.info.render.drawCalls,
    triangles: renderer.info.render.triangles,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries
  };
}

function createSpellCastFeedbackHost(
  parent: HTMLElement
): SpellCastFeedbackHost {
  if (!document.getElementById("sm-web-spell-cast-feedback-styles")) {
    const style = document.createElement("style");
    style.id = "sm-web-spell-cast-feedback-styles";
    style.textContent = `
      .sm-web-spell-cast-feedback {
        position: absolute;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        pointer-events: none;
        z-index: 20;
      }

      .sm-web-spell-cast-feedback-toast {
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(137, 220, 235, 0.24);
        background: linear-gradient(180deg, rgba(36, 38, 50, 0.95), rgba(24, 24, 37, 0.97));
        color: #eef6ff;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
        opacity: 0;
        transform: translateY(8px);
        animation: sm-web-spell-cast-feedback-in 180ms ease-out forwards;
      }

      .sm-web-spell-cast-feedback-toast.leaving {
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 180ms ease-out, transform 180ms ease-out;
      }

      @keyframes sm-web-spell-cast-feedback-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.className = "sm-web-spell-cast-feedback";
  parent.appendChild(container);

  return {
    show(spellName) {
      const toast = document.createElement("div");
      toast.className = "sm-web-spell-cast-feedback-toast";
      toast.textContent = `${spellName} Spell Cast`;
      container.appendChild(toast);

      window.setTimeout(() => {
        toast.classList.add("leaving");
        window.setTimeout(() => {
          if (toast.parentElement === container) {
            container.removeChild(toast);
          }
        }, 180);
      }, 1600);
    },
    dispose() {
      if (container.parentElement === parent) {
        parent.removeChild(container);
      }
    }
  };
}

function createRuntimePluginBannerHost(
  parent: HTMLElement
): RuntimePluginBannerHost {
  if (!document.getElementById("sm-web-plugin-banner-styles")) {
    const style = document.createElement("style");
    style.id = "sm-web-plugin-banner-styles";
    style.textContent = `
      .sm-web-plugin-banners {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        pointer-events: none;
        z-index: 18;
      }

      .sm-web-plugin-banner {
        min-width: 220px;
        max-width: min(720px, calc(100vw - 48px));
        padding: 10px 16px;
        border-radius: 999px;
        border: 1px solid rgba(137, 180, 250, 0.28);
        background: rgba(17, 17, 27, 0.88);
        color: #eef6ff;
        text-align: center;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      }
    `;
    document.head.appendChild(style);
  }

  const container = document.createElement("div");
  container.className = "sm-web-plugin-banners";
  parent.appendChild(container);

  return {
    apply(banners) {
      container.replaceChildren();
      for (const banner of banners) {
        const element = document.createElement("div");
        element.className = "sm-web-plugin-banner";
        element.textContent = banner.payload.message;
        container.appendChild(element);
      }
    },
    dispose() {
      if (container.parentElement === parent) {
        parent.removeChild(container);
      }
    }
  };
}

function getActiveRegion(
  regions: RegionDocument[],
  activeRegionId: string | null | undefined
): RegionDocument | null {
  if (activeRegionId) {
    const activeRegion = regions.find(
      (region) => region.identity.id === activeRegionId
    );
    if (activeRegion) return activeRegion;
  }
  return regions[0] ?? null;
}

export function createWebTargetAdapter(
  request: WebTargetAdapterRequest
): WebTargetAdapter {
  const boot = createRuntimeBootModel(request);

  return {
    boot,
    platform: "web",
    assetResolution:
      request.contentSource === "authored-game-root"
        ? "root-relative-authored"
        : "published-target-manifest",
    inputPolicy: "dom-input-host"
  };
}

export function createWebRuntimeHost(
  options: WebRuntimeHostOptions
): WebRuntimeHost {
  const { root, ownerWindow = window, request } = options;
  const adapter = createWebTargetAdapter(request);

  // Story 51.2 — host-owned observable stores. Created once per
  // host instance (BEFORE start()), populated as `start()`
  // progresses. Subscribers attached anytime (before start, after
  // start, during start) read via getSnapshot() — late-subscriber
  // races become structurally impossible.
  const activeProvidersStore: MutableObservableValue<ProviderBindings | null> =
    createObservableValue<ProviderBindings | null>(null);
  // Story 51.3 — host.state.user store, proxies the active
  // provider's user. Updated in lockstep with the existing
  // identity-onChange wiring below; getter calls
  // `userStore.getSnapshot()` instead of reading the module-let
  // mirror that used to live here.
  const userStore: MutableObservableValue<User | null> =
    createObservableValue<User | null>(null);
  // Story 51.3 — host.state.latestAutosave. Replaces the
  // `latestSavedGameSnapshot` module-let. `notifyAutosaveWritten`
  // calls `set()`; Session HUD getter reads via `getSnapshot()`.
  const latestAutosaveStore: MutableObservableValue<SessionHudSavedGameSnapshot | null> =
    createObservableValue<SessionHudSavedGameSnapshot | null>(null);
  // Plan 060 §060.1 — boot asset-preload progress store.
  const bootStallStore: MutableObservableValue<{ waitedMs: number } | null> =
    createObservableValue<{ waitedMs: number } | null>(null);
  /** Resolves the readiness wait when the player chooses to start anyway.
   *  Replaced each boot; a no-op until readiness has actually overrun. */
  let startAnyway: (() => void) | null = null;
  const assetPreloadStore: MutableObservableValue<AssetPreloadProgress | null> =
    createObservableValue<AssetPreloadProgress | null>(null);

  // Plan 054 §054.3 — game-lifecycle + UI-presentation stores
  // constructed at host construction time (not inside start()).
  // Stable identity across start/dispose cycles; React subscribers
  // attach via `useSyncExternalStore(store.subscribe, store.getState)`.
  //
  // `uiStateStore` was previously created inside start(); moving
  // it out here means start() does `setState(...)` to set the
  // initial boot values instead of allocating a new store. Any
  // pre-start subscribers keep working.
  const gameStateStore: GameStateStore = createGameStateStore();
  const uiStateStore: UIStateStore = createUIStateStore();

  // The 054.3 ui-state -> game-state migration bridge retired
  // in 054.4 Pass C. Lifecycle transitions go through the host's
  // transition methods directly; uiState carries overlay-only
  // concerns.

  // Plan 054 §054.3 — lifecycle transition methods. During the
  // 054 migration window these methods write to the legacy
  // `uiStateStore` fields; the bridge above mirrors the change
  // into `gameStateStore.lifecycle`. 054.4 will flip the
  // direction (write `gameState` directly; legacy fields retire).

  // The plugin manager is built inside start(). New Game is a host action that
  // runs outside that closure and needs to ask plugins for their pre-new-game
  // steps, so start() publishes the manager here. Null before the first start()
  // and after dispose, which reads as "no steps to run".
  let activePluginManager: ReturnType<
    typeof createResolvedRuntimePluginManager
  > | null = null;

  // Set while a pre-new-game step is on screen, and called with the player's
  // choice by GameUILayer's confirm button. Read at call time rather than
  // captured, so the callback handed to GameUILayer at mount stays correct for
  // every step of every New Game press.
  let resolveOpenPreNewGameStep: ((optionId: string) => void) | null = null;

  /** Put one step on screen and wait for the confirm press. */
  function presentPreNewGameStep(
    definition: PreNewGameStepDefinition
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      resolveOpenPreNewGameStep = resolve;
      uiStateStore.setState({
        preNewGameStepOpen: true,
        preNewGameStepDefinition: definition
      });
    });
  }

  async function hostStartNewGame(): Promise<void> {
    // Ask whatever plugins want asked, then destroy the save. The manager is
    // built inside start(); New Game runs outside it, which is why the handle
    // above exists. No contributed steps means this loop does nothing and New
    // Game behaves exactly as it did before the seam existed.
    const stepContributions =
      activePluginManager?.getContributions("newGame.preStep") ?? [];
    if (stepContributions.length > 0) {
      const answers = await runPreNewGameSteps({
        contributions: stepContributions,
        present: presentPreNewGameStep
      });
      writePreNewGameStepAnswers(answers);
    }

    const bindings = activeProvidersStore.getSnapshot();
    const settledUser = bindings?.identityProvider.currentUser();
    if (bindings && settledUser) {
      try {
        await bindings.saveStore.resetForNewGame(settledUser.userId);
      } catch (error) {
        // resetForNewGame leaves the store frozen on failure;
        // the reload below rebuilds from scratch.
        console.warn(
          "[web-runtime] startNewGame: resetForNewGame failed; store frozen, reloading anyway.",
          error
        );
      }
    } else {
      console.warn(
        "[web-runtime] startNewGame: no active providers/user at click time; reloading anyway."
      );
    }
    sessionStorage.setItem(FRESH_START_SESSION_STORAGE_KEY, "1");
    ownerWindow.location.reload();
  }
  function hostContinueGame(): void {
    gameStateStore.setState({ lifecycle: "playing" });
    // Plan 059 §059.1 — crossfade menu theme -> in-game track
    // (usually silence). Idempotent when resuming from pause.
    gameplaySession?.setMusicTrack(sceneMusicCueIdForSession);
  }

  // Plan 058 §058.5 — quest Scene-progression actions land here
  // from the assembly's quest action handler. `unlockScene` only
  // mutates campaign state (persisted on the next autosave tick).
  // `advanceToNextScene` mutates, force-writes the save, shows
  // the target Scene's transition card (null config = hard cut),
  // then reloads: the boot path recomposes the world into the new
  // Scene the same way Continue does — no separate mid-session
  // recompose machinery.
  function hostHandleSceneAction(action: {
    type: "unlockScene" | "advanceToNextScene";
    sceneId: string | null;
  }): void {
    if (action.type === "unlockScene") {
      if (!action.sceneId) {
        console.warn(
          "[web-runtime] unlockScene action without a sceneId targetId; ignoring."
        );
        return;
      }
      if (!manuallyUnlockedSceneIds.includes(action.sceneId)) {
        manuallyUnlockedSceneIds.push(action.sceneId);
      }
      return;
    }

    const ordered = [...bootScenes].sort(
      (left, right) => left.sceneOrder - right.sceneOrder
    );
    const currentIndex = ordered.findIndex(
      (scene) => scene.sceneId === activeSceneIdForSave
    );
    const target = action.sceneId
      ? ordered.find((scene) => scene.sceneId === action.sceneId) ?? null
      : ordered[currentIndex + 1] ?? null;
    // Plan 059 §059.3 — a null target is the FINAL-Scene case,
    // not an error: the exit sequence still plays (credits!) and
    // routes back to the menu.
    if (target && target.sceneId === activeSceneIdForSave) return;

    hostMarkSceneCompleted(activeSceneIdForSave);
    if (target) {
      // Manual unlock so the advance survives condition
      // re-evaluation on every future boot.
      if (!manuallyUnlockedSceneIds.includes(target.sceneId)) {
        manuallyUnlockedSceneIds.push(target.sceneId);
      }
      activeSceneIdForSave = target.sceneId;
    }
    void runExitSequenceAndReload(target);
  }

  /**
   * Plan 059 §059.3 — the single Scene-completion hook. When the
   * sandbox replay mode lands (Plan 059 central tension), the
   * per-Scene end-state snapshot capture inserts HERE — one
   * place, not scattered across advance paths.
   */
  function hostMarkSceneCompleted(sceneId: string | null): void {
    if (!sceneId) return;
    if (!completedSceneIds.includes(sceneId)) {
      completedSceneIds.push(sceneId);
    }
  }

  /**
   * Plan 059 §059.3 — the exit sequence: force-save, credits roll
   * with the credits theme, then Netflix routing (filling Next
   * button auto-advancing, or a return button after the final
   * Scene). The reload lands either in the next Scene (entry
   * title sequence marked) or on the menu.
   */
  async function runExitSequenceAndReload(
    target: Scene | null
  ): Promise<void> {
    // The reload can't wait for the next 5s autosave tick or the
    // advance would be lost.
    await forceWriteSave("scene advance");

    // One overlay: credits scroll with the routing control in the
    // bottom-right corner over them (Netflix model). The credits
    // theme plays under everything until the reload cuts it.
    const credits = bootCreditsDefinition;
    if (credits && credits.sections.length > 0) {
      gameplaySession?.setMusicTrack(creditsThemeCueIdForSession);
    }
    const choice = await showSceneExitOverlay(ownerWindow.document, {
      credits,
      nextSceneTitle: target?.displayName ?? null,
      menuLabel: `Back to ${bootEpisodesViewModel?.scenesUiLabel ?? "Scene"}s`
    });

    if (choice === "next" && target) {
      // Skip the start menu AND play the entry title sequence on
      // the next boot (game title -> Scene title). Save was
      // force-written above, so boot restores into the new Scene.
      sessionStorage.setItem(FRESH_START_SESSION_STORAGE_KEY, "1");
      markSceneEntryForNextBoot();
    } else {
      // Plan 059 §059.4 — land on the start menu with the
      // Episodes screen opened.
      markOpenEpisodesForNextBoot();
    }
    ownerWindow.location.reload();
  }
  function hostPauseGame(): void {
    const lifecycle = gameStateStore.getState().lifecycle;
    if (lifecycle !== "playing") {
      console.warn(
        `[web-runtime] pauseGame ignored — lifecycle is "${lifecycle}", expected "playing".`
      );
      return;
    }
    gameStateStore.setState({ lifecycle: "paused" });
  }
  function hostResumeGame(): void {
    const lifecycle = gameStateStore.getState().lifecycle;
    if (lifecycle !== "paused") {
      console.warn(
        `[web-runtime] resumeGame ignored — lifecycle is "${lifecycle}", expected "paused".`
      );
      return;
    }
    gameStateStore.setState({ lifecycle: "playing" });
  }
  function hostQuitToMenu(): void {
    const lifecycle = gameStateStore.getState().lifecycle;
    if (lifecycle !== "playing" && lifecycle !== "paused") {
      console.warn(
        `[web-runtime] quitToMenu ignored — lifecycle is "${lifecycle}", expected "playing" or "paused".`
      );
      return;
    }
    // Paper cut #1 (docs/backlog/003-runtime-paper-cuts.md) —
    // if a dialogue is mid-flight when the player quits to menu,
    // cancel it explicitly so the panel hides and
    // `activeOverlayMenuKey` clears. Otherwise the next Continue
    // resumes into a stale dialogue overlay with the resolver
    // returning "dialogue" mode, trapping the player. `end()` is
    // a safe no-op when no dialogue is active.
    gameplaySession?.dialogueManager.end("cancelled");
    // Belt + suspenders — any future overlay that forgets to
    // clear its own key on hide() would otherwise leak into the
    // start-menu lifecycle. The dialogue.end() above already
    // clears "dialogue"; this catches everything else.
    uiStateStore.setState({ activeOverlayMenuKey: null });
    gameStateStore.setState({ lifecycle: "start-menu" });
    // Plan 059 §059.1 — the menu theme returns on quit-to-menu.
    gameplaySession?.setMusicTrack(menuMusicCueIdForSession);
  }

  let world: World | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  // Shared render engine owns the GPU device, ShaderRuntime, resolver, and
  // resolved environment state. This runtime host creates a per-surface
  // RenderView bound to that engine.
  const engine: WebRenderEngine = createWebRenderEngine({
    compileProfile: request.compileProfile,
    logger: {
      warn(message: string, payload?: Record<string, unknown>) {
        console.warn("[web-runtime] shader-runtime", {
          message,
          ...(payload ?? {})
        });
      },
      debug(message: string, payload?: Record<string, unknown>) {
        console.debug("[web-runtime] shader-runtime", {
          message,
          ...(payload ?? {})
        });
      }
    }
  });
  const renderEngineProjector = createRuntimeRenderEngineProjector(engine);
  let renderView: RenderView | null = null;
  let unsubscribeTexturesUpdated: (() => void) | null = null;
  let currentAssetSources: Record<string, string> = {};
  let cameraState: GameCameraState | null = null;
  /**
   * Named camera moves in flight. The HOST owns this because the host owns
   * cameraState -- runtime-core defines what a move is and where it should be
   * at time t, but nothing in core owns a camera to move.
   */
  const cameraMoveDirector = createCameraMoveDirector();
  const CAMERA_MOVE_BOUNDS = {
    pitchMin: DEFAULT_CAMERA_CONFIG.pitchMin,
    pitchMax: DEFAULT_CAMERA_CONFIG.pitchMax,
    distanceMin: DEFAULT_CAMERA_CONFIG.distanceMin,
    distanceMax: DEFAULT_CAMERA_CONFIG.distanceMax
  };
  let inputManager: ReturnType<typeof createRuntimeInputManager> | null = null;
  let playerVisualController: ReturnType<
    typeof createPlayerVisualController
  > | null = null;
  let gameplaySession:
    | ReturnType<typeof createRuntimeGameplayAssembly>["gameplaySession"]
    | null = null;
  // Story 47.10 — last region the host resolved at `start()`.
  // Read by the host.player participant's serialize and by the
  // world.presence tracker to key its per-region set. Updated
  // only on `start()` for now — mid-session region transitions
  // land in a follow-up story.
  let activeRegionIdForSave: string | null = null;
  // Plan 055 §055.1 — one registry per host lifetime. Systems
  // register at construction; the registry survives host.start /
  // dispose cycles.
  const saveParticipantRegistry = new SaveParticipantRegistry();
  // Plan 073 §073.1 — playthrough.identity mints/adopts the
  // playthroughId every reset-on-New-Game plugin store keys on
  // (SugarAgent NPC memory). Host-owned tier so it settles in
  // Phase 1; deserialize(null) at boot mints a fresh id (New Game
  // / first boot / pre-073 save), a present slice adopts it
  // (Continue). No host closures — it owns its own value and feeds
  // the `getActivePlaythroughId` registry.
  saveParticipantRegistry.register(
    createPlaythroughIdentitySaveParticipant()
  );
  // Plan 055 §055.3 — host.player is the first real participant.
  // deserialize writes into `hostPlayerRestore` so the spawn
  // resolution block in `start()` can prefer restored values over
  // authored defaults without re-running any picker helper.
  let hostPlayerRestore: HostPlayerSlice | null = null;
  saveParticipantRegistry.register(
    createHostPlayerParticipant({
      getWorld: () => world,
      getCurrentRegionId: () => activeRegionIdForSave,
      applyRestoredSlice: (data) => {
        hostPlayerRestore = data;
      }
    })
  );
  // Plan 058 §058.4 — campaign.progression. Host-owned tier:
  // `currentSceneId` decides which Scene overlay composes the
  // world, so it must restore in Phase 1 before spawn (same class
  // as host.player's currentRegionId). The closures below are the
  // live state; 058.5's advance/unlock actions mutate them.
  let activeSceneIdForSave: string | null = null;
  let manuallyUnlockedSceneIds: string[] = [];
  let completedSceneIds: string[] = [];
  let campaignRestore: CampaignProgressionSlice | null = null;
  /** The migrated Scene list from the last start() — the advance
   *  action resolves "next by order" against it. */
  let bootScenes: Scene[] = [];
  // Plan 059 §059.1 — the two music tracks for this session; the
  // lifecycle handlers below switch the channel between them.
  let sceneMusicCueIdForSession: string | null = null;
  let menuMusicCueIdForSession: string | null = null;
  // Plan 059 §059.3 — exit/entry sequence inputs from the boot
  // payload.
  let creditsThemeCueIdForSession: string | null = null;
  let bootCreditsDefinition: CreditsDefinition | null = null;
  let bootGameTitle: string | null = null;
  // Plan 059 §059.4 — the Episodes screen's derived view model,
  // built once per boot from Scenes + campaign.progression.
  let bootEpisodesViewModel: EpisodesViewModel | null = null;
  // Plan 061 §061.3 — the site's Play page, read from SugarProfile
  // config at boot. Empty = no Exit affordance anywhere.
  let bootPlayPageUrl = "";
  // What the player answered on the way into this boot. Empty unless the page
  // load was caused by a New Game press that ran at least one step.
  let bootPreNewGameStepAnswers: PreNewGameStepAnswers = {};
  saveParticipantRegistry.register(
    createCampaignProgressionParticipant({
      getCurrentSceneId: () => activeSceneIdForSave,
      getManuallyUnlockedSceneIds: () => manuallyUnlockedSceneIds,
      getCompletedSceneIds: () => completedSceneIds,
      applyRestoredSlice: (data) => {
        campaignRestore = data;
      }
    })
  );
  // Plan 055 §055.6 — world.presence tracker + participant.
  // Host-owned lifetime (survives assembly rebuilds when we
  // eventually support mid-session region transitions).
  // Registered at factory time; Phase 1 deserialize populates it
  // before `gameplayAssembly` reads shouldSkipItemPresence.
  const worldPresenceTracker = new WorldPresenceTracker();
  saveParticipantRegistry.register(
    createWorldPresenceSaveParticipant({ tracker: worldPresenceTracker })
  );
  // Story 47.10 follow-up — live user + last-known save snapshot
  // surfaced to the Session debug HUD card. Story 51.3 migrated
  // both off module-let mirrors onto host.state observables
  // (`userStore`, `latestAutosaveStore` defined above). The
  // identity onChange subscription below now writes into
  // `userStore.set(next)` instead of mutating a local `latestUser`.
  let identityUnsubscribe: (() => void) | null = null;
  // Plan 092.6.3 — per-account record sync. One per host lifetime; stopped
  // on teardown so a disposed host does not keep reconciling in the
  // background against an account nobody is playing as.
  let accountDataSync: SyncEngine | null = null;
  /** The first reconcile, awaited by boot before the game becomes playable. */
  let firstSyncPass: Promise<void> | null = null;
  let billboardAssetRegistry: BillboardAssetRegistry | null = null;
  let billboardRenderer: BillboardRenderer | null = null;
  let textBillboardRenderer: TextBillboardRenderer | null = null;
  let debugHud: ReturnType<typeof createRuntimeDebugHud> | null = null;
  let gameplayAssembly: ReturnType<
    typeof createRuntimeGameplayAssembly
  > | null = null;
  // Plan 069.9 — outer-scoped so teardown frees the WASM navmesh across
  // region/scene restarts (holds a recast NavMesh); `getPathfinder` reads it.
  let navMeshPathfinder: NavMeshPathfinder | null = null;
  // Bumped every start(); the async navmesh load bails (and frees its result)
  // when a newer start() has superseded it — else a late load would overwrite
  // the current region's pathfinder with a stale mesh AND leak the WASM one.
  let navMeshLoadEpoch = 0;
  let playerEyeHeight = 1.62;
  let spellCastFeedbackHost: SpellCastFeedbackHost | null = null;
  let pluginBannerHost: RuntimePluginBannerHost | null = null;
  let uiLayerRoot: ReactRoot | null = null;
  let uiLayerElement: HTMLDivElement | null = null;
  let uiContextStore: UIContextStore | null = null;
  // `uiStateStore` is constructed at host factory time above
  // (Plan 054 §054.3); no `let` here anymore.
  let uiActionRegistry: UIActionRegistry | null = null;
  // Story 50.3 — central keyboard action registry. One window
  // listener per session lifetime; handlers (inventory, quest
  // journal, etc.) register against it via the registry's
  // register() return value (an unregister fn called on
  // module dispose). The registry's `dispose()` runs on session
  // teardown, clearing any remaining registrations and removing
  // the window listener.
  let runtimeActionRegistry: RuntimeActionRegistry | null = null;
  let webAudioAdapter: WebAudioAdapter | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  // Plan 069.10 / 070.1 perf probe (dev-only, gated by `window.__smperf`):
  // isolates the CPU update path from render, and (070.1) splits render into
  // CPU-submission vs the GPU/vsync remainder, with A/B toggles to attribute
  // the ~27ms render cost. Off by default.
  //
  //   window.__smperf = true                         // log only (legacy)
  //   window.__smperf = { log:true, noShadows:true } // + A/B a suspect
  //
  // A/B flags (any combination): noShadows, noScatter (grass compute),
  // noLandscape. `window.__smperfStats` exposes the last 1Hz averages for
  // the perf harness driver to scrape; `lastBootMs` is the last host.start()
  // wall-clock (the PREVIEW_BOOT reboot cost).
  let perfWorldMs = 0;
  let perfSessionMs = 0;
  let perfRenderCpuMs = 0;
  let perfFrameMs = 0;
  let perfFrames = 0;
  let perfLastLogMs = 0;
  let started = false;

  interface SmperfConfig {
    on: boolean;
    log: boolean;
    noShadows: boolean;
    noScatter: boolean;
    noLandscape: boolean;
  }
  function readSmperf(): SmperfConfig {
    const raw = (globalThis as { __smperf?: unknown }).__smperf;
    if (raw === true) {
      return { on: true, log: true, noShadows: false, noScatter: false, noLandscape: false };
    }
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      return {
        on: true,
        log: o.log !== false,
        noShadows: o.noShadows === true,
        noScatter: o.noScatter === true,
        noLandscape: o.noLandscape === true
      };
    }
    return { on: false, log: false, noShadows: false, noScatter: false, noLandscape: false };
  }
  function publishSmperfStats(stats: Record<string, number>): void {
    (globalThis as { __smperfStats?: Record<string, number> }).__smperfStats = {
      ...((globalThis as { __smperfStats?: Record<string, number> }).__smperfStats ?? {}),
      ...stats
    };
  }
  // Plan 070.1 — self-driving A/B capture. Run `await __smperfRun()` in the
  // preview console (works in ANY Chrome — no debugger attach needed): it
  // flips each condition, samples the 1Hz stats, restores, and prints +
  // returns the attribution table. Exposed on window in start().
  async function runSmperfMatrix(
    opts?: { perConditionMs?: number }
  ): Promise<{ table: string; rows: Record<string, number | string | null>[] }> {
    // Default 4s per condition: shadow toggles force a pipeline recompile,
    // so a short window captures rebuild churn instead of steady state.
    const perCond = opts?.perConditionMs ?? 4000;
    const conditions: [string, Record<string, boolean>][] = [
      ["baseline", { log: true }],
      ["-shadows", { log: true, noShadows: true }],
      ["-scatter", { log: true, noScatter: true }],
      ["-landscape", { log: true, noLandscape: true }],
      ["-all", { log: true, noShadows: true, noScatter: true, noLandscape: true }]
    ];
    const w = globalThis as {
      __smperf?: unknown;
      __smperfNoScatter?: boolean;
      __smperfStats?: Record<string, number>;
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const rows: Record<string, number | string | null>[] = [];
    for (const [name, cfg] of conditions) {
      w.__smperf = cfg;
      const samples: Record<string, number>[] = [];
      let lastFrame = -1;
      const end = performance.now() + perCond;
      while (performance.now() < end) {
        await sleep(250);
        const s = w.__smperfStats;
        if (s && s.frameMs !== lastFrame) {
          lastFrame = s.frameMs;
          samples.push({ ...s });
        }
      }
      const use = samples.slice(1); // drop the settling bucket
      const avg = (k: string) =>
        use.length
          ? Number(
              (use.reduce((a, s) => a + (s[k] ?? 0), 0) / use.length).toFixed(2)
            )
          : null;
      rows.push({
        name,
        frameMs: avg("frameMs"),
        fps: avg("fps"),
        worldMs: avg("worldMs"),
        sessionMs: avg("sessionMs"),
        renderCpuMs: avg("renderCpuMs"),
        gpuRestMs: avg("gpuRestMs")
      });
    }
    w.__smperf = false;
    w.__smperfNoScatter = false;
    const base = rows[0];
    const pad = (s: unknown, n: number) => String(s ?? "-").padEnd(n);
    const lines = [
      pad("condition", 12) + pad("frame", 8) + pad("fps", 6) +
        pad("world", 7) + pad("session", 9) + pad("render-cpu", 12) +
        pad("gpu+rest", 10) + "d(frame)"
    ];
    for (const r of rows) {
      const d =
        typeof r.frameMs === "number" && typeof base.frameMs === "number"
          ? (r.frameMs - base.frameMs).toFixed(1)
          : "-";
      lines.push(
        pad(r.name, 12) + pad(r.frameMs, 8) + pad(r.fps, 6) +
          pad(r.worldMs, 7) + pad(r.sessionMs, 9) + pad(r.renderCpuMs, 12) +
          pad(r.gpuRestMs, 10) + d
      );
    }
    const table = lines.join("\n");
    // eslint-disable-next-line no-console
    console.info(
      `[smperf-matrix]\n${table}\nreboot(lastBootMs): ${w.__smperfStats?.lastBootMs ?? "n/a"}`
    );
    return { table, rows };
  }
  // Dev-only quest + NPC behavior debug handle. Call in the preview console:
  //   __smquestDebug()            -- prints flags + quest state
  //   __smquestDebug("<npcId>")   -- also shows that NPC's resolved task
  // Raccoon lady id: "139daaec-a618-4053-b697-0ced0024d80d"
  function smQuestDebug(npcDefinitionId?: string): Record<string, unknown> {
    const qm = gameplaySession?.questManager ?? null;
    const flags = gameplaySession?.worldFlagManager ?? null;
    const nbs = gameplaySession?.npcBehaviorSystem ?? null;
    const slice = qm?.serializeSaveSlice() ?? null;
    const result: Record<string, unknown> = {
      worldFlags: flags?.getAllFlags() ?? null,
      talkedToDockWorker: flags?.hasFlag("talkedToDockWorker") ?? null,
      activeQuests: slice?.activeQuests ?? null,
      completedQuestIds: slice?.completedQuestIds ?? null
    };
    if (npcDefinitionId != null) {
      result.npcTask = nbs?.getCurrentTask(npcDefinitionId) ?? null;
    }
    // eslint-disable-next-line no-console
    console.info("[smquestdebug]", result);
    return result;
  }
  // Force-set a world flag without going through quest dialogue. Use to test
  // behavior-task injection directly:
  //   __smsetflag("talkedToDockWorker", true)
  function smSetFlag(key: string, value: unknown = true): void {
    const flags = gameplaySession?.worldFlagManager ?? null;
    if (!flags) {
      // eslint-disable-next-line no-console
      console.warn("[smsetflag] no active world flag manager");
      return;
    }
    flags.setFlag(key, value);
    // eslint-disable-next-line no-console
    console.info("[smsetflag]", key, "=", value);
  }
  // Plan 070.2 — the shared reconciler owns all scene renderables (created
  // per start() so its config closes over that start's state; disposed in
  // disposeRuntime). Cross-cutting per-frame consumers read it by instanceId.
  let renderableReconciler: RenderableReconciler | null = null;
  const npcMixer = (entry: ReconciledEntry): THREE.AnimationMixer | undefined =>
    (entry.host as HostEntryData).mixer;

  /**
   * Play one of an NPC's bound clips.
   *
   * Asking for a slot the NPC has no clip for leaves the current one playing.
   * Most NPCs are bound for idle alone, and stopping their only clip to honour
   * a walk request would freeze them in the bind pose mid-stride.
   */
  function setNpcAnimationSlot(
    entry: ReconciledEntry,
    slot: NPCAnimationSlot
  ): void {
    const host = entry.host as HostEntryData;
    // A one-shot holds the NPC until it ends. Without this the per-frame
    // locomotion drive would stop the clip on the very next frame.
    if (npcOneShotIsPlaying(host)) {
      return;
    }
    const clip = host.animationClips?.get(slot);
    if (!host.mixer || !clip || host.activeAnimationSlot === slot) {
      return;
    }
    host.activeAnimationAction?.stop();
    const action = host.mixer.clipAction(clip);
    action.reset();
    action.play();
    host.activeAnimationAction = action;
    host.activeAnimationSlot = slot;
  }

  /**
   * Plays one of an NPC's bound slots on every presence of that NPC. The hold
   * and its release live in npcOneShotAnimation; this resolves the action's
   * definitionId to the presences the reconciler keys entries by.
   */
  function playNpcAnimation(request: {
    npcDefinitionId: string;
    slot: NPCAnimationSlot;
    repeatCount: number;
  }): void {
    const presenceIds = (gameplaySession?.getNpcRuntimeSnapshots() ?? [])
      .filter((snapshot) => snapshot.npcDefinitionId === request.npcDefinitionId)
      .map((snapshot) => snapshot.presenceId);

    if (presenceIds.length === 0) {
      console.warn("[web-runtime] play-npc-animation-no-presence", {
        npcDefinitionId: request.npcDefinitionId,
        slot: request.slot
      });
      return;
    }

    for (const presenceId of presenceIds) {
      const entry = renderableReconciler?.get(presenceId);
      if (!entry) {
        continue;
      }
      const played = playNpcOneShot(
        entry.host as HostEntryData,
        request.slot,
        request.repeatCount
      );
      if (!played) {
        console.warn("[web-runtime] play-npc-animation-no-clip", {
          npcDefinitionId: request.npcDefinitionId,
          presenceId,
          slot: request.slot
        });
      }
    }
  }

  function disposeRuntime() {
    if (animationId !== null) {
      ownerWindow.cancelAnimationFrame(animationId);
      animationId = null;
    }

    activePluginManager = null;
    identityUnsubscribe?.();
    identityUnsubscribe = null;
    accountDataSync?.stop();
    accountDataSync = null;
    firstSyncPass = null;
    userStore.set(null);
    latestAutosaveStore.set(null);

    inputManager?.detach();
    inputManager = null;
    cameraState = null;
    // The director is a const in this closure and outlives a reboot, so a move
    // still in flight at teardown would drive the NEXT session's camera from a
    // baseline belonging to the last one.
    cameraMoveDirector.cancel();
    world = null;

    playerVisualController?.dispose();
    playerVisualController = null;
    debugHud?.dispose();
    debugHud = null;
    void gameplayAssembly?.dispose();
    gameplayAssembly = null;
    gameplaySession = null;
    // Plan 069.9 — free the recast navmesh (WASM) on teardown, and bump the
    // epoch so an in-flight load can't resurrect (and leak) after dispose.
    navMeshLoadEpoch += 1;
    navMeshPathfinder?.destroy();
    navMeshPathfinder = null;
    billboardRenderer?.dispose();
    billboardRenderer = null;
    textBillboardRenderer?.dispose();
    textBillboardRenderer = null;
    billboardAssetRegistry?.dispose();
    billboardAssetRegistry = null;
    spellCastFeedbackHost?.dispose();
    spellCastFeedbackHost = null;
    pluginBannerHost?.dispose();
    pluginBannerHost = null;
    uiLayerRoot?.unmount();
    uiLayerRoot = null;
    if (uiLayerElement?.parentElement === root) {
      root.removeChild(uiLayerElement);
    }
    uiLayerElement = null;
    uiContextStore = null;
    // uiStateStore is the host-lifetime const from factory time;
    // not nulled here. Plan 054 §054.3 — same lifetime model as
    // `activeProvidersStore` / `userStore` / `latestAutosaveStore`.
    uiActionRegistry = null;
    // Story 50.3 — clearing registrations + removing the window
    // listener happens via dispose(); the registry's own
    // handlers (inventory etc.) already unregistered via their
    // module dispose(), but dispose() is a belt-and-suspenders
    // guarantee against stale window listeners after teardown.
    runtimeActionRegistry?.dispose();
    runtimeActionRegistry = null;
    // Story 51.2 — clear the active-providers store on teardown
    // so a fresh `start()` reads `null` until plugins resolve
    // again. Subscribers (React + non-React) see the transition
    // back to null and re-render accordingly.
    activeProvidersStore.set(null);
    webAudioAdapter?.dispose();
    webAudioAdapter = null;
    playerEyeHeight = 1.62;

    renderableReconciler?.dispose();
    renderableReconciler = null;

    if (scene) {
      disposeRenderableObject(scene);
    }

    unsubscribeTexturesUpdated?.();
    unsubscribeTexturesUpdated = null;
    renderView?.unmount();
    renderView = null;

    camera = null;
    scene = null;
  }

  function handleResize() {
    if (!camera || !renderView) return;

    const width = root.clientWidth || 1;
    const height = root.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderView.resize(width, height);
  }

  function handlePauseKey(event: KeyboardEvent) {
    // Q toggles the pause menu. Escape is reserved for dismissing other modal
    // UIs (inventory, journal, dialogue, etc.), each of which already owns its
    // own Escape handler — overloading Escape here would double-fire.
    if (event.key.toLowerCase() !== "q") return;
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    // Plan 054 §054.4 Pass A — read the game's lifecycle, not
    // the legacy visibleMenuKey. Q is only meaningful during
    // gameplay (toggles pause) or while paused (resumes); start
    // menu and booting states ignore Q.
    const lifecycle = gameStateStore.getState().lifecycle;
    if (lifecycle === "playing") {
      hostPauseGame();
      emitMenuSoundTransition(null, "pause-menu");
    } else if (lifecycle === "paused") {
      hostResumeGame();
      emitMenuSoundTransition("pause-menu", null);
    }
  }

  function emitMenuSoundTransition(
    previousMenuKey: string | null,
    nextMenuKey: string | null
  ) {
    if (previousMenuKey === nextMenuKey) {
      return;
    }
    if (previousMenuKey !== null) {
      gameplaySession?.audioController.stopInstance("game.menu-open");
      gameplaySession?.audioController.emitEvent("game.menu-close", {
        instanceKey: "game.menu-close"
      });
    }
    if (nextMenuKey !== null) {
      gameplaySession?.audioController.emitEvent("game.menu-open", {
        instanceKey: "game.menu-open"
      });
    }
  }

  function handleVisibilityChange() {
    if (ownerWindow.document.visibilityState === "hidden") {
      webAudioAdapter?.pauseAll();
    } else {
      webAudioAdapter?.resumeAll();
    }
  }

  function renderFrame(now: number) {
    if (
      !world ||
      !cameraState ||
      !camera ||
      !renderView ||
      !scene ||
      !playerVisualController ||
      !inputManager
    ) {
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const smperf = readSmperf();
    const perfOn = smperf.on;
    // Plan 070.1 — apply dev-only A/B toggles (idempotent per frame). Shadows
    // via the WebGPU global shadow switch, landscape via its root visibility,
    // grass compute via the flag RenderView reads in its pre-pass traverse.
    // These run UNCONDITIONALLY (not gated on perfOn): when perf is off
    // readSmperf reports every flag false, so this RESTORES the baseline
    // (shadows on, landscape visible) after a matrix run ends -- gating on
    // perfOn left shadowMap.enabled stuck off until a reboot (070.8 review).
    if (renderView.renderer) {
      renderView.renderer.shadowMap.enabled = !smperf.noShadows;
    }
    renderView.landscapeController.root.visible = !smperf.noLandscape;
    (globalThis as { __smperfNoScatter?: boolean }).__smperfNoScatter =
      smperf.noScatter;

    const pWorldStart = perfOn ? performance.now() : 0;
    world.update(delta);
    const pSessionStart = perfOn ? performance.now() : 0;
    gameplaySession?.update(delta);
    const pSessionEnd = perfOn ? performance.now() : 0;

    for (const snapshot of gameplaySession?.getNpcRuntimeSnapshots() ?? []) {
      const entry = renderableReconciler?.get(snapshot.presenceId);
      if (!entry) {
        continue;
      }
      entry.root.position.set(...snapshot.position);
      // Same two thresholds the player uses below: walk above 0.1 m/s so a
      // slow approach does not flicker between clips, and turn above
      // 0.01 m/s so a standing NPC keeps the facing it was authored with.
      setNpcAnimationSlot(
        entry,
        snapshot.speedMetersPerSecond > 0.1 ? "walk" : "idle"
      );
      if (
        snapshot.headingRadians !== null &&
        snapshot.speedMetersPerSecond > 0.01
      ) {
        entry.root.rotation.y = snapshot.headingRadians;
      }
    }

    // Plan 079.3 -- sync NPC visibility from the presence reconciler each
    // frame. Absent presences (condition not satisfied) get root.visible=false;
    // the three.js group stays resident so the return-to-visible is instant.
    // Runs after gameplaySession.update() so isPresenceActive reflects the
    // current frame's condition evaluation.
    if (gameplaySession && renderableReconciler) {
      for (const entry of renderableReconciler.entries()) {
        if (entry.object.kind === "npc") {
          entry.root.visible = gameplaySession.isPresenceActive(
            entry.object.instanceId
          );
          // A hidden NPC's mixer stops ticking below, so a one-shot on it would
          // never reach `finished` and would hold the NPC out of locomotion for
          // good. End it here instead.
          if (
            !entry.root.visible &&
            npcOneShotIsPlaying(entry.host as HostEntryData)
          ) {
            releaseNpcOneShot(entry.host as HostEntryData);
          }
        }
      }
    }

    // Tick every entry mixer (NPCs with bound idle animations). The
    // mixer is absent for static-mesh assets and for NPCs without
    // animations, so this loop is cheap when nothing's animated.
    // Plan 079.3 -- skip the mixer when the NPC is hidden (saves per-frame
    // bone-hierarchy cost for absent conditional NPCs).
    for (const entry of renderableReconciler?.entries() ?? []) {
      if (entry.root.visible) {
        npcMixer(entry)?.update(delta);
      }
    }

    const playerEntities = world.query(PlayerControlled, Position);
    if (playerEntities.length > 0) {
      const pos = world.getComponent(playerEntities[0], Position)!;
      playerVisualController.root.position.set(pos.x, pos.y, pos.z);
      cameraState.targetY = pos.y + playerEyeHeight;

      // Drive locomotion-cycle animation from horizontal velocity. The
      // controller no-ops if the requested slot's clip isn't bound, so
      // an unconfigured Player just stays in whatever slot was already
      // playing. Threshold of 0.1 m/s catches drift in fully-stopped
      // input but doesn't flicker between idle/walk on slow approach.
      const velocity = world.getComponent(playerEntities[0], Velocity);
      const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
      playerVisualController.setActiveAnimationSlot(
        speed > 0.1 ? "walk" : "idle"
      );

      // Face the model in the direction of motion. Same formula as
      // Sugarengine's RenderSystem (atan2(velocity.x, velocity.z)). Snap
      // rather than smooth — matches what we had before and avoids a
      // separate slerp pass for now. Only update when there's actual
      // movement so standing still keeps the last-faced direction.
      if (velocity && speed > 0.01) {
        playerVisualController.root.rotation.y = Math.atan2(
          velocity.x,
          velocity.z
        );
      }

      playerVisualController.update(delta);

      const { isDragging } = inputManager.getInput();
      cameraState = updateCameraFollow(
        cameraState,
        DEFAULT_CAMERA_CONFIG,
        pos.x,
        pos.z,
        delta,
        isDragging
      );
    }

    // A move is composed for RENDERING ONLY and never written back.
    //
    // Persisting it (which this did at first) gave pitch and distance two
    // writers -- the player, and the move -- and since `request` captures
    // cameraState as the framing to give back, a second request mid-move
    // captured the MOVE's own output as the player's resting framing and the
    // real one was gone for the session. Reachable on ordinary flows:
    // DialogueManager ends and starts in one synchronous block, and a scripted
    // follow-up starts on a microtask, both long before the next frame.
    //
    // cameraState stays the player's framing; the move is an overlay on top.
    const moveSample = cameraState
      ? cameraMoveDirector.update(delta * 1000, CAMERA_MOVE_BOUNDS)
      : null;
    const framedCamera =
      moveSample && cameraState
        ? { ...cameraState, pitch: moveSample.pitch, distance: moveSample.distance }
        : cameraState;

    const camPos = computeCameraPosition(framedCamera);
    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.lookAt(camPos.lookAtX, camPos.lookAtY, camPos.lookAtZ);

    const cameraSnapshot = createCameraSnapshot(
      camera,
      root.clientWidth || 1,
      root.clientHeight || 1
    );
    gameplaySession?.audioController.setListenerPose({
      mode: "player",
      position: playerVisualController
        ? [
            playerVisualController.root.position.x,
            playerVisualController.root.position.y + playerEyeHeight,
            playerVisualController.root.position.z
          ]
        : [camera.position.x, camera.position.y, camera.position.z],
      forward: [
        cameraSnapshot.forward.x,
        cameraSnapshot.forward.y,
        cameraSnapshot.forward.z
      ]
    });
    gameplaySession?.syncBillboards(cameraSnapshot, delta);
    const renderBindings = new Map<number, THREE.Object3D>();
    for (const binding of gameplaySession?.getBillboardBindings() ?? []) {
      if (binding.kind === "player") {
        if (playerVisualController) {
          renderBindings.set(binding.entity, playerVisualController.root);
        }
        continue;
      }

      if (!binding.sceneInstanceId) {
        continue;
      }

      const entry = renderableReconciler?.get(binding.sceneInstanceId);
      if (entry) {
        renderBindings.set(binding.entity, entry.root);
      }
    }
    applyBillboardLodEnforcement({ world, renderBindings });
    billboardRenderer?.update({ world, camera });
    textBillboardRenderer?.update({
      world,
      camera,
      viewportWidth: root.clientWidth || 1,
      viewportHeight: root.clientHeight || 1
    });

    if (renderableReconciler) {
      ensureShaderSetsAppliedToRenderables(
        renderableReconciler.entries(),
        renderView.shaderRuntime,
        currentAssetSources
      );
    }

    const pRenderStart = perfOn ? performance.now() : 0;
    renderView.setCamera(camera);
    renderView.render();
    if (perfOn) {
      const pRenderEnd = performance.now();
      perfWorldMs += pSessionStart - pWorldStart;
      perfSessionMs += pSessionEnd - pSessionStart;
      // render-CPU = JS submission (scatter pre-pass traverse + pipeline
      // submit). On WebGPU the GPU work overlaps the next frame, so the
      // GPU/vsync cost shows up as (frame - all CPU), not in this number.
      perfRenderCpuMs += pRenderEnd - pRenderStart;
      perfFrameMs += delta * 1000;
      perfFrames += 1;
      if (now - perfLastLogMs > 1000) {
        const n = Math.max(perfFrames, 1);
        const frame = perfFrameMs / n;
        const worldMs = perfWorldMs / n;
        const sessionMs = perfSessionMs / n;
        const renderCpuMs = perfRenderCpuMs / n;
        // Everything not accounted for by update + render-submit: billboard
        // sync, the ensure loop, camera-snapshot allocs, and GPU/vsync wait.
        const gpuRestMs = frame - worldMs - sessionMs - renderCpuMs;
        const suffix =
          (smperf.noShadows ? " -shadows" : "") +
          (smperf.noScatter ? " -scatter" : "") +
          (smperf.noLandscape ? " -landscape" : "");
        console.info(
          `[smperf] frame ${frame.toFixed(1)}ms (~${(1000 / frame).toFixed(0)}fps) | world ${worldMs.toFixed(2)} | session ${sessionMs.toFixed(2)} | render-cpu ${renderCpuMs.toFixed(2)} | gpu+rest ${gpuRestMs.toFixed(1)}${suffix}`
        );
        publishSmperfStats({
          frameMs: Number(frame.toFixed(2)),
          fps: Number((1000 / frame).toFixed(1)),
          worldMs: Number(worldMs.toFixed(3)),
          sessionMs: Number(sessionMs.toFixed(3)),
          renderCpuMs: Number(renderCpuMs.toFixed(3)),
          gpuRestMs: Number(gpuRestMs.toFixed(2))
        });
        perfWorldMs = 0;
        perfSessionMs = 0;
        perfRenderCpuMs = 0;
        perfFrameMs = 0;
        perfFrames = 0;
        perfLastLogMs = now;
      }
    }

    debugHud?.update(delta);

    inputManager.endFrame();

    animationId = ownerWindow.requestAnimationFrame(renderFrame);
  }

  async function start(state: WebRuntimeStartState): Promise<void> {
    // Plan 070.1 — wall-clock the whole boot (the PREVIEW_BOOT reboot cost).
    const bootStart = ownerWindow.performance.now();
    if (!started) {
      started = true;
      ownerWindow.addEventListener("resize", handleResize);
      ownerWindow.addEventListener("beforeunload", dispose);
      ownerWindow.addEventListener("keydown", handlePauseKey);
      ownerWindow.document.addEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    }

    disposeRuntime();
    // Plan 070.1 — expose the self-driving A/B capture on the preview window.
    (ownerWindow as unknown as { __smperfRun?: typeof runSmperfMatrix }).__smperfRun =
      runSmperfMatrix;
    (ownerWindow as unknown as { __smquestDebug?: typeof smQuestDebug }).__smquestDebug =
      smQuestDebug;
    (ownerWindow as unknown as { __smsetflag?: typeof smSetFlag }).__smsetflag =
      smSetFlag;
    // Post-process diagnostics. Every failure mode in that stack is silent --
    // a fallen-back render graph, a dropped binding, and a throwing shader all
    // look identical to "my settings do nothing" -- so expose what actually
    // got applied rather than requiring a console autopsy.
    (
      ownerWindow as unknown as { __smPostProcessDiag?: () => unknown }
    ).__smPostProcessDiag = () => {
      if (!renderView) return { error: "no render view mounted" };
      return {
        hasRenderer: Boolean(renderView.renderer),
        hasRenderPipeline: Boolean(renderView.renderPipeline),
        baseOutputNodePresent: Boolean(
          renderView.renderPipeline?.getBaseOutputNode()
        ),
        report: renderView.lastPostProcessReport
      };
    };
    currentAssetSources = state.assetSources;
    webAudioAdapter = new WebAudioAdapter({
      ownerWindow,
      root,
      logger: console
    });
    webAudioAdapter.syncProject({
      contentLibrary: state.contentLibrary,
      assetSources: state.assetSources,
      mixer: state.audioMixer
    });

    // Story 47.10 boot-ordering follow-up — plugin bootstrap +
    // provider resolution run BEFORE region resolution and player
    // spawn so callers can defer the save read via
    // `state.savedGamePromise`. SugarProfile's runtime contributes
    // the Supabase identity + save store via this resolver; once
    // they're picked, `onProvidersResolved` fires and App.tsx
    // (preview.tsx) can `await active.saveStore.load(userId)` and
    // pipe the result back through the savedGamePromise so the
    // host hydrates from the correct (cloud) save.
    const pluginManager = createResolvedRuntimePluginManager(
      adapter.boot,
      state.installedPluginIds,
      state.pluginConfigurations,
      state.pluginRuntimeEnvironment ?? {},
      state.pluginBootPayloads ?? {}
    );
    activePluginManager = pluginManager;
    // Whatever the plugins declared they keep in the save. Registered here,
    // right after construction and before the first deserialize pass, so a
    // plugin's own state is restored by the time it binds. The host does not
    // look inside any of them.
    for (const participant of pluginManager.getSaveParticipants()) {
      saveParticipantRegistry.register(participant);
    }
    bootPreNewGameStepAnswers = state.preNewGameStepAnswers ?? {};
    if (Object.keys(bootPreNewGameStepAnswers).length > 0) {
      // The only observable for the handshake in a published build: the debug
      // HUD is Studio-only and the window handles are dev-only.
      console.info(
        "[web-runtime] pre-new-game answers carried into this boot:",
        bootPreNewGameStepAnswers
      );
    }
    // Plan 061 §061.3 — the Exit affordance's target. Only
    // meaningful when SugarProfile is enabled (the Play page is
    // where its auth lives), so reading it from that plugin's
    // config is deliberate.
    const sugarProfileConfiguration = state.pluginConfigurations.find(
      (configuration) =>
        configuration.pluginId === SUGARPROFILE_PLUGIN_ID &&
        configuration.enabled
    );
    bootPlayPageUrl = sugarProfileConfiguration
      ? normalizeSugarProfilePluginConfig(sugarProfileConfiguration.config)
          .playPageUrl
      : "";
    if (state.fallbackIdentityProvider && state.fallbackSaveStore) {
      const resolvedIdentity = resolveActiveIdentityProvider(
        pluginManager,
        state.fallbackIdentityProvider
      );
      const resolvedSaveStore = resolveActiveGameSaveStore(
        pluginManager,
        state.fallbackSaveStore
      );
      // Story 47.9.5 — wire the active identity provider into the
      // module-level access-token registry so gateway-routed clients
      // (SugarAgent etc.) read the live access token per request.
      registerActiveIdentityProvider(resolvedIdentity);
      // Plan 092.6.3 — start reconciling per-account stores now that an
      // account exists. Started AFTER the identity registration above,
      // because the stores key on the account and the first pass is what
      // brings a returning player's data back.
      //
      // A null remote is a working configuration, not a failure: with no
      // plugin contributing a backend, every account store keeps serving
      // reads and writes locally and simply never leaves the device.
      //
      // STUDIO PREVIEW NEVER SYNCS. Preview runs this same host, and the
      // project it previews is configured against the REAL backend -- so
      // without this guard every word learned while authoring would be written
      // into the live database as if a player had learned it. There is no
      // separate development backend to point it at yet. Preview therefore
      // reads and writes locally and reconciles with nothing, which is also
      // what an author wants: throwaway state that does not follow them.
      const syncsToBackend = adapter.boot.hostKind === "published-web";
      accountDataSync?.stop();
      accountDataSync = createSyncEngine({
        remote: syncsToBackend
          ? resolveActiveRemoteRecordStorageAdapter(pluginManager)
          : null,
        ownerWindow
      });

      // OPEN PER-ACCOUNT STORAGE BETWEEN BUILDING THE LOOP AND STARTING IT
      // (Plan 092.6.3).
      //
      // The first pass below is what the boot screen waits for, and it can only
      // reconcile stores that exist when it runs. Plugins used to open theirs in
      // `init`, which needs the world and therefore happens after boot is over
      // -- so the awaited pass reconciled an empty list, and the learner's store
      // was built later, on the first conversation, reading empty on a device
      // where the player already had a history.
      //
      // AFTER `createSyncEngine`, not before: a store that registers while no
      // loop exists is told nothing will ever sync it, and ends its first-sync
      // wait on the spot. Building the loop first means these stores wait for a
      // pass that is actually coming.
      //
      // Awaited: a store opened after the pass starts has missed it.
      await pluginManager.openAccountStorage({
        preNewGameStepAnswers: bootPreNewGameStepAnswers
      });

      // Kicked off HERE and awaited further down, so the first pull overlaps
      // asset preloading instead of being serialised behind it.
      firstSyncPass = accountDataSync.start();
      // Story 47.10 follow-up — track the resolved user live so the
      // Session debug HUD card's User / Anon rows reflect sign-in /
      // sign-out instead of being frozen at the boot-time user.
      identityUnsubscribe?.();
      userStore.set(resolvedIdentity.currentUser());
      identityUnsubscribe = resolvedIdentity.onChange((next) => {
        userStore.set(next);
      });
      // Story 51.2 — push the resolved pair into the host's
      // observable store BEFORE the back-compat callback fires.
      // Subscribers via `host.state.activeProviders.subscribe`
      // (useSyncExternalStore in React) pick it up; the legacy
      // callback path continues to fire in parallel so any
      // unmigrated consumer still works. The callback retires
      // when all call sites have migrated (see Plan 051
      // `Deferred` for the trigger condition).
      activeProvidersStore.set({
        identityProvider: resolvedIdentity,
        saveStore: resolvedSaveStore
      });
      state.onProvidersResolved?.({
        identityProvider: resolvedIdentity,
        saveStore: resolvedSaveStore
      });
    }

    // Story 47.10 boot-ordering follow-up — await the caller-
    // supplied save promise (or fall back to the eagerly-provided
    // savedGame for back-compat). Resolves to the GameSave the host
    // should use for region + player spawn. The wait is the boot
    // overlay's job to mask; once this resolves we proceed to scene
    // setup and region resolution.
    const resolvedSavedGame: GameSave | null =
      state.savedGame ??
      (state.savedGamePromise ? await state.savedGamePromise : null);

    // Plan 092.6 — ONE readiness phase, not two.
    //
    // A returning player's data has to be here before they can use it: reach a
    // conversation before it lands and the game teaches words they already
    // know, then corrects itself minutes later with nothing to show it was
    // ever wrong. That is the same requirement the asset preload already
    // exists to meet, so it is the same phase -- one deadline, one progress
    // readout, one answer to "is this game ready". It was briefly a separate
    // wait with its own timeout and no presence on the loading screen, which
    // meant the two could disagree about ready and only one of them told
    // anybody.
    //
    // Counted as one unit of work alongside the assets so the loading screen
    // can say what it is waiting for.
    const pendingSync = firstSyncPass;
    firstSyncPass = null;
    const syncUnits = pendingSync ? 1 : 0;
    // Plugins getting ready before the first frame are one more unit of this
    // SAME phase. The work itself can only start after the save restore below
    // (see the kickoff there), but it closes behind the same overlay, the same
    // deadline, and the same stall prompt as everything else. It is a unit
    // here so the readout never jumps backwards when it joins.
    const pluginUnits = 1;
    let assetsLoaded = 0;
    let assetsTotal = 0;
    let syncDone = 0;
    let pluginsReadyDone = 0;
    const publishProgress = () =>
      assetPreloadStore.set({
        loaded: assetsLoaded + syncDone + pluginsReadyDone,
        total: assetsTotal + syncUnits + pluginUnits
      });

    assetPreloadStore.set({ loaded: 0, total: syncUnits + pluginUnits });
    const readiness = Promise.all([
      preloadAssetSources(state.assetSources, {
        onProgress: (progress) => {
          assetsLoaded = progress.loaded;
          assetsTotal = progress.total;
          publishProgress();
        }
      }),
      pendingSync
        ? pendingSync.then(() => {
            syncDone = 1;
            publishProgress();
          })
        : Promise.resolve()
    ]);

    // NOT AWAITED HERE. The world below is built while these downloads run --
    // the preload is fetch-into-HTTP-cache with no in-memory handoff, so
    // nothing in assembly construction needs it finished, and the render loop
    // does not start until the single gate further down closes. Building the
    // world first is also what lets the plugin-readiness unit (a ~10s Teacher
    // call that needs the restored save) overlap the downloads instead of
    // being serialised behind them.
    //
    // The stall clock starts NOW, not at the gate: the player has been looking
    // at the loading screen since the line above, and that is the wait being
    // bounded.
    let bootReadySettled = false;
    const stallPrompt = new Promise<void>((resolve) => {
      ownerWindow.setTimeout(() => {
        if (bootReadySettled) {
          resolve();
          return;
        }
        console.warn(
          `[web-runtime] still loading after ${BOOT_READINESS_TIMEOUT_MS}ms; asking the player.`
        );
        // Resolved by the player choosing to start anyway; the boot finishing
        // first wins the race at the gate regardless.
        startAnyway = resolve;
        bootStallStore.set({ waitedMs: BOOT_READINESS_TIMEOUT_MS });
      }, BOOT_READINESS_TIMEOUT_MS);
    });

    scene = new THREE.Scene();
    if (ownerWindow.getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    billboardAssetRegistry = new BillboardAssetRegistry({
      ownerWindow,
      logger: {
        warn(message, payload) {
          console.warn("[web-runtime] billboard-asset", {
            message,
            ...(payload ?? {})
          });
        }
      }
    });
    billboardRenderer = new BillboardRenderer({
      scene,
      registry: billboardAssetRegistry
    });
    textBillboardRenderer = new TextBillboardRenderer({ parent: root });

    camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_CONFIG.fov,
      root.clientWidth / Math.max(root.clientHeight, 1),
      0.1,
      1000
    );

    renderView = createRenderView({
      engine,
      scene,
      camera,
      compileProfile: request.compileProfile,
      logger: {
        warn(message: string, payload?: Record<string, unknown>) {
          console.warn("[web-runtime] shader-runtime", {
            message,
            ...(payload ?? {})
          });
        },
        debug(message: string, payload?: Record<string, unknown>) {
          console.debug("[web-runtime] shader-runtime", {
            message,
            ...(payload ?? {})
          });
        }
      }
    });

    // Dev-only debug handle. Lets perf/debug tooling (the perf-harness
    // CDP drivers) attach to a running preview and inspect the live
    // scene/engine without any app spelunking. Dev build only -- never
    // present in a published artifact. See packages/perf-harness.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      (globalThis as { __sugarmagicDebug?: unknown }).__sugarmagicDebug = {
        engine,
        get renderView() {
          return renderView;
        },
        get scene() {
          return renderView?.scene ?? null;
        }
      };
    }

    // Painted-mask grass on assets is placed at build time from the
    // mask PIXELS; the PNG decodes async, so the first build sees an
    // empty mask. When a texture loads, invalidate scatter-bearing
    // renderables so the per-frame ensure pass rebuilds their grass
    // with the now-ready mask (Plan 068.11).
    unsubscribeTexturesUpdated = renderView.subscribeTexturesUpdated(() => {
      for (const entry of renderableReconciler?.entries() ?? []) {
        // Surface-brushed grass lives in a surface-ref layer's NESTED
        // scatter, not a bare `scatter` layer, so use the same detector
        // the instancing partition uses (checks scatter AND surface-ref).
        // The old inline scatter-only check missed the Surface Brush --
        // the headline feature -- so its painted-mask grass never
        // rebuilt when the PNG decoded and stayed empty on fresh load.
        if (!objectSurfaceHasScatter(entry.object)) {
          continue;
        }
        entry.shaderApplication.appliedShaderSignature = null;
        entry.shaderApplication.appliedFileSources = null;
      }
    });

    // Plan 055 §055.3 — spawn state hydrates through the
    // participant pipeline. Seed precedence: real save wins,
    // then the project's `defaultGameSavePayload` (a fresh-start
    // record an author can curate), then null (implicit
    // boot.json / playerPresence defaults). Whichever is picked
    // feeds `upgradeLegacyPayload` so pre-055 legacy shape and
    // post-055 new shape both normalize into slices, then
    // deserializeAll dispatches to every registered participant
    // BEFORE any world/player spawn work. Host-owned tier
    // (host.player) restores first so region + position are
    // ready when spawn resolution reads them below.
    const seedPayload =
      resolvedSavedGame?.payload ?? state.defaultGameSavePayload ?? null;
    const upgradedPayload = seedPayload
      ? upgradeLegacyPayload(seedPayload)
      : null;
    // Plan 055 §055.4 + §055.6 — Phase 1: dispatch host-owned +
    // region-aware tier participants. `host.player` (host-owned)
    // restores here before spawn; `world.presence` (region-aware)
    // restores here too because `gameplayAssembly`'s
    // `registerItemInteractables` consults it during
    // construction to skip already-collected item presences.
    // Phase 2 (default tier: quest.manager, inventory.player)
    // runs later, AFTER `gameplayAssembly` is constructed and
    // those subsystems exist for their participants to reach.
    const restoredSlices = upgradedPayload?.slices ?? {};
    saveParticipantRegistry.deserializeAll(restoredSlices, [
      "host-owned",
      "region-aware"
    ]);
    // hostPlayerRestore now reflects whatever the host.player
    // participant received. Region precedence (identical for
    // Preview and published boots — Preview is the game):
    // saved region (Continue) > the active Scene's authored
    // starting region > legacy boot activeRegionId > first.
    const resolvedActiveRegionId = hostPlayerRestore?.currentRegionId ?? null;
    activeRegionIdForSave =
      typeof resolvedActiveRegionId === "string" ? resolvedActiveRegionId : null;
    // Plan 058 §058.1 — belt-and-suspenders migration for stale
    // pre-058 boot payloads (regions carrying legacy `scene`
    // nests, no `scenes` array). Idempotent no-op on current
    // payloads.
    const migratedContent = migrateToScenes({
      scenes: state.scenes ?? [],
      regions: state.regions
    });
    bootScenes = migratedContent.scenes;
    // Plan 058 §058.4 — Pattern 3 (Filtered Composition at
    // Runtime): evaluate unlock conditions against the restored
    // save, then pick the boot Scene. Precedence: saved
    // currentSceneId > Studio Preview's ambient selection > first
    // unlocked by order. questComplete conditions read the
    // quest.manager slice's raw data here because unlock
    // evaluation happens in Phase 1, before the quest system
    // exists (Phase 2) — a deliberate cross-slice READ of plain
    // save data, not a reach into another system.
    manuallyUnlockedSceneIds = [...(campaignRestore?.unlockedSceneIds ?? [])];
    completedSceneIds = [...(campaignRestore?.completedSceneIds ?? [])];
    const questSliceData = restoredSlices[QUEST_MANAGER_PARTICIPANT_ID]
      ?.data as { completedQuestIds?: string[] } | undefined;
    const unlockedSceneIds = resolveUnlockedSceneIds({
      scenes: migratedContent.scenes,
      manuallyUnlockedSceneIds,
      completedQuestIds: questSliceData?.completedQuestIds ?? [],
      // Runtime read at the seam — never persisted (the
      // no-wallclock rule applies to slices, not boot evaluation).
      now: Date.now()
    });
    const activeScene = resolveActiveScene({
      scenes: migratedContent.scenes,
      unlockedSceneIds,
      requestedSceneId:
        campaignRestore?.currentSceneId ?? state.activeSceneId ?? null
    });
    activeSceneIdForSave = activeScene?.sceneId ?? null;
    // Plan 059 §059.4 — Episodes screen view model. Forward-only
    // v1: only the frontier ("current") card is enterable.
    bootEpisodesViewModel = {
      scenesUiLabel: state.scenesUiLabel ?? "Scene",
      entries: [...migratedContent.scenes]
        .sort((left, right) => left.sceneOrder - right.sceneOrder)
        .map((scene) => ({
          sceneId: scene.sceneId,
          displayName: scene.displayName,
          description: scene.description,
          status:
            scene.sceneId === activeSceneIdForSave
              ? ("current" as const)
              : completedSceneIds.includes(scene.sceneId)
                ? ("completed" as const)
                : unlockedSceneIds.has(scene.sceneId)
                  ? ("unlocked" as const)
                  : ("locked" as const)
        }))
    };
    const activeRegion = getActiveRegion(
      migratedContent.regions,
      resolvedActiveRegionId ??
        activeScene?.startingRegionId ??
        state.activeRegionId ??
        null
    );
    // Composed Base + Overlay view (Pattern 1) — every presence /
    // spawn read below sources from this, never region fields.
    const activeRegionContents = activeRegion
      ? composeRegionContents(activeRegion, activeScene)
      : null;
    // Plan 059 §059.1 — music resolution. In-game: the Scene's
    // audioOverride shadows the project default; null = silence
    // (the intended default — BotW model, sounds cued by
    // actions). Menu: its own slot, playing over the start menu
    // and returning on quit-to-menu. (Closes Plan 058's
    // audioOverride deferral.)
    sceneMusicCueIdForSession =
      activeScene?.audioOverride?.backgroundMusicId ??
      state.musicBindings?.defaultBackgroundMusicId ??
      null;
    menuMusicCueIdForSession = state.musicBindings?.menuMusicId ?? null;
    // Plan 059 §059.3 — exit/entry sequence inputs.
    creditsThemeCueIdForSession =
      state.musicBindings?.creditsThemeMusicId ?? null;
    bootCreditsDefinition = state.creditsDefinition ?? null;
    bootGameTitle = state.gameTitle ?? null;
    // Plan 092.6 — registered BEFORE anything opens storage. Every database
    // name on the player's device leads with it, and the helper that builds
    // those names throws without it rather than sharing an origin's storage
    // between two games.
    registerActiveGameId(state.gameId ?? null);
    // Plan 058 §058.4 — per-Scene environment override: the
    // projector reads state.activeEnvironmentId, so a Scene with
    // an override shadows the authored/boot value; null falls
    // through untouched.
    renderEngineProjector.push(
      activeScene?.environmentOverride
        ? {
            ...state,
            activeEnvironmentId: activeScene.environmentOverride.environmentId
          }
        : state,
      activeRegion
    );
    const landscapeApplyResult = renderView.landscapeController.applyLandscape(
      activeRegion?.landscape ?? null,
      state.contentLibrary,
      state.assetSources
    );
    // Preview-vs-editor divergence breadcrumb: which region's landscape
    // the game actually applied, and any warnings the controller
    // returned (previously swallowed).
    console.info("[web-runtime] landscape-apply", {
      regionId: activeRegion?.identity.id ?? null,
      hasLandscape: Boolean(activeRegion?.landscape),
      surfaceSlots: (activeRegion?.landscape?.surfaceSlots ?? []).map(
        (slot) => `${slot.displayName}:${slot.surface?.kind ?? "none"}`
      ),
      warnings: landscapeApplyResult.warnings
    });
    for (const warning of landscapeApplyResult.warnings) {
      console.warn("[web-runtime] landscape-apply warning", warning);
    }

    // Plan 069.2 — the collision world, built once per start from the
    // resolved scene objects (rebuild-on-start covers region/scene switches
    // and preview live edits). Populated inside the activeRegion block
    // below; consumed by the CollisionSystem registered after MovementSystem.
    let collisionWorld = createEmptyCollisionWorld();
    // Plan 069.9 — the baked navmesh pathfinder, loaded async from the
    // artifact blob; NPCs follow it once ready (straight-line until then, and
    // forever in unbaked regions). Outer-scoped so teardown frees it.
    navMeshPathfinder?.destroy();
    navMeshPathfinder = null;
    const navMeshEpoch = ++navMeshLoadEpoch;
    if (activeRegion) {
      const region = activeRegion;
      const objects = resolveSceneObjects(region, {
        contentLibrary: state.contentLibrary,
        playerDefinition: state.playerDefinition,
        itemDefinitions: state.itemDefinitions,
        npcDefinitions: state.npcDefinitions,
        includePlayerPresence: false,
        activeScene
      });
      // Plan 069.5 — blocker / containment volumes join the collision world
      // alongside the prop colliders (conditional gates refreshed per frame
      // by the gameplay session, which holds the same world by reference).
      collisionWorld = buildCollisionWorld(objects, resolveRegionVolumes(region));
      // Plan 069.9 — resolve the navmesh artifact blob (published to the
      // asset-source store at bake) and load a pathfinder off the main path.
      const navMeshUrl = region.navMesh
        ? state.assetSources[region.navMesh.assetPath]
        : undefined;
      if (navMeshUrl) {
        void (async () => {
          try {
            const response = await fetch(navMeshUrl);
            // A miss on a static host answers with an HTML error page, and
            // importNavMesh accepts those bytes silently -- then the first
            // path query crashes the WASM and kills the frame loop. Treat a
            // non-OK response as "no navmesh" (straight-line fallback).
            if (!response.ok) {
              console.warn(
                `[web-runtime] navmesh artifact fetch failed (${response.status}) -- NPCs fall back to straight-line steering`,
                navMeshUrl
              );
              return;
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            const pathfinder = await loadNavMeshPathfinder(bytes);
            // A newer start() superseded this load — free it, don't assign
            // (else we'd overwrite the current mesh + leak the new one).
            if (navMeshEpoch !== navMeshLoadEpoch) {
              pathfinder.destroy();
              return;
            }
            navMeshPathfinder = pathfinder;
          } catch (error) {
            console.warn("[web-runtime] navmesh load failed", error);
          }
        })();
      }
      // Plan 057 — item presences run through the shared filter
      // helper so this visual-spawn path and the ECS spawn path
      // in gameplay-session apply the same filter set. New
      // filters (Plan 058 Scene gating, etc.) compose into
      // `worldPresenceTracker.shouldSkip` at the host and both
      // paths see them automatically. Non-item scene objects
      // (NPCs, static assets) don't have a filter surface today
      // and pass through unchanged.
      const activeItemPresenceIds = new Set<string>();
      iterateActiveItemPresences(
        activeRegionContents?.itemPresences ?? [],
        {
          shouldSkip: (presenceId) =>
            worldPresenceTracker.shouldSkip(
              activeRegionIdForSave,
              activeSceneIdForSave,
              presenceId
            )
        },
        (presence) => {
          activeItemPresenceIds.add(presence.presenceId);
        }
      );
      // Plan 070.2 — one shared reconciler builds every scene renderable
      // (was two hand-rolled paths here: instanced grouping by
      // representationKey + the singleton clone/sanitize/scale/shadow/
      // parent/shader sequence). Grouping ON for the game; the studio keeps
      // it OFF until 070.6. Items are visual-filtered (Plan 057); the player
      // is excluded upstream (includePlayerPresence: false).
      renderableReconciler = createRenderableReconciler({
        parent: scene,
        resolveUrl: (object) =>
          object.modelSourcePath
            ? renderView!.assetResolver.resolveAssetUrl(
                object.modelSourcePath
              ) ?? null
            : null,
        loadModel: (url) => gltfLoader.loadAsync(url).then((gltf) => gltf.scene),
        createFallback: (object) => getSceneObjectFallback(object),
        shaderRuntime: renderView!.shaderRuntime,
        getFileSources: () => currentAssetSources,
        enableShadows: (renderableRoot) =>
          renderView!.enableShadowsOnObject(renderableRoot),
        grouping: true,
        isInstanceable: assetObjectIsInstanceable,
        validate: validateRenderableAsset,
        logger: {
          warn: (message, payload) =>
            console.warn(`[web-runtime] ${message}`, payload)
        },
        // The mixer goes away with the entry, so a one-shot listener on it must
        // come off first. This is the hook's first consumer.
        onEntryWillRemove: (entry) =>
          releaseNpcOneShot(entry.host as HostEntryData),
        onEntryLoaded: (entry, renderable) => {
          // An NPC gets one AnimationMixer plus every clip bound to it, kept
          // in the entry's host slot. The frame loop ticks the mixer via
          // npcMixer() and swaps slots with setNpcAnimationSlot().
          if (entry.object.kind !== "npc") {
            return;
          }
          const presence = activeRegionContents?.npcPresences.find(
            (p) => p.presenceId === entry.object.instanceId
          );
          const npcDefinition = presence
            ? state.npcDefinitions.find(
                (d) => d.definitionId === presence.npcDefinitionId
              )
            : null;
          const bindings = npcDefinition?.presentation.animationAssetBindings;
          if (!bindings) {
            return;
          }
          const slotSources = (
            Object.entries(bindings) as Array<[NPCAnimationSlot, string | null]>
          ).flatMap(([slot, bindingId]) => {
            const animDef = bindingId
              ? getCharacterAnimationDefinition(state.contentLibrary, bindingId)
              : null;
            const sourceUrl = animDef
              ? state.assetSources[animDef.source.relativeAssetPath] ?? null
              : null;
            return sourceUrl ? [{ slot, sourceUrl }] : [];
          });
          if (slotSources.length === 0) {
            return;
          }
          void Promise.all(
            slotSources.map(({ slot, sourceUrl }) =>
              gltfLoader
                .loadAsync(sourceUrl)
                .then((animGltf) => ({ slot, clip: animGltf.animations[0] ?? null }))
                .catch((error) => {
                  // One unreadable clip must not cost the NPC the others: a
                  // missing walk should leave it idling, not standing in its
                  // bind pose.
                  console.error("[web-runtime] npc-animation-load-failed", {
                    instanceId: entry.object.instanceId,
                    slot,
                    sourceUrl,
                    error
                  });
                  return { slot, clip: null };
                })
            )
          ).then((loaded) => {
            const clips = new Map<NPCAnimationSlot, THREE.AnimationClip>();
            for (const { slot, clip } of loaded) {
              if (clip) {
                clips.set(slot, clip);
              }
            }
            if (clips.size === 0) {
              return;
            }
            const host = entry.host as HostEntryData;
            host.mixer = new THREE.AnimationMixer(renderable);
            host.animationClips = clips;
            // Start idle where it exists, otherwise whatever is bound, so an
            // NPC with only a walk clip still animates instead of freezing.
            setNpcAnimationSlot(
              entry,
              clips.has("idle") ? "idle" : [...clips.keys()][0]!
            );
          })
          .catch((error) => {
            // Mixer construction and slot selection run after the loads
            // resolve, so their failures land here rather than in the
            // per-clip catch above. A player mid-session keeps playing with
            // an unanimated NPC.
            console.error("[web-runtime] npc-animation-bind-failed", {
              instanceId: entry.object.instanceId,
              error
            });
          });
        }
      });
      renderableReconciler.reconcile(
        objects.filter(
          (object) =>
            object.kind !== "item" ||
            activeItemPresenceIds.has(object.instanceId)
        )
      );
    }
    world = new World();
    uiContextStore = createUIContextStore();
    // Story 47.10.5 — the store always boots in the same "no
    // menu, not paused" baseline; whether the start menu opens at
    // boot is a separate decision routed through `showStartMenu()`
    // below so the boot path and the mid-session re-open path
    // share ONE function. Single source of truth — if the menu
    // key ever changes there's one place to update; if the
    // showStartMenu logic ever grows (audio sweep, telemetry,
    // analytics), both paths get it for free.
    // Plan 054 §054.3 — `uiStateStore` lives for the host's
    // lifetime; start() resets it to the boot-time defaults
    // (savePresent depends on whether boot loaded a save).
    uiStateStore.setState({
      activeOverlayMenuKey: null,
      // Boot-time save presence. The Continue button on the
      // start menu reads this through the `visibility: "hasSave"`
      // rule. Flips true on autosave write
      // (notifyAutosaveWritten) and back to false on
      // start-new-game.
      savePresent: resolvedSavedGame != null,
      loginModalOpen: false
    });
    // Story 50.3 — create the central keyboard action registry
    // immediately after the state store; both share the same
    // lifecycle (one per host.start() invocation).
    runtimeActionRegistry = createRuntimeActionRegistry({
      stateStore: uiStateStore,
      gameStateStore
    });
    // Paper cut #2 (docs/backlog/003-runtime-paper-cuts.md) —
    // decision extracted into `pickBootLifecycle` so the four-
    // case truth table is unit-testable. Pre-055.7 the "else"
    // branch here was missing, silently leaving lifecycle at
    // "booting" for fresh-start / no-menu boots. Movement +
    // E-interact bypass the mode gate so the bug looked
    // cosmetic; only mode-gated keys (dialogue Enter/Escape,
    // inventory `i`, quest journal) were dead.
    const bootLifecycle = pickBootLifecycle({
      startMenuExists: state.menuDefinitions.some(
        (menu) => menu.menuKey === "start-menu"
      ),
      skipStartMenuOnBoot: state.skipStartMenuOnBoot ?? false
    });
    if (bootLifecycle === "start-menu") {
      showStartMenu();
      // Plan 059 §059.4 — "Back to Episodes" after the finale's
      // credits: land on the start menu with Episodes opened.
      if (consumeOpenEpisodesFlag()) {
        uiStateStore.setState({ episodesOpen: true });
      }
    } else {
      gameStateStore.setState({ lifecycle: "playing" });
    }
    // Plan 059 §059.3 — entry title sequence (game title -> Scene
    // title) over the fresh boot, ONLY when the reload was a
    // Scene entry (advance or, later, Episodes-menu play). Plain
    // Continue / hard refresh boots without the marker and goes
    // straight to gameplay — titles never replay mid-Scene.
    if (consumeSceneEntryFlag()) {
      void showEntryTitleSequence(ownerWindow.document, {
        gameTitle: bootGameTitle,
        sceneCard: activeScene?.transitionConfig ?? null
      });
    }
    uiActionRegistry = createUIActionRegistry();
    registerDefaultUIActions(uiActionRegistry, {
      stateStore: uiStateStore,
      // Plan 054 §054.4 — all lifecycle ui-actions delegate to
      // the host. ui-actions doesn't touch `stateStore` for
      // start/continue/pause/resume/quit anymore; the host owns
      // those transitions.
      transitions: {
        startNewGame: hostStartNewGame,
        continueGame: hostContinueGame,
        pauseGame: hostPauseGame,
        resumeGame: hostResumeGame,
        quitToMenu: hostQuitToMenu
      },
      // gameplaySession is assigned later in this same start() call; the
      // closures capture the live binding so dispatch (post-boot) sees it.
      onToggleInventory: () => gameplaySession?.toggleInventory(),
      onToggleCaster: () => gameplaySession?.toggleCaster(),
      // Plan 061 §061.3 — force-save first (same respect for
      // progress as the Scene-advance exit), then leave for the
      // site. No reload dance: navigation replaces the document.
      onExitToSite: () => {
        if (bootPlayPageUrl.length === 0) return;
        void (async () => {
          try {
            const exitBindings = activeProvidersStore.getSnapshot();
            const exitUser = exitBindings?.identityProvider.currentUser();
            const exitPayload = getCurrentSavePayload();
            if (exitBindings && exitUser && exitPayload) {
              await exitBindings.saveStore.save(exitUser.userId, {
                userId: exitUser.userId,
                lastPlayed: new Date().toISOString(),
                schemaVersion: GAME_SAVE_SCHEMA_VERSION,
                writtenByVersion: SUGARMAGIC_VERSION,
                payload: exitPayload
              });
            }
          } catch (error) {
            console.warn(
              "[web-runtime] exit-to-site force-save failed; leaving anyway.",
              error
            );
          }
          ownerWindow.location.href = bootPlayPageUrl;
        })();
      }
    });
    world.addSystem(
      new UIContextSystem({
        contextStore: uiContextStore,
        stateStore: uiStateStore,
        gameStateStore,
        getRegion: () =>
          activeRegion
            ? { id: activeRegion.identity.id, name: activeRegion.displayName }
            : null
      })
    );
    console.info("[web-runtime] plugin-bootstrap", {
      installedPluginIds: state.installedPluginIds,
      pluginConfigurations: state.pluginConfigurations.map((configuration) => ({
        pluginId: configuration.pluginId,
        enabled: configuration.enabled,
        // Story 47.10 verify — log the per-game config so we can
        // see whether an enabled plugin actually carries the values
        // that drive its contribution decisions (e.g. SugarProfile's
        // enableLogin + supabaseUrl + supabaseAnonKey).
        config: configuration.config
      })),
      runtimePluginIds: pluginManager
        .getPlugins()
        .map((plugin) => plugin.pluginId),
      identityProviderContributions: pluginManager
        .getContributions("identity.provider")
        .map((contribution) => ({
          pluginId: contribution.pluginId,
          contributionId: contribution.contributionId,
          providerId: contribution.payload.providerId,
          priority: contribution.priority
        })),
      saveStoreContributions: pluginManager
        .getContributions("save.store")
        .map((contribution) => ({
          pluginId: contribution.pluginId,
          contributionId: contribution.contributionId,
          storeId: contribution.payload.storeId,
          priority: contribution.priority
        })),
      conversationProviderContributionIds: pluginManager
        .getContributions("conversation.provider")
        .map((contribution) => contribution.payload.providerId)
    });
    // Plan 055 §055.3 — playerPosition now comes from the
    // host.player participant's restored slice (which itself
    // came from either the real save or the authored default
    // via upgradeLegacyPayload). Null falls through to the
    // region's playerPresence default (spawnRuntimePlayerEntity
    // handles that when positionOverride is null).
    const playerSpawn = spawnRuntimePlayerEntity(
      world,
      // Plan 058 §058.1 — authored spawn point comes from the
      // composed Scene overlay, not the region document.
      activeRegionContents?.playerPresence ?? null,
      state.playerDefinition,
      state.mechanics,
      {
        positionOverride: hostPlayerRestore?.playerPosition ?? null
      }
    );
    playerEyeHeight = playerSpawn.eyeHeight;

    playerVisualController = createPlayerVisualController(scene);
    // Face the model in the authored spawn direction. Facing is purely
    // visual here -- the per-frame velocity heading writes
    // root.rotation.y, and only while moving, so a standing player keeps
    // its last yaw. Without seeding it the player ignores its authored
    // spawn rotation and stands at yaw 0 until it first moves. Only yaw
    // matters for an upright character, matching the velocity heading.
    const authoredSpawnRotation =
      activeRegionContents?.playerPresence?.transform.rotation;
    if (authoredSpawnRotation) {
      playerVisualController.root.rotation.y = authoredSpawnRotation[1];
    }
    void playerVisualController.apply({
      playerDefinition: state.playerDefinition,
      contentLibrary: state.contentLibrary,
      assetSources: state.assetSources,
      activeAnimationSlot: state.playerDefinition.presentation
        .animationAssetBindings.idle
        ? "idle"
        : null,
      isPlaying: true
    });

    const movementSystem = new MovementSystem();
    world.addSystem(movementSystem);

    // Plan 069.2 — resolve the player's move against the collision world
    // AFTER MovementSystem integrates it. Player radius from the shared
    // agent-dimensions helper (the player has no live SceneObject here).
    const collisionSystem = new CollisionSystem();
    collisionSystem.setCollisionWorld(collisionWorld);
    collisionSystem.setPlayerRadius(
      computePlayerAgentDimensions(state.playerDefinition).radius
    );
    // Lazy getter: gameplaySession is null here but populated before the first
    // world.update() fires. Each frame the player resolves against last-frame
    // NPC positions (symmetric with how NPCs resolve against the player).
    collisionSystem.setAgentsGetter(() => gameplaySession?.getNpcAgents() ?? []);
    world.addSystem(collisionSystem);

    inputManager = createRuntimeInputManager();
    inputManager.attach(root);
    spellCastFeedbackHost = createSpellCastFeedbackHost(root);
    pluginBannerHost = createRuntimePluginBannerHost(root);
    pluginBannerHost.apply(pluginManager.getContributions("runtime.banner"));
    movementSystem.setInputProvider(
      () => inputManager?.getInput() ?? { moveX: 0, moveY: 0 }
    );
    gameplayAssembly = createRuntimeGameplayAssembly({
      root,
      world,
      inputManager,
      // Handed to plugin init so whoever asked a question on the way in can
      // read its own answer. The host never looks up a key.
      preNewGameStepAnswers: bootPreNewGameStepAnswers,
      // The session asks for a framing by NAME; the host resolves it against
      // the live camera. Requesting captures wherever the camera is now as the
      // framing to give back, so a player who had zoomed gets their own zoom
      // returned rather than the rig default.
      cameraMoves: {
        request: (moveName) => {
          if (!cameraState) return;
          cameraMoveDirector.request(moveName, {
            pitch: cameraState.pitch,
            distance: cameraState.distance
          });
        },
        release: (moveName) => cameraMoveDirector.release(moveName, CAMERA_MOVE_BOUNDS)
      },
      // Plan 092.3 — a plugin resolves its shipped artifacts through this.
      assetSources: currentAssetSources,
      activeRegion,
      activeScene,
      // Plan 069.3 — NPC movement resolves against the same static world.
      collisionWorld,
      // Plan 069.9 — NPCs follow the baked navmesh once it finishes loading.
      getPathfinder: () => navMeshPathfinder,
      onSceneAction: hostHandleSceneAction,
      onPlayNpcAnimation: playNpcAnimation,
      // NO TRACK YET. The assembly is now built while the loading screen is
      // still up, and a track handed over here starts playing under it. The
      // real initial track starts where the loading gate closes, below.
      backgroundMusicCueId: null,
      playerDefinition: state.playerDefinition,
      worldFlagDefinitions: state.worldFlagDefinitions,
      spellDefinitions: state.spellDefinitions,
      itemDefinitions: state.itemDefinitions,
      documentDefinitions: state.documentDefinitions,
      npcDefinitions: state.npcDefinitions,
      dialogueDefinitions: state.dialogueDefinitions,
      questDefinitions: state.questDefinitions,
      contentLibrary: state.contentLibrary,
      mechanics: state.mechanics,
      soundEventBindings: state.soundEventBindings,
      audioMixer: state.audioMixer,
      pluginManager,
      // Story 50.3 — same registry the host owns above; gameplay-
      // session passes it to every UI module that wants a
      // keyboard shortcut.
      actionRegistry: runtimeActionRegistry ?? undefined,
      // Story 50.5 — DialoguePanel needs the state store to flip
      // `visibleMenuKey = "dialogue"` on show() so the mode
      // resolver routes dialogue keys to the dialogue panel and
      // suppresses in-game shortcuts.
      uiStateStore: uiStateStore ?? undefined,
      // Closure over `currentAssetSources` so the inventory UI re-resolves
      // thumbnail URLs against the current map (which can change when the
      // user regenerates a thumbnail mid-session).
      getAssetUrl: (path) => currentAssetSources?.[path],
      // Painted frames: caster (spell menu) and plain (inventory list).
      frameArt: gameplayFrameArt,
      onSpellCastSuccess: (feedback) => {
        spellCastFeedbackHost?.show(feedback.message);
      },
      onAudioCommands: (commands) => {
        webAudioAdapter?.handleCommands(commands);
      },
      onItemPresenceCollected: (presenceId) => {
        // Plan 055 §055.6 — record for the world.presence tracker
        // so the item stays collected across save+load. Reads the
        // captured region id, not the live one, so a mid-session
        // transition (future story) picks the region the item was
        // actually in.
        worldPresenceTracker.markCollected(
          activeRegionIdForSave,
          // Plan 058 §058.5 — collections key per (region, Scene)
          // so revisiting the region in another Scene has its own
          // collected set.
          activeSceneIdForSave,
          presenceId
        );
        // Plan 070.2 — the reconciler owns removal + disposal + drops it
        // from its desired set (a later reconcile won't re-add it).
        renderableReconciler?.remove(presenceId);
      },
      shouldSkipItemPresence: (presenceId) =>
        worldPresenceTracker.shouldSkip(
          activeRegionIdForSave,
          activeSceneIdForSave,
          presenceId
        )
    });
    gameplaySession = gameplayAssembly.gameplaySession;
    // Plan 055 §055.4 — Phase 2: register participants whose
    // subsystems only exist now that gameplayAssembly is
    // constructed, then run the region-aware + default tier
    // deserialize. AFTER that, kick startInitialQuests so
    // authored initial quests fill in for anything the save
    // didn't already restore (new quests added since the save
    // was written). Order matters: participants deserialize
    // FIRST, startInitialQuests runs SECOND — otherwise fresh
    // initial state would stomp restored progress.
    saveParticipantRegistry.register(
      createQuestManagerSaveParticipant({
        getQuestManager: () => gameplaySession?.questManager ?? null
      })
    );
    // World flags used to persist inside the quest slice. They have their own
    // owner now, so they have their own slice. A save written before the split
    // carries them in the quest slice still; the quest manager forwards those
    // on restore, which is why this participant needs no legacy path.
    saveParticipantRegistry.register(
      createWorldFlagSaveParticipant({
        getWorldFlagManager: () => gameplaySession?.worldFlagManager ?? null
      })
    );
    // Plan 055 §055.5 — inventory.player restores collected items
    // (definitionId + count) across sessions. Same Phase 2 sweep;
    // clobber semantics (nothing else populates the inventory pre-
    // deserialize).
    saveParticipantRegistry.register(
      createInventoryPlayerSaveParticipant({
        getInventoryManager: () => gameplaySession?.inventoryManager ?? null
      })
    );
    // Plan 056 §056.1 — caster.stats restores battery + resonance
    // (and any authored stats) across sessions. Prevents the
    // "full battery cheese" of every reload; the StatCarrier's
    // clamp-to-definition handles legacy values gracefully.
    saveParticipantRegistry.register(
      createCasterStatsSaveParticipant({
        getCasterManager: () => gameplaySession?.casterManager ?? null
      })
    );
    // Plan 056 §056.2 — npc.behavior restores per-NPC position +
    // movement status/target so returning players don't see NPCs
    // teleport back to spawn and re-walk to their task target on
    // every reload. Wall-clock timestamps (stuck detection) reset
    // to "now" at restore per the slice design; visually
    // indistinguishable from the pre-reload state.
    saveParticipantRegistry.register(
      createNpcBehaviorSaveParticipant({
        getNpcBehaviorSystem: () =>
          gameplaySession?.npcBehaviorSystem ?? null
      })
    );
    saveParticipantRegistry.register(
      createWorldTimeSaveParticipant({
        getWorldTimeStore: () =>
          gameplaySession?.worldTimeStore ?? null
      })
    );
    saveParticipantRegistry.register(
      createPlayerKnownFactsSaveParticipant({
        getPlayerKnownFactsStore: () =>
          gameplaySession?.playerKnownFactsStore ?? null
      })
    );
    saveParticipantRegistry.deserializeAll(restoredSlices, ["default"]);
    gameplayAssembly.gameplaySession.startInitialQuests();

    // THE WORLD IS NOW THE WORLD THE PLAYER WILL STAND IN, and nothing has
    // ticked. Everything a plugin needs in order to be ready has arrived: the
    // save is restored, starting quests have run, and the render loop has not
    // started. Anything prepared before this point is prepared against default
    // state and thrown away; anything prepared after it races the player.
    //
    // KICKED OFF, NOT AWAITED: this is the last unit of the readiness phase
    // that has been running since the downloads started, and it closes behind
    // the same overlay at the gate just below.
    //
    // AWAIT `pluginsInitialized` FIRST. Plugin init is started without being
    // awaited so a slow plugin cannot hold up the first frame, which means
    // without this a plugin would be asked to get ready before it had finished
    // reading its own content -- and would get ready against nothing.
    //
    // EVERY HOST TAKES THIS PATH, Studio preview included. Preview is where
    // this behaviour gets verified, and a preview that skips the step is not
    // the thing that ships.
    const pluginsReady = (async () => {
      try {
        await gameplayAssembly.pluginsInitialized;
      } catch (error) {
        // A plugin that failed to initialize has already logged. Carry on and
        // let it be unprepared rather than refusing to start the game.
        console.warn(
          "[web-runtime] a plugin failed to initialize; starting without it prepared.",
          error
        );
      }
      await pluginManager.beforeFirstFrame();
      pluginsReadyDone = 1;
      publishProgress();
    })();

    // ONE readiness gate for the whole boot (Plan 092.6): assets, the first
    // sync pass, and plugin readiness end behind one overlay, one deadline,
    // one stall prompt.
    //
    // NOT A SILENT TIMEOUT. Starting a game whose world or whose player data
    // has not arrived produces missing ground, absent scenery, and a learner
    // taught words they already know -- all of which look like the game being
    // broken rather than the game still loading. So when readiness overruns,
    // the player is told and decides: keep waiting, or start anyway knowing
    // what that means. Deciding on their behalf is what produced a "working"
    // boot with black ground.
    const bootReady = Promise.all([readiness, pluginsReady]);
    void bootReady.then(() => {
      bootReadySettled = true;
      bootStallStore.set(null);
    });
    await Promise.race([bootReady, stallPrompt]);
    bootStallStore.set(null);
    assetPreloadStore.set(null);

    // The loading screen is gone; the initial track starts now. Menu theme
    // while the start menu is up, else the in-game track (usually null).
    gameplayAssembly.gameplaySession.setMusicTrack(
      bootLifecycle === "start-menu"
        ? menuMusicCueIdForSession
        : sceneMusicCueIdForSession
    );
    emitMenuSoundTransition(null, uiStateStore.getState().activeOverlayMenuKey);
    movementSystem.setPlayerMovementChangeHandler((isMoving) => {
      if (isMoving) {
        gameplaySession?.audioController.emitEvent("player.footstep", {
          instanceKey: "player.footstep"
        });
      } else {
        gameplaySession?.audioController.stopInstance("player.footstep");
      }
    });
    if (adapter.boot.hostKind === "studio") {
      gameplaySession.initializeDebugBillboards();
      // Story 47.5.5 — append the Session card so the author can
      // watch user / save / region / position update during a
      // Preview session. The card is filtered to hostKinds: ["studio"]
      // inside its factory; it would never appear in published-web
      // anyway, but the explicit guard here makes the intent
      // unambiguous at the call site.
      // Story 47.10 follow-up + 51.3 migration — pass getters so
      // the card refreshes live. User / Anon row reads
      // `host.state.user.getSnapshot()` (populated from the
      // RESOLVED provider's currentUser + onChange subscription
      // above; do NOT overwrite with state.currentUser anywhere,
      // which would be the boot-time anonymous fallback and would
      // mask whichever provider actually won resolution). Save /
      // Last Played / Region / Quest row reads
      // `host.state.latestAutosave.getSnapshot()` (mutated by
      // notifyAutosaveWritten + initial snapshot below).
      latestAutosaveStore.set(
        resolvedSavedGame
          ? {
              lastPlayed: resolvedSavedGame.lastPlayed,
              ...deriveAutosaveDisplayFields(resolvedSavedGame.payload)
            }
          : null
      );
      // Story 51.3 — read via host.state.{user,latestAutosave}.
      // No more parallel `latestUser` / `latestSavedGameSnapshot`
      // mirrors inside this closure; the snapshot+subscribe
      // primitive owns both.
      const sessionHudCard = createSessionHudCard({
        getUser: () => userStore.getSnapshot(),
        getSavedGameSnapshot: () => latestAutosaveStore.getSnapshot()
      });
      debugHud = createRuntimeDebugHud({
        parent: root,
        ownerWindow,
        boot: adapter.boot,
        world,
        blackboard: gameplaySession.blackboard,
        // Story 50.5 — debug HUD registers its F3 / ` toggle
        // against `modes: ["any"]` so the diagnostic stays
        // accessible regardless of game state.
        actionRegistry: runtimeActionRegistry ?? undefined,
        pluginCards: [
          ...gameplaySession.getDebugHudCardContributions(),
          sessionHudCard
        ],
        getRendererStats: () => {
          const renderer = renderView?.renderer;
          if (!renderer) {
            return { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
          }
          return readRendererDebugStats(renderer);
        },
        getGameplaySessionSnapshot: () =>
          gameplaySession?.getDebugHudSnapshot() ?? {
            activeEntityCount: 0,
            activeSystemCount: 0,
            activeNpcCount: 0,
            activeQuestCount: 0,
            currentRegionId: null,
            currentSceneName: null,
            currentAreaDisplayName: null,
            playerPosition: null,
            dialogueActive: false
          },
        setDebugBillboardsEnabled: (enabled) => {
          gameplaySession?.setDebugBillboardsEnabled(enabled);
        },
        refreshDebugBillboards: () => {
          gameplaySession?.refreshDebugBillboards();
        }
      });
    }

    cameraState = createCameraState(DEFAULT_CAMERA_CONFIG);
    cameraState.targetY = playerEyeHeight;
    inputManager.onRightDrag = (dx, dy) => {
      // Touching the camera by hand takes it back. Reachable during a move's
      // RETURN, when the input lock has already been released -- and a move
      // that kept animating through the player's own input would feel broken.
      cameraMoveDirector.cancel();
      if (cameraState) {
        cameraState = applyCameraDrag(
          cameraState,
          DEFAULT_CAMERA_CONFIG,
          dx,
          dy
        );
      }
    };
    inputManager.onScroll = (delta) => {
      cameraMoveDirector.cancel();
      if (cameraState) {
        cameraState = applyCameraZoom(
          cameraState,
          DEFAULT_CAMERA_CONFIG,
          delta
        );
      }
    };
    movementSystem.setCameraYawProvider(
      () => cameraState?.yaw ?? Math.PI * 1.25
    );

    renderView.mount(root);
    uiLayerElement = ownerWindow.document.createElement("div");
    uiLayerElement.dataset.sugarmagicGameUiHost = "true";
    uiLayerElement.style.position = "absolute";
    uiLayerElement.style.inset = "0";
    uiLayerElement.style.pointerEvents = "none";
    root.appendChild(uiLayerElement);
    uiLayerRoot = createRoot(uiLayerElement);
    uiLayerRoot.render(
      createElement(GameUILayer, {
        hudDefinition: state.hudDefinition,
        menuDefinitions: state.menuDefinitions,
        theme: state.uiTheme,
        uiContextStore,
        uiStateStore,
        gameStateStore,
        onAction: (action) => {
          const previousMenuKey =
            uiStateStore?.getState().activeOverlayMenuKey ?? null;
          gameplaySession?.audioController.emitEvent("ui.click", {
            instanceKey: `ui.click:${action.action}`
          });
          uiActionRegistry?.dispatch(action, world);
          emitMenuSoundTransition(
            previousMenuKey,
            uiStateStore?.getState().activeOverlayMenuKey ?? null
          );
        },
        onHover: (action) => {
          gameplaySession?.audioController.emitEvent("ui.hover", {
            instanceKey: `ui.hover:${action?.action ?? "passive"}`
          });
        },
        // Plan 059 §059.4 — built-in Episodes screen.
        episodes: bootEpisodesViewModel,
        onEpisodesContinue: () => {
          uiStateStore?.setState({ episodesOpen: false });
          hostContinueGame();
        },
        onEpisodesClose: () => {
          uiStateStore?.setState({ episodesOpen: false });
        },
        // Plan 061 §061.2 — quiet start-menu identity line.
        userStore,
        // Plan 061 §061.3 — authored exit buttons render only
        // when there's a Play page to exit to.
        exitToSiteAvailable: bootPlayPageUrl.length > 0,
        // 081.8 -- quest form overlay callbacks.
        onQuestFormSubmit: (response) => {
          gameplaySession?.submitQuestFormResponse(response);
        },
        onQuestFormDismiss: () => {
          gameplaySession?.cancelQuestForm();
        },
        onPreNewGameStepConfirm: (optionId) => {
          uiStateStore.setState({
            preNewGameStepOpen: false,
            preNewGameStepDefinition: null
          });
          const resolve = resolveOpenPreNewGameStep;
          resolveOpenPreNewGameStep = null;
          resolve?.(optionId);
        }
      })
    );
    // Anything answered on the way in has to reach the save NOW. Autosave runs
    // every 5 seconds, and a tab closed inside that window would come back to a
    // game with no answers, so whoever asked would quietly fall back to its own
    // default -- the player's choice lost with no sign it ever happened. The
    // world and the session exist by this point, which is what
    // getCurrentSavePayload needs.
    if (Object.keys(bootPreNewGameStepAnswers).length > 0) {
      // AFTER PLUGIN INIT, or this writes the answer nobody has read yet.
      //
      // Plugins turn a carried answer into their own state during `init`, and
      // `init` is started without being awaited so a slow plugin cannot hold up
      // the first frame. Serializing before it settles captured whatever the
      // slices held BEFORE the answer was applied -- and it only looked correct
      // when the answering plugin happened to be first in the project's list.
      await gameplayAssembly.pluginsInitialized;
      await forceWriteSave("pre-new-game answers");
    }

    // Runtime host drives its own render loop (renderFrame ticks gameplay
    // then calls renderView.render()). We wait one tick so the view's async init
    // can resolve and create the pipeline before we try to render.
    ownerWindow.requestAnimationFrame(() => {
      handleResize();
      lastTime = ownerWindow.performance.now();
      publishSmperfStats({ lastBootMs: Number((lastTime - bootStart).toFixed(1)) });
      animationId = ownerWindow.requestAnimationFrame(renderFrame);
    });
  }

  function dispose() {
    if (!started) return;
    started = false;

    ownerWindow.removeEventListener("resize", handleResize);
    ownerWindow.removeEventListener("beforeunload", dispose);
    ownerWindow.removeEventListener("keydown", handlePauseKey);
    ownerWindow.document.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    disposeRuntime();
    renderEngineProjector.reset();
    engine.dispose();
  }

  /**
   * Plan 055 §055.7 — derive the HUD-facing display fields from
   * a save payload's slices. `upgradeLegacyPayload` normalizes
   * pre-055 payloads into the same slice shape, so this helper
   * is uniform across legacy and current saves. Returns `null`
   * defaults when a slice is missing (fresh save, participant
   * added since the save was written, etc.).
   */
  function deriveAutosaveDisplayFields(payload: GameSavePayload): {
    currentRegionId: string | null;
    currentQuestId: string | null;
  } {
    const upgraded = upgradeLegacyPayload(payload);
    const hostPlayer = upgraded.slices["host.player"]?.data as
      | HostPlayerSlice
      | undefined;
    const questManager = upgraded.slices["quest.manager"]?.data as
      | QuestManagerSlice
      | undefined;
    return {
      currentRegionId: hostPlayer?.currentRegionId ?? null,
      currentQuestId: questManager?.trackedQuestDefinitionId ?? null
    };
  }

  /**
   * The player chose to start before loading finished (Plan 092.6).
   *
   * A no-op unless readiness has actually overrun -- there is nothing to
   * release before then. What is still in flight keeps going; it simply is not
   * waited on, which is why the prompt says what that costs.
   */
  function startWithoutFinishedLoading(): void {
    const release = startAnyway;
    startAnyway = null;
    bootStallStore.set(null);
    release?.();
  }

  /**
   * Write the save immediately instead of waiting for the next autosave tick.
   *
   * For the moments where the 5-second gap is the difference between something
   * being kept and being silently lost: a Scene advance about to reload, and a
   * language picked on the way into a fresh game.
   *
   * `reason` only names the caller in the warnings. Failing to write is not
   * fatal here -- the player keeps playing, and the log says what they stand to
   * lose.
   */
  async function forceWriteSave(reason: string): Promise<void> {
    const bindings = activeProvidersStore.getSnapshot();
    const settledUser = bindings?.identityProvider.currentUser();
    const payload = getCurrentSavePayload();
    if (!bindings || !settledUser || !payload) {
      console.warn(
        `[web-runtime] ${reason}: no active store/user/payload; this will not persist.`
      );
      return;
    }
    const lastPlayed = new Date().toISOString();
    try {
      await bindings.saveStore.save(settledUser.userId, {
        userId: settledUser.userId,
        lastPlayed,
        schemaVersion: GAME_SAVE_SCHEMA_VERSION,
        writtenByVersion: SUGARMAGIC_VERSION,
        payload
      });
    } catch (error) {
      console.warn(
        `[web-runtime] ${reason}: save write failed; continuing anyway.`,
        error
      );
      return;
    }
    // Tell the rest of the host a save now exists. Without this a player who
    // quits to the menu right after picking sees no Continue button, because
    // savePresent only flips on an autosave tick.
    notifyAutosaveWritten({ lastPlayed, payload });
  }

  function notifyAutosaveWritten(snapshot: {
    lastPlayed: string;
    payload: GameSavePayload;
  }): void {
    const display = deriveAutosaveDisplayFields(snapshot.payload);
    latestAutosaveStore.set({
      lastPlayed: snapshot.lastPlayed,
      currentRegionId: display.currentRegionId,
      currentQuestId: display.currentQuestId
    });
    // Story 47.10.5 — flip the UI's save-presence flag so the
    // start menu's Continue button appears the moment the first
    // autosave write lands. Reads via `visibility: "hasSave"` on
    // the menu node.
    if (uiStateStore) {
      uiStateStore.setState({ savePresent: true });
    }
  }

  function showStartMenu(): void {
    if (!uiStateStore) return;
    // Plan 054 §054.4 Pass C — showStartMenu transitions the
    // lifecycle directly, doesn't write a menu key into uiState.
    gameStateStore.setState({ lifecycle: "start-menu" });
  }

  function setLoginModalOpen(open: boolean): void {
    // Story 50.6 — runtime mode resolver reads this; flipping it
    // to true forces mode "login-modal", which the action
    // registry treats as "no in-game / dialogue actions fire."
    // No-op when host.start() hasn't run yet — there's no game
    // running for shortcuts to interfere with anyway.
    if (!uiStateStore) return;
    uiStateStore.setState({ loginModalOpen: open });
  }

  function getCurrentSavePayload(): GameSavePayload | null {
    if (!world || !gameplaySession) return null;
    // Plan 055 §055.7 — slice-only writes. Every participant
    // that owns persistable state serializes here; no more legacy
    // 3-field carriers. Reads (upgradeLegacyPayload) still handle
    // pre-055 saves by synthesizing the host.player + quest.manager
    // slices from those saves' legacy fields.
    return { slices: saveParticipantRegistry.serializeAll() };
  }

  // Story 51.2 — expose the observable stores as a stable
  // `state` field. The same store objects are returned for the
  // host's entire lifetime; subscribers can grab a reference
  // once and use it across renders.
  const state: WebRuntimeHostState = {
    activeProviders: activeProvidersStore,
    user: userStore,
    latestAutosave: latestAutosaveStore,
    assetPreload: assetPreloadStore,
    bootStall: bootStallStore,
    gameState: gameStateStore,
    uiState: uiStateStore
  };

  return {
    boot: adapter.boot,
    state,
    start,
    dispose,
    getCurrentSavePayload,
    notifyAutosaveWritten,
    /** What the player answered on the way into this boot, by stepId. */
    getPreNewGameStepAnswers: () => bootPreNewGameStepAnswers,
    startWithoutFinishedLoading,
    showStartMenu,
    setLoginModalOpen,
    startNewGame: hostStartNewGame,
    continueGame: hostContinueGame,
    pauseGame: hostPauseGame,
    resumeGame: hostResumeGame,
    quitToMenu: hostQuitToMenu
  };
}
