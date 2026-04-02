import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ContentLibrarySnapshot, RegionDocument } from "@sugarmagic/domain";
import {
  World,
  Position,
  Velocity,
  PlayerControlled,
  CameraTarget,
  Renderable,
  MovementSystem,
  resolveSceneObjects,
  DEFAULT_CAMERA_CONFIG,
  createCameraState,
  updateCameraFollow,
  applyCameraDrag,
  applyCameraZoom,
  computeCameraPosition,
  createRuntimeInputManager,
  createRuntimeBootModel,
  createRuntimeEnvironmentState,
  createEnvironmentSceneController,
  createRuntimeRenderPipeline,
  resolveEnvironmentDefinition,
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
  contentLibrary: ContentLibrarySnapshot;
  assetSources: Record<string, string>;
}

export interface WebRuntimeHost {
  readonly boot: RuntimeBootModel;
  start: (state: WebRuntimeStartState) => void;
  dispose: () => void;
}

const CUBE_COLOR = 0x89b4fa;
const PLAYER_COLOR = 0xa6e3a1;
const GRID_COLOR = 0x45475a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
}

function createFallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: CUBE_COLOR })
  );
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
  let renderPipeline: ReturnType<typeof createRuntimeRenderPipeline> | null = null;
  let cameraState: GameCameraState | null = null;
  let inputManager: ReturnType<typeof createRuntimeInputManager> | null = null;
  let runtimeEnvironmentState: RuntimeEnvironmentState | null = null;
  let playerMesh: THREE.Mesh | null = null;
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

    if (playerMesh) {
      playerMesh.geometry.dispose();
      if (Array.isArray(playerMesh.material)) {
        for (const material of playerMesh.material) {
          material.dispose();
        }
      } else {
        playerMesh.material.dispose();
      }
      playerMesh = null;
    }

    for (const entry of sceneObjectEntries.values()) {
      scene?.remove(entry.root);
      disposeObject(entry.root);
    }
    sceneObjectEntries.clear();

    environmentController?.dispose();
    environmentController = null;
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
      !playerMesh ||
      !inputManager
    ) {
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    world.update(delta);

    const playerEntities = world.query(PlayerControlled, Position);
    if (playerEntities.length > 0) {
      const pos = world.getComponent(playerEntities[0], Position)!;
      playerMesh.position.set(pos.x, 0.7, pos.z);

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

    scene.add(new THREE.GridHelper(40, 40, GRID_COLOR, GRID_COLOR));

    const activeRegion = getActiveRegion(state.regions, state.activeRegionId);
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
    for (const region of state.regions) {
      const objects = resolveSceneObjects(region, state.contentLibrary);
      for (const object of objects) {
        const rootObject = new THREE.Group();
        rootObject.name = object.instanceId;
        rootObject.position.set(...object.transform.position);
        rootObject.rotation.set(...object.transform.rotation);
        rootObject.scale.set(...object.transform.scale);

        const assetSourceUrl = object.assetSourcePath
          ? state.assetSources[object.assetSourcePath] ?? null
          : null;

        if (assetSourceUrl) {
          void gltfLoader
            .loadAsync(assetSourceUrl)
            .then((gltf) => {
              if (!scene) return;
              rootObject.add(gltf.scene.clone(true));
            })
            .catch(() => {
              rootObject.add(createFallbackMesh());
            });
        } else {
          rootObject.add(createFallbackMesh());
        }

        scene.add(rootObject);
        sceneObjectEntries.set(object.instanceId, { root: rootObject });
      }
    }

    world = new World();
    const player = world.createEntity();
    world.addComponent(player, new Position(0, 0, 0));
    world.addComponent(player, new Velocity());
    world.addComponent(player, new PlayerControlled(8));
    world.addComponent(player, new CameraTarget());
    world.addComponent(player, new Renderable("player", true));

    const playerGeometry = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
    const playerMaterial = new THREE.MeshStandardMaterial({
      color: PLAYER_COLOR
    });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(0, 0.7, 0);
    scene.add(playerMesh);

    const movementSystem = new MovementSystem();
    world.addSystem(movementSystem);

    inputManager = createRuntimeInputManager();
    inputManager.attach(root);
    movementSystem.setInputProvider(
      () => inputManager?.getInput() ?? { moveX: 0, moveY: 0 }
    );

    cameraState = createCameraState(DEFAULT_CAMERA_CONFIG);
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
