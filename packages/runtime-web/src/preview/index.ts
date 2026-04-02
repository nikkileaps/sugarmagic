import * as THREE from "three";
import type { RegionDocument } from "@sugarmagic/domain";
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
  type GameCameraState,
  type RuntimeBootModel
} from "@sugarmagic/runtime-core";

export interface PreviewBootMessage {
  type: "PREVIEW_BOOT";
  regions: RegionDocument[];
}

export interface PreviewReadyMessage {
  type: "PREVIEW_READY";
  boot: RuntimeBootModel;
}

export interface PreviewWindowHostOptions {
  root: HTMLElement;
  opener?: Window | null;
  ownerWindow?: Window;
}

export interface PreviewWindowHost {
  readonly boot: RuntimeBootModel;
  start: () => void;
  dispose: () => void;
}

const CUBE_COLOR = 0x89b4fa;
const PLAYER_COLOR = 0xa6e3a1;
const GRID_COLOR = 0x45475a;
const BG_COLOR = 0x1e1e2e;

export function createPreviewWindowHost(
  options: PreviewWindowHostOptions
): PreviewWindowHost {
  const { root, opener = null, ownerWindow = window } = options;

  const boot = createRuntimeBootModel({
    hostKind: "studio",
    compileProfile: "runtime-preview",
    contentSource: "authored-game-root"
  });

  let world: World | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let cameraState: GameCameraState | null = null;
  let inputManager: ReturnType<typeof createRuntimeInputManager> | null = null;
  let playerMesh: THREE.Mesh | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  let started = false;

  function disposeRuntime() {
    if (animationId !== null) {
      ownerWindow.cancelAnimationFrame(animationId);
      animationId = null;
    }

    inputManager?.detach();
    inputManager = null;
    cameraState = null;
    world = null;
    playerMesh = null;

    if (scene) {
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();

          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
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
  }

  function renderFrame(now: number) {
    if (!world || !cameraState || !camera || !renderer || !scene || !playerMesh || !inputManager) {
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
    renderer.render(scene, camera);

    animationId = ownerWindow.requestAnimationFrame(renderFrame);
  }

  function bootPreview(regions: RegionDocument[]) {
    disposeRuntime();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLOR);

    camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_CONFIG.fov,
      root.clientWidth / Math.max(root.clientHeight, 1),
      0.1,
      1000
    );

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(ownerWindow.devicePixelRatio);
    root.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    scene.add(directional);
    scene.add(new THREE.GridHelper(40, 40, GRID_COLOR, GRID_COLOR));

    for (const region of regions) {
      const objects = resolveSceneObjects(region);
      for (const object of objects) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: CUBE_COLOR });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...object.transform.position);
        mesh.rotation.set(...object.transform.rotation);
        mesh.scale.set(...object.transform.scale);
        mesh.name = object.instanceId;
        scene.add(mesh);
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
    const playerMaterial = new THREE.MeshStandardMaterial({ color: PLAYER_COLOR });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.set(0, 0.7, 0);
    scene.add(playerMesh);

    const movementSystem = new MovementSystem();
    world.addSystem(movementSystem);

    inputManager = createRuntimeInputManager();
    inputManager.attach(root);
    movementSystem.setInputProvider(() => inputManager?.getInput() ?? { moveX: 0, moveY: 0 });

    cameraState = createCameraState(DEFAULT_CAMERA_CONFIG);
    inputManager.onRightDrag = (dx, dy) => {
      if (cameraState) {
        cameraState = applyCameraDrag(cameraState, DEFAULT_CAMERA_CONFIG, dx, dy);
      }
    };
    inputManager.onScroll = (delta) => {
      if (cameraState) {
        cameraState = applyCameraZoom(cameraState, DEFAULT_CAMERA_CONFIG, delta);
      }
    };
    movementSystem.setCameraYawProvider(() => cameraState?.yaw ?? Math.PI * 1.25);

    handleResize();
    lastTime = ownerWindow.performance.now();
    animationId = ownerWindow.requestAnimationFrame(renderFrame);
  }

  function handleMessage(event: MessageEvent) {
    const data = event.data as PreviewBootMessage | undefined;
    if (data?.type === "PREVIEW_BOOT") {
      bootPreview(data.regions);
    }
  }

  function start() {
    if (started) return;
    started = true;

    ownerWindow.addEventListener("message", handleMessage);
    ownerWindow.addEventListener("resize", handleResize);
    ownerWindow.addEventListener("beforeunload", dispose);

    if (opener) {
      const message: PreviewReadyMessage = { type: "PREVIEW_READY", boot };
      opener.postMessage(message, "*");
    }
  }

  function dispose() {
    if (!started) return;
    started = false;

    ownerWindow.removeEventListener("message", handleMessage);
    ownerWindow.removeEventListener("resize", handleResize);
    ownerWindow.removeEventListener("beforeunload", dispose);

    disposeRuntime();
  }

  return {
    boot,
    start,
    dispose
  };
}
