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
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
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
  type RegionLandscapeState
} from "@sugarmagic/domain";
import {
  type RuntimePluginEnvironment,
  createResolvedRuntimePluginManager
} from "@sugarmagic/plugins";
import {
  World,
  MovementSystem,
  PlayerControlled,
  Position,
  resolveSceneObjects,
  DEFAULT_CAMERA_CONFIG,
  createCameraState,
  updateCameraFollow,
  applyCameraDrag,
  applyCameraZoom,
  computeCameraPosition,
  createRuntimeInputManager,
  createRuntimeBootModel,
  createRuntimeGameplayAssembly,
  type RuntimeBannerContribution,
  createRuntimeEnvironmentState,
  createEnvironmentSceneController,
  createLandscapeSceneController,
  createRuntimeRenderPipeline,
  createPlayerVisualController,
  spawnRuntimePlayerEntity,
  resolveEnvironmentDefinition,
  type SceneObject,
  type GameCameraState,
  type RuntimeBootModel,
  type RuntimeCompileProfile,
  type RuntimeContentSource,
  type RuntimeEnvironmentState,
  type RuntimeHostKind
} from "@sugarmagic/runtime-core";

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
  activeRegionId?: string | null;
  activeEnvironmentId?: string | null;
  installedPluginIds: string[];
  pluginRuntimeEnvironment?: RuntimePluginEnvironment;
  pluginConfigurations: PluginConfigurationRecord[];
  contentLibrary: ContentLibrarySnapshot;
  playerDefinition: PlayerDefinition;
  spellDefinitions: SpellDefinition[];
  itemDefinitions: ItemDefinition[];
  documentDefinitions: DocumentDefinition[];
  npcDefinitions: NPCDefinition[];
  dialogueDefinitions: DialogueDefinition[];
  questDefinitions: QuestDefinition[];
  assetSources: Record<string, string>;
}

export interface WebRuntimeHost {
  readonly boot: RuntimeBootModel;
  start: (state: WebRuntimeStartState) => void;
  dispose: () => void;
}

const CUBE_COLOR = 0x89b4fa;
const GRID_COLOR = 0x45475a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
}

interface LandscapeGridSpec {
  size: number;
  divisions: number;
}

function resolveLandscapeGridSpec(
  landscape: RegionLandscapeState | null | undefined
): LandscapeGridSpec {
  const size =
    landscape && Number.isFinite(landscape.size) && landscape.size > 0
      ? landscape.size
      : DEFAULT_REGION_LANDSCAPE_SIZE;

  return {
    size,
    divisions: Math.max(1, Math.min(200, Math.round(size)))
  };
}

function createLandscapeGrid(spec: LandscapeGridSpec): THREE.GridHelper {
  const grid = new THREE.GridHelper(spec.size, spec.divisions, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0.01;
  grid.name = "runtime-landscape-grid";
  return grid;
}

function disposeGrid(grid: THREE.GridHelper) {
  grid.geometry.dispose();
}

function createFallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: CUBE_COLOR })
  );
}

function createCapsuleFallback(object: SceneObject): THREE.Mesh {
  const capsule = object.capsule;
  if (!capsule) {
    return createFallbackMesh();
  }

  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      capsule.radius,
      Math.max(0.05, capsule.height - capsule.radius * 2),
      8,
      16
    ),
    new THREE.MeshStandardMaterial({
      color: capsule.color,
      roughness: 0.38,
      metalness: 0.04
    })
  );
  mesh.position.y = capsule.height / 2;
  return mesh;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else {
      child.material.dispose();
    }
  });
}

interface SpellCastFeedbackHost {
  show: (spellName: string) => void;
  dispose: () => void;
}

interface RuntimePluginBannerHost {
  apply: (banners: RuntimeBannerContribution[]) => void;
  dispose: () => void;
}

