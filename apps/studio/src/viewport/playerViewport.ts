import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  createPlayerPreviewController,
  type PlayerPreviewWarning
} from "@sugarmagic/runtime-core";
import {
  selectPlayerPreviewProjection,
  shallowEqual,
  subscribeToProjection,
  type ProjectionStores
} from "@sugarmagic/shell";
import {
  createPlayerCameraController,
  type PlayerWorkspaceViewport
} from "@sugarmagic/workspaces";
import { syncDesignPreviewCameraFraming } from "./design-preview-camera-framing";

const GRID_COLOR = 0x45475a;

function createStageGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(8, 16, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0.001;
  return grid;
}

function disposeGrid(grid: THREE.GridHelper) {
  grid.geometry.dispose();
}

function createStagePlane(): THREE.Mesh {
  const plane = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshStandardMaterial({
      color: 0x313244,
      roughness: 0.9,
      metalness: 0.02
    })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

export interface PlayerViewportOptions {
  stores: ProjectionStores;
}

export function createPlayerViewport(
  options: PlayerViewportOptions
): PlayerWorkspaceViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e2e);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(2.4, 1.8, 3.2);
  camera.lookAt(0, 1, 0);

  const ambientLight = new THREE.HemisphereLight(0xe0f2ff, 0x12131c, 1.15);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(4, 6, 3);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xa5c7ff, 0.45);
  fillLight.position.set(-3, 3, -4);
  scene.add(fillLight);

  const stageRoot = new THREE.Group();
  stageRoot.name = "player-preview-stage-root";
  const stagePlane = createStagePlane();
  stageRoot.add(stagePlane);
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createPlayerPreviewController(scene);
  const cameraController = createPlayerCameraController();
  const frameListeners = new Set<() => void>();
  let renderer: WebGPURenderer | null = null;
  let animationFrameId: number | null = null;
  let container: HTMLElement | null = null;
  let lastFrameTime = 0;
  let warnings: PlayerPreviewWarning[] = [];
  let unsubscribeProjection: (() => void) | null = null;
  let cameraSyncUnsubscribe: (() => void) | null = null;

  function renderLoop(timestamp: number) {
    const deltaSeconds =
      lastFrameTime === 0 ? 1 / 60 : (timestamp - lastFrameTime) / 1000;
    lastFrameTime = timestamp;

    previewController.update(deltaSeconds);
    for (const listener of frameListeners) {
      listener();
    }

    renderer?.render(scene, camera);
    animationFrameId = requestAnimationFrame(renderLoop);
  }

  return {
    setProjectionMode() {},
    mount(element) {
      container = element;
      const nextRenderer = new WebGPURenderer({ antialias: true });
      renderer = nextRenderer;
      nextRenderer.domElement.style.display = "block";
      nextRenderer.domElement.style.width = "100%";
      nextRenderer.domElement.style.height = "100%";
      element.appendChild(nextRenderer.domElement);

      void nextRenderer
        .init()
        .then(() => {
          if (container !== element || renderer !== nextRenderer) {
            nextRenderer.dispose();
            return;
          }

          nextRenderer.setPixelRatio(window.devicePixelRatio);
          const width = element.clientWidth || 1;
          const height = element.clientHeight || 1;
          nextRenderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          const syncCameraFraming = () => {
            syncDesignPreviewCameraFraming(
              options.stores.designPreviewStore,
              camera,
              previewController.stageTargetHeight
            );
          };
          cameraController.attach(camera, element, (listener) => {
            frameListeners.add(listener);
            return () => {
              frameListeners.delete(listener);
            };
          }, 1);
          cameraSyncUnsubscribe = () => {
            frameListeners.delete(syncCameraFraming);
          };
          frameListeners.add(syncCameraFraming);
          lastFrameTime = 0;
          animationFrameId = requestAnimationFrame(renderLoop);
          unsubscribeProjection = subscribeToProjection(
            options.stores,
            ({ project, shell, designPreview, assetSources }) => {
              const projection = selectPlayerPreviewProjection(
                project,
                shell,
                designPreview,
                assetSources
              );
              return {
                playerDefinition: projection.playerDefinition,
                contentLibrary: projection.contentLibrary,
                assetSources: projection.assetSources,
                animationSlot: projection.animationSlot,
                isAnimationPlaying: projection.isAnimationPlaying
              };
            },
            (projection) => {
              if (!projection.playerDefinition || !projection.contentLibrary) {
                return;
              }
              const targetY = Math.max(
                projection.playerDefinition.physicalProfile.eyeHeight * 0.7,
                projection.playerDefinition.physicalProfile.height * 0.5
              );
              cameraController.updateTarget(targetY);
              void previewController
                .apply({
                  playerDefinition: projection.playerDefinition,
                  contentLibrary: projection.contentLibrary,
                  assetSources: projection.assetSources,
                  activeAnimationSlot: projection.animationSlot as never,
                  isPlaying: projection.isAnimationPlaying
                })
                .then((result) => {
                  warnings = result.warnings;
                  if (warnings.length > 0) {
                    console.warn("[sugarmagic] Player preview warnings", warnings);
                  }
                });
            },
            { equalityFn: shallowEqual }
          );
        })
        .catch((error) => {
          console.error("[sugarmagic] Failed to initialize player preview viewport.", error);
        });
    },

    unmount() {
      warnings = [];
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      cameraSyncUnsubscribe?.();
      cameraSyncUnsubscribe = null;
      cameraController.detach();
      previewController.dispose();
      unsubscribeProjection?.();
      unsubscribeProjection = null;
      scene.remove(grid);

      if (container && renderer?.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
      container = null;
      disposeGrid(grid);
    },
    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer?.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    render() {
      renderer?.render(scene, camera);
    },

    subscribeFrame(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    }
  };
}
