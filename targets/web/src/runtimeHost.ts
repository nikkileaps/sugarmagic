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
import { clone as cloneSkinnedObject } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  type ContentLibrarySnapshot,
  type DocumentDefinition,
  type DialogueDefinition,
  type ItemDefinition,
  type NPCDefinition,
  type PluginConfigurationRecord,
  type PlayerDefinition,
  type QuestDefinition,
  type SpellDefinition,
  type RegionDocument
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
  createRuntimeGameplayAssembly,
  type RuntimeBannerContribution,
  createPlayerVisualController,
  spawnRuntimePlayerEntity,
  type SceneObject,
  type GameCameraState,
  type RuntimeBootModel,
  type RuntimeCompileProfile,
  type RuntimeContentSource,
  type RuntimeHostKind
} from "@sugarmagic/runtime-core";
import { BillboardAssetRegistry } from "./billboard/BillboardAssetRegistry";
import { BillboardRenderer } from "./billboard/BillboardRenderer";
import { TextBillboardRenderer } from "./billboard/TextBillboardRenderer";
import { createRuntimeRenderEngineProjector } from "./RenderEngineProjector";

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
  pluginBootPayloads?: Record<string, unknown>;
}

export interface WebRuntimeHost {
  readonly boot: RuntimeBootModel;
  start: (state: WebRuntimeStartState) => void;
  dispose: () => void;
}

const FOLIAGE_FALLBACK_COLOR = 0x8ad26a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
  object: SceneObject;
  shaderApplication: RenderableShaderApplicationState;
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

function validateRenderableAsset(object: SceneObject, renderable: THREE.Object3D): string | null {
  if (object.assetKind !== "foliage") {
    return null;
  }

  const meshes = getAllRenderableMeshes(renderable);
  if (meshes.length === 0) {
    return "Foliage GLB loaded without any mesh primitives.";
  }

  const hasUv = meshes.some((mesh) => Boolean(mesh.geometry.getAttribute("uv")));
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
  // Shared render engine owns the GPU device, ShaderRuntime, resolver, and
  // resolved environment state. This runtime host creates a per-surface
  // RenderView bound to that engine.
  const engine: WebRenderEngine = createWebRenderEngine({
    compileProfile: request.compileProfile,
    logger: {
      warn(message: string, payload?: Record<string, unknown>) {
        console.warn("[web-runtime] shader-runtime", { message, ...(payload ?? {}) });
      },
      debug(message: string, payload?: Record<string, unknown>) {
        console.debug("[web-runtime] shader-runtime", { message, ...(payload ?? {}) });
      }
    }
  });
  const renderEngineProjector = createRuntimeRenderEngineProjector(engine);
  let renderView: RenderView | null = null;
  let currentAssetSources: Record<string, string> = {};
  let cameraState: GameCameraState | null = null;
  let inputManager: ReturnType<typeof createRuntimeInputManager> | null = null;
  let playerVisualController: ReturnType<typeof createPlayerVisualController> | null = null;
  let gameplaySession:
    | ReturnType<typeof createRuntimeGameplayAssembly>["gameplaySession"]
    | null = null;
  let billboardAssetRegistry: BillboardAssetRegistry | null = null;
  let billboardRenderer: BillboardRenderer | null = null;
  let textBillboardRenderer: TextBillboardRenderer | null = null;
  let debugHud: ReturnType<typeof createRuntimeDebugHud> | null = null;
  let gameplayAssembly:
    | ReturnType<typeof createRuntimeGameplayAssembly>
    | null = null;
  let playerEyeHeight = 1.62;
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
        playerVisualController.root.rotation.y = Math.atan2(velocity.x, velocity.z);
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

  function start(state: WebRuntimeStartState) {
    if (!started) {
      started = true;
      ownerWindow.addEventListener("resize", handleResize);
      ownerWindow.addEventListener("beforeunload", dispose);
    }

    disposeRuntime();
    currentAssetSources = state.assetSources;

    scene = new THREE.Scene();
    if (ownerWindow.getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    billboardAssetRegistry = new BillboardAssetRegistry({
      ownerWindow,
      logger: {
        warn(message, payload) {
          console.warn("[web-runtime] billboard-asset", { message, ...(payload ?? {}) });
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
          console.warn("[web-runtime] shader-runtime", { message, ...(payload ?? {}) });
        },
        debug(message: string, payload?: Record<string, unknown>) {
          console.debug("[web-runtime] shader-runtime", { message, ...(payload ?? {}) });
        }
      }
    });

    const activeRegion = getActiveRegion(state.regions, state.activeRegionId);
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
        includePlayerPresence: false
      });
      for (const object of objects) {
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
              const renderable = cloneSkinnedObject(gltf.scene) as THREE.Object3D;
              const validationError = validateRenderableAsset(object, renderable);
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
        sceneObjectEntries.set(object.instanceId, {
          root: rootObject,
          object,
          shaderApplication
        });
      }
    }
    world = new World();
    const pluginManager = createResolvedRuntimePluginManager(
      adapter.boot,
      state.installedPluginIds,
      state.pluginConfigurations,
      state.pluginRuntimeEnvironment ?? {},
      state.pluginBootPayloads ?? {},
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
        disposeRenderableObject(entry.root);
        sceneObjectEntries.delete(presenceId);
      }
    });
    gameplaySession = gameplayAssembly.gameplaySession;
    if (adapter.boot.hostKind === "studio") {
      gameplaySession.initializeDebugBillboards();
      debugHud = createRuntimeDebugHud({
        parent: root,
        ownerWindow,
        boot: adapter.boot,
        world,
        blackboard: gameplaySession.blackboard,
        pluginCards: gameplaySession.getDebugHudCardContributions(),
        getRendererStats: () => {
          const renderer = renderView?.renderer;
          if (!renderer) {
            return { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
          }
          return readRendererDebugStats(renderer);
        },
        getGameplaySessionSnapshot: () => gameplaySession?.getDebugHudSnapshot() ?? {
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

    disposeRuntime();
    renderEngineProjector.reset();
    engine.dispose();
  }

  return {
    boot: adapter.boot,
    start,
    dispose
  };
}