function createSpellCastFeedbackHost(parent: HTMLElement): SpellCastFeedbackHost {
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

function createRuntimePluginBannerHost(parent: HTMLElement): RuntimePluginBannerHost {
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

function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}

function getActiveRegion(
  regions: RegionDocument[],
  activeRegionId: string | null | undefined
): RegionDocument | null {
  if (activeRegionId) {
    const activeRegion = regions.find((region) => region.identity.id === activeRegionId);
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

  let world: World | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: WebGPURenderer | null = null;
  let environmentController: ReturnType<typeof createEnvironmentSceneController> | null = null;
  let landscapeController: ReturnType<typeof createLandscapeSceneController> | null = null;
  let renderPipeline: ReturnType<typeof createRuntimeRenderPipeline> | null = null;
  let cameraState: GameCameraState | null = null;
  let inputManager: ReturnType<typeof createRuntimeInputManager> | null = null;
  let runtimeEnvironmentState: RuntimeEnvironmentState | null = null;
  let playerVisualController: ReturnType<typeof createPlayerVisualController> | null = null;
  let gameplaySession:
    | ReturnType<typeof createRuntimeGameplayAssembly>["gameplaySession"]
    | null = null;
  let gameplayAssembly:
    | ReturnType<typeof createRuntimeGameplayAssembly>
    | null = null;
  let playerEyeHeight = 1.62;
  let grid: THREE.GridHelper | null = null;
  let spellCastFeedbackHost: SpellCastFeedbackHost | null = null;
  let pluginBannerHost: RuntimePluginBannerHost | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  let started = false;
  const sceneObjectEntries = new Map<string, SceneObjectEntry>();

  function disposeRuntime() {
    if (animationId !== null) {
      ownerWindow.cancelAnimationFrame(animationId);
      animationId = null;
    }

    inputManager?.detach();
    inputManager = null;
    cameraState = null;
    runtimeEnvironmentState = null;
    world = null;

    playerVisualController?.dispose();
    playerVisualController = null;
    void gameplayAssembly?.dispose();
    gameplayAssembly = null;
    gameplaySession = null;
    spellCastFeedbackHost?.dispose();
    spellCastFeedbackHost = null;
    pluginBannerHost?.dispose();
    pluginBannerHost = null;
    playerEyeHeight = 1.62;

    for (const entry of sceneObjectEntries.values()) {
      scene?.remove(entry.root);
      disposeObject(entry.root);
    }
    sceneObjectEntries.clear();

    environmentController?.dispose();
    environmentController = null;
    landscapeController?.dispose();
    landscapeController = null;
    if (grid && scene) {
      scene.remove(grid);
      disposeGrid(grid);
      grid = null;
    }
    renderPipeline?.dispose();
    renderPipeline = null;

    if (scene) {
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const material of child.material) {
            material.dispose();
          }
        } else {
          child.material.dispose();
        }
      });
    }

    if (renderer) {
      renderer.dispose();
      if (renderer.domElement.parentElement === root) {
        root.removeChild(renderer.domElement);
      }
    }

    renderer = null;
    camera = null;
    scene = null;
  }

  function handleResize() {
    if (!camera || !renderer) return;

    const width = root.clientWidth || 1;
    const height = root.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderPipeline?.resize(width, height);
  }

  function renderFrame(now: number) {
    if (
      !world ||
      !cameraState ||
      !camera ||
      !renderer ||
      !scene ||
      !playerVisualController ||
      !inputManager
    ) {
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    world.update(delta);
    gameplaySession?.update();

    const playerEntities = world.query(PlayerControlled, Position);
    if (playerEntities.length > 0) {
      const pos = world.getComponent(playerEntities[0], Position)!;
      playerVisualController.root.position.set(pos.x, pos.y, pos.z);
      cameraState.targetY = pos.y + playerEyeHeight;
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
    renderPipeline?.setCamera(camera);
    if (renderPipeline) {
      renderPipeline.render();
    } else {
      renderer.render(scene, camera);
    }

    inputManager.endFrame();

    animationId = ownerWindow.requestAnimationFrame(renderFrame);
  }

  function start(state: WebRuntimeStartState) {
    if (!started) {
      started = true;
      ownerWindow.addEventListener("resize", handleResize);
      ownerWindow.addEventListener("beforeunload", dispose);
    }

    disposeRuntime();

    scene = new THREE.Scene();
    environmentController = createEnvironmentSceneController(scene);
    landscapeController = createLandscapeSceneController(scene);

    camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_CONFIG.fov,
      root.clientWidth / Math.max(root.clientHeight, 1),
      0.1,
      1000
    );

    renderer = new WebGPURenderer({ antialias: true });
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    root.appendChild(renderer.domElement);

    const activeRegion = getActiveRegion(state.regions, state.activeRegionId);
    grid = createLandscapeGrid(resolveLandscapeGridSpec(activeRegion?.landscape ?? null));
    scene.add(grid);
    runtimeEnvironmentState = createRuntimeEnvironmentState({
      region: activeRegion,
      contentLibrary: state.contentLibrary,
      explicitEnvironmentId: state.activeEnvironmentId
    });
    environmentController.apply(
      activeRegion,
      state.contentLibrary,
      runtimeEnvironmentState.activeEnvironmentId
    );
    landscapeController.apply(activeRegion);

    for (const region of state.regions) {
      const objects = resolveSceneObjects(region, {
        contentLibrary: state.contentLibrary,
        playerDefinition: state.playerDefinition,
        itemDefinitions: state.itemDefinitions,
        npcDefinitions: state.npcDefinitions,
        includePlayerPresence: false
      });
      for (const object of objects) {
        const rootObject = new THREE.Group();
        rootObject.name = object.instanceId;
        rootObject.userData.sceneInstanceId = object.instanceId;
        rootObject.position.set(...object.transform.position);
        rootObject.rotation.set(...object.transform.rotation);
        rootObject.scale.set(...object.transform.scale);

        const assetSourceUrl = object.modelSourcePath
          ? state.assetSources[object.modelSourcePath] ?? null
          : null;

        if (assetSourceUrl) {
          void gltfLoader
            .loadAsync(assetSourceUrl)
            .then((gltf) => {
              if (!scene) return;
              const renderable = gltf.scene.clone(true);
              if (object.targetModelHeight) {
                normalizeModelScale(renderable, object.targetModelHeight);
              }
              rootObject.add(renderable);
            })
            .catch(() => {
              rootObject.add(
                object.kind === "asset"
                  ? createFallbackMesh()
                  : createCapsuleFallback(object)
              );
            });
        } else {
          rootObject.add(
            object.kind === "asset"
              ? createFallbackMesh()
              : createCapsuleFallback(object)
          );
        }

        scene.add(rootObject);
        sceneObjectEntries.set(object.instanceId, {
          root: rootObject
        });
      }
    }
    world = new World();
    const pluginManager = createResolvedRuntimePluginManager(
      adapter.boot,
      state.installedPluginIds,
      state.pluginConfigurations,
      state.pluginRuntimeEnvironment ?? {},
    );
    console.info("[web-runtime] plugin-bootstrap", {
      installedPluginIds: state.installedPluginIds,
      pluginConfigurations: state.pluginConfigurations.map((configuration) => ({
        pluginId: configuration.pluginId,
        enabled: configuration.enabled
      })),
      runtimePluginIds: pluginManager.getPlugins().map((plugin) => plugin.pluginId),
      conversationProviderContributionIds: pluginManager
        .getContributions("conversation.provider")
        .map((contribution) => contribution.payload.providerId)
    });
    const playerSpawn = spawnRuntimePlayerEntity(
      world,
      activeRegion,
      state.playerDefinition
    );
    playerEyeHeight = playerSpawn.eyeHeight;

    playerVisualController = createPlayerVisualController(scene);
    void playerVisualController.apply({
      playerDefinition: state.playerDefinition,
      contentLibrary: state.contentLibrary,
      assetSources: state.assetSources,
      activeAnimationSlot: state.playerDefinition.presentation.animationAssetBindings.idle
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
      playerDefinition: state.playerDefinition,
      spellDefinitions: state.spellDefinitions,
      itemDefinitions: state.itemDefinitions,
      documentDefinitions: state.documentDefinitions,
      npcDefinitions: state.npcDefinitions,
      dialogueDefinitions: state.dialogueDefinitions,
      questDefinitions: state.questDefinitions,
      pluginManager,
      onSpellCastSuccess: (feedback) => {
        spellCastFeedbackHost?.show(feedback.message);
      },
      onItemPresenceCollected: (presenceId) => {
        const entry = sceneObjectEntries.get(presenceId);
        if (!entry || !scene) return;
        scene.remove(entry.root);
        disposeObject(entry.root);
        sceneObjectEntries.delete(presenceId);
      }
    });
    gameplaySession = gameplayAssembly.gameplaySession;

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

    void renderer
      .init()
      .then(() => {
        if (!renderer || !scene || !camera) return;

        renderer.setPixelRatio(ownerWindow.devicePixelRatio);
        renderPipeline = createRuntimeRenderPipeline({
          renderer,
          scene,
          camera,
          width: root.clientWidth || 1,
          height: root.clientHeight || 1
        });
        renderPipeline.applyEnvironment(
          resolveEnvironmentDefinition(
            activeRegion,
            state.contentLibrary,
            runtimeEnvironmentState?.activeEnvironmentId ?? null
          )
        );

        handleResize();
        lastTime = ownerWindow.performance.now();
        animationId = ownerWindow.requestAnimationFrame(renderFrame);
      })
      .catch((error) => {
        console.error("[sugarmagic] Failed to initialize WebGPU runtime host.", error);
      });
  }

  function dispose() {
    if (!started) return;
    started = false;

    ownerWindow.removeEventListener("resize", handleResize);
    ownerWindow.removeEventListener("beforeunload", dispose);

    disposeRuntime();
  }

  return {
    boot: adapter.boot,
    start,
    dispose
  };
}
