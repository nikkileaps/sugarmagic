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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  getCharacterAnimationDefinition,
  type ContentLibrarySnapshot,
  type DocumentDefinition,
  type DialogueDefinition,
  type ItemDefinition,
  type NPCDefinition,
  type PluginConfigurationRecord,
  type PlayerDefinition,
  type QuestDefinition,
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
  type Scene
} from "@sugarmagic/domain";
import {
  type RuntimePluginEnvironment,
  createResolvedRuntimePluginManager
} from "@sugarmagic/plugins";
import {
  createCapsuleFallback,
  createRenderView,
  createWebRenderEngine,
  createFallbackMesh,
  createRenderableShaderApplicationState,
  disposeRenderableObject,
  ensureShaderSetAppliedToRenderable,
  ensureShaderSetsAppliedToRenderables,
  normalizeModelScale,
  type RenderableShaderApplicationState,
  type RenderView,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  BillboardComponent,
  type CameraSnapshot,
  World,
  MovementSystem,
  PlayerControlled,
  Position,
  Velocity,
  iterateActiveItemPresences,
  resolveSceneObjects,
  DEFAULT_CAMERA_CONFIG,
  createCameraState,
  updateCameraFollow,
  applyCameraDrag,
  applyCameraZoom,
  computeCameraPosition,
  createRuntimeInputManager,
  createRuntimeBootModel,
  createRuntimeDebugHud,
  createCasterStatsSaveParticipant,
  createInventoryPlayerSaveParticipant,
  createNpcBehaviorSaveParticipant,
  createQuestManagerSaveParticipant,
  type QuestManagerSlice,
  createRuntimeGameplayAssembly,
  createWorldPresenceSaveParticipant,
  WorldPresenceTracker,
  type RuntimeBannerContribution,
  createPlayerVisualController,
  createSessionHudCard,
  registerActiveIdentityProvider,
  resolveActiveGameSaveStore,
  resolveActiveIdentityProvider,
  upgradeLegacyPayload,
  type SessionHudSavedGameSnapshot,
  spawnRuntimePlayerEntity,
  type GameSave,
  type GameSavePayload,
  type GameSaveStore,
  type SaveParticipant,
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
  type UIActionRegistry,
  type UIContextStore,
  type UIStateStore
} from "@sugarmagic/runtime-core";
import {
  createHostPlayerParticipant,
  type HostPlayerSlice
} from "./save/hostPlayerParticipant";
import { BillboardAssetRegistry } from "./billboard/BillboardAssetRegistry";
import { BillboardRenderer } from "./billboard/BillboardRenderer";
import { TextBillboardRenderer } from "./billboard/TextBillboardRenderer";
import { createRuntimeRenderEngineProjector } from "./RenderEngineProjector";
import { GameUILayer } from "./GameUILayer";
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
  activeRegionId?: string | null;
  activeEnvironmentId?: string | null;
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
   * Story 47.10 follow-up — callers tell the host when a fresh save
   * was written (autosave loop) so the Session debug HUD card
   * reflects the latest snapshot. Idempotent; safe to call after
   * every successful write even when the payload didn't change.
   */
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
  /**
   * Plan 055 §055.1 — register a save participant. Called by
   * runtime-core systems (QuestManager, Inventory, world-presence
   * tracker, host-owned player/region tracker) at construction
   * time. Participants registered here contribute slices to
   * `getCurrentSavePayload()` and receive `deserialize` calls in
   * tier order at `host.start()` after the save loads. See Plan
   * 055 §Pattern for save/load flow.
   */
  registerSaveParticipant(participant: SaveParticipant): void;
  /**
   * Plan 055 §055.1 — unregister a save participant by id. Used
   * when a system tears down mid-session (rare). No-op if the id
   * isn't currently registered.
   */
  unregisterSaveParticipant(participantId: string): void;
}

const FOLIAGE_FALLBACK_COLOR = 0x8ad26a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
  object: SceneObject;
  shaderApplication: RenderableShaderApplicationState;
  /**
   * AnimationMixer for NPCs whose definition has bound animation slots.
   * Driven each frame from the runtime loop. Static-mesh assets and
   * NPCs without animations leave this null.
   */
  mixer: THREE.AnimationMixer | null;
}

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
  async function hostStartNewGame(): Promise<void> {
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
  let currentAssetSources: Record<string, string> = {};
  let cameraState: GameCameraState | null = null;
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
  let billboardAssetRegistry: BillboardAssetRegistry | null = null;
  let billboardRenderer: BillboardRenderer | null = null;
  let textBillboardRenderer: TextBillboardRenderer | null = null;
  let debugHud: ReturnType<typeof createRuntimeDebugHud> | null = null;
  let gameplayAssembly: ReturnType<
    typeof createRuntimeGameplayAssembly
  > | null = null;
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
  let started = false;
  const sceneObjectEntries = new Map<string, SceneObjectEntry>();

  function disposeRuntime() {
    if (animationId !== null) {
      ownerWindow.cancelAnimationFrame(animationId);
      animationId = null;
    }

    identityUnsubscribe?.();
    identityUnsubscribe = null;
    userStore.set(null);
    latestAutosaveStore.set(null);

    inputManager?.detach();
    inputManager = null;
    cameraState = null;
    world = null;

    playerVisualController?.dispose();
    playerVisualController = null;
    debugHud?.dispose();
    debugHud = null;
    void gameplayAssembly?.dispose();
    gameplayAssembly = null;
    gameplaySession = null;
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

    for (const entry of sceneObjectEntries.values()) {
      scene?.remove(entry.root);
      disposeRenderableObject(entry.root);
    }
    sceneObjectEntries.clear();

    if (scene) {
      disposeRenderableObject(scene);
    }

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
    world.update(delta);
    gameplaySession?.update(delta);

    for (const snapshot of gameplaySession?.getNpcRuntimeSnapshots() ?? []) {
      const entry = sceneObjectEntries.get(snapshot.presenceId);
      if (!entry) {
        continue;
      }
      entry.root.position.set(...snapshot.position);
    }

    // Tick every entry mixer (NPCs with bound idle animations). The
    // mixer is null for static-mesh assets and for NPCs without
    // animations, so this loop is cheap when nothing's animated.
    for (const entry of sceneObjectEntries.values()) {
      entry.mixer?.update(delta);
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

    const camPos = computeCameraPosition(cameraState);
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

      const entry = sceneObjectEntries.get(binding.sceneInstanceId);
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

    ensureShaderSetsAppliedToRenderables(
      sceneObjectEntries.values(),
      renderView.shaderRuntime,
      currentAssetSources
    );

    renderView.setCamera(camera);
    renderView.render();

    debugHud?.update(delta);

    inputManager.endFrame();

    animationId = ownerWindow.requestAnimationFrame(renderFrame);
  }

  async function start(state: WebRuntimeStartState): Promise<void> {
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
    // participant received. Region + position spawn from there;
    // fall through to state.activeRegionId for the implicit
    // boot.json case where neither save nor authored default set
    // a region.
    const resolvedActiveRegionId =
      hostPlayerRestore?.currentRegionId ?? state.activeRegionId ?? null;
    activeRegionIdForSave =
      typeof resolvedActiveRegionId === "string" ? resolvedActiveRegionId : null;
    // Plan 058 §058.1 — belt-and-suspenders migration for stale
    // pre-058 boot payloads (regions carrying legacy `scene`
    // nests, no `scenes` array). Idempotent no-op on current
    // payloads. Then pick the active Scene: first by sceneOrder
    // until Plan 058.4 restores it from campaign.progression.
    const migratedContent = migrateToScenes({
      scenes: state.scenes ?? [],
      regions: state.regions
    });
    const activeScene = migratedContent.scenes[0] ?? null;
    const activeRegion = getActiveRegion(
      migratedContent.regions,
      resolvedActiveRegionId
    );
    // Composed Base + Overlay view (Pattern 1) — every presence /
    // spawn read below sources from this, never region fields.
    const activeRegionContents = activeRegion
      ? composeRegionContents(activeRegion, activeScene)
      : null;
    renderEngineProjector.push(state);
    renderView.landscapeController.applyLandscape(
      activeRegion?.landscape ?? null,
      state.contentLibrary,
      state.assetSources
    );

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
            worldPresenceTracker.shouldSkip(activeRegionIdForSave, presenceId)
        },
        (presence) => {
          activeItemPresenceIds.add(presence.presenceId);
        }
      );
      for (const object of objects) {
        // For kind "item" the SceneObject's `instanceId` equals
        // the presenceId — see scene/index.ts:createItemSceneObject.
        // If the filter pass didn't include this presence,
        // don't spawn its visual either.
        if (
          object.kind === "item" &&
          !activeItemPresenceIds.has(object.instanceId)
        ) {
          continue;
        }
        const rootObject = new THREE.Group();
        const shaderApplication = createRenderableShaderApplicationState();
        rootObject.name = object.instanceId;
        rootObject.userData.sceneInstanceId = object.instanceId;
        rootObject.position.set(...object.transform.position);
        rootObject.rotation.set(...object.transform.rotation);
        rootObject.scale.set(...object.transform.scale);

        const assetSourceUrl = object.modelSourcePath
          ? renderView.assetResolver.resolveAssetUrl(object.modelSourcePath)
          : null;

        if (assetSourceUrl) {
          void gltfLoader
            .loadAsync(assetSourceUrl)
            .then((gltf) => {
              if (!scene) return;
              // SkeletonUtils.clone for SkinnedMesh-bearing glTFs:
              // plain Object3D.clone shares the skeleton with the
              // source gltf, so the rendered character anchors to the
              // source bones (always at origin) regardless of the
              // wrapper Group's transform. SkeletonUtils.clone re-binds
              // the cloned mesh to cloned bones so wrapper-Group
              // transforms actually move the rendered mesh. Required
              // for character models post-Plan-038; harmless for
              // static-mesh assets.
              const renderable = cloneSkinnedObject(
                gltf.scene
              ) as THREE.Object3D;
              const validationError = validateRenderableAsset(
                object,
                renderable
              );
              if (validationError) {
                console.error("[web-runtime] invalid-asset-payload", {
                  instanceId: object.instanceId,
                  assetDefinitionId: object.assetDefinitionId,
                  assetKind: object.assetKind,
                  modelSourcePath: object.modelSourcePath,
                  message: validationError
                });
                rootObject.add(getSceneObjectFallback(object));
                return;
              }
              // Populate matrixWorld for every node BEFORE measuring
              // the bbox. SkinnedMesh.computeBoundingBox uses bone
              // matrixWorlds; without this update they're identity and
              // the bbox is garbage, leading to wildly wrong scale.
              renderable.updateMatrixWorld(true);
              if (object.targetModelHeight) {
                normalizeModelScale(renderable, object.targetModelHeight);
              }
              // Disable frustum culling on skinned meshes — bind-pose
              // bounding sphere goes stale after rescaling + animation,
              // can pop the model out of view at certain camera angles.
              renderable.traverse((child) => {
                if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
                  child.frustumCulled = false;
                }
              });
              renderView?.enableShadowsOnObject(renderable);
              ensureShaderSetAppliedToRenderable(
                renderable,
                object,
                renderView?.shaderRuntime ?? null,
                shaderApplication,
                state.assetSources
              );
              rootObject.add(renderable);

              // For NPCs with bound animations, load the idle clip and
              // attach an AnimationMixer so the runtime frame loop can
              // drive it. v1: NPCs default to playing idle forever (no
              // locomotion-driven slot switching like the player).
              if (object.kind === "npc") {
                const presence = activeRegionContents?.npcPresences.find(
                  (p) => p.presenceId === object.instanceId
                );
                const npcDefinition = presence
                  ? state.npcDefinitions.find(
                      (d) => d.definitionId === presence.npcDefinitionId
                    )
                  : null;
                const idleBindingId =
                  npcDefinition?.presentation.animationAssetBindings.idle ??
                  null;
                const idleAnimDef = idleBindingId
                  ? getCharacterAnimationDefinition(
                      state.contentLibrary,
                      idleBindingId
                    )
                  : null;
                const idleSourceUrl = idleAnimDef
                  ? (state.assetSources[idleAnimDef.source.relativeAssetPath] ??
                    null)
                  : null;
                if (idleSourceUrl) {
                  void gltfLoader
                    .loadAsync(idleSourceUrl)
                    .then((animGltf) => {
                      const clip = animGltf.animations[0];
                      if (!clip) return;
                      const npcEntry = sceneObjectEntries.get(
                        object.instanceId
                      );
                      if (!npcEntry) return;
                      const mixer = new THREE.AnimationMixer(renderable);
                      const action = mixer.clipAction(clip);
                      action.reset();
                      action.play();
                      npcEntry.mixer = mixer;
                    })
                    .catch((error) => {
                      console.error("[web-runtime] npc-animation-load-failed", {
                        instanceId: object.instanceId,
                        sourceUrl: idleSourceUrl,
                        error
                      });
                    });
                }
              }
            })
            .catch((error) => {
              console.error("[web-runtime] asset-load-failed", {
                instanceId: object.instanceId,
                assetDefinitionId: object.assetDefinitionId,
                assetKind: object.assetKind,
                modelSourcePath: object.modelSourcePath,
                error
              });
              rootObject.add(getSceneObjectFallback(object));
            });
        } else {
          console.error("[web-runtime] asset-source-missing", {
            instanceId: object.instanceId,
            assetDefinitionId: object.assetDefinitionId,
            assetKind: object.assetKind,
            modelSourcePath: object.modelSourcePath
          });
          rootObject.add(getSceneObjectFallback(object));
        }

        scene.add(rootObject);
        const entry: SceneObjectEntry = {
          root: rootObject,
          object,
          shaderApplication,
          mixer: null
        };
        sceneObjectEntries.set(object.instanceId, entry);
      }
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
    } else {
      gameStateStore.setState({ lifecycle: "playing" });
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
      onToggleCaster: () => gameplaySession?.toggleCaster()
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
      activeRegion,
      activeScene,
      playerDefinition: state.playerDefinition,
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
          presenceId
        );
        const entry = sceneObjectEntries.get(presenceId);
        if (!entry || !scene) return;
        scene.remove(entry.root);
        disposeRenderableObject(entry.root);
        sceneObjectEntries.delete(presenceId);
      },
      shouldSkipItemPresence: (presenceId) =>
        worldPresenceTracker.shouldSkip(activeRegionIdForSave, presenceId)
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
    saveParticipantRegistry.deserializeAll(restoredSlices, ["default"]);
    gameplayAssembly.gameplaySession.startInitialQuests();
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
            currentSceneId: null,
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
        }
      })
    );
    // Runtime host drives its own render loop (renderFrame ticks gameplay
    // then calls renderView.render()). We wait one tick so the view's async init
    // can resolve and create the pipeline before we try to render.
    ownerWindow.requestAnimationFrame(() => {
      handleResize();
      lastTime = ownerWindow.performance.now();
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
    showStartMenu,
    setLoginModalOpen,
    startNewGame: hostStartNewGame,
    continueGame: hostContinueGame,
    pauseGame: hostPauseGame,
    resumeGame: hostResumeGame,
    quitToMenu: hostQuitToMenu,
    registerSaveParticipant: (participant) =>
      saveParticipantRegistry.register(participant),
    unregisterSaveParticipant: (participantId) =>
      saveParticipantRegistry.unregister(participantId)
  };
}
