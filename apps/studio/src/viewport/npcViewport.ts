import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  createNPCPreviewController,
  type NPCPreviewWarning
} from "@sugarmagic/runtime-core";
import {
  selectNPCPreviewProjection,
  shallowEqual,
  subscribeToProjection,
  type ProjectionStores
} from "@sugarmagic/shell";
import {
  createNPCCameraController,
  type NPCWorkspaceViewport
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
    new THREE.CircleGeometry(3.1, 48),
    new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      roughness: 0.92,
      metalness: 0.02
    })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

export interface NPCViewportOptions {
  stores: ProjectionStores;
}

export function createNPCViewport(
  options: NPCViewportOptions
): NPCWorkspaceViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e2e);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(2.8, 1.7, 3.4);
  camera.lookAt(0, 1, 0);

  const ambientLight = new THREE.HemisphereLight(0xe6f7ff, 0x12131c, 1.1);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(4, 6, 2);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xb7ffd9, 0.4);
  rimLight.position.set(-2, 3, -4);
  scene.add(rimLight);

  const stageRoot = new THREE.Group();
  stageRoot.name = "npc-preview-stage-root";
  stageRoot.add(createStagePlane());
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createNPCPreviewController(scene);
  const cameraController = createNPCCameraController();
  const frameListeners = new Set<() => void>();
  let renderer: WebGPURenderer | null = null;
  let animationFrameId: number | null = null;
  let container: HTMLElement | null = null;
  let lastFrameTime = 0;
  let warnings: NPCPreviewWarning[] = [];
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
              const projection = selectNPCPreviewProjection(
                project,
                shell,
                designPreview,
                assetSources
              );
              return {
                npcDefinition: projection.npcDefinition,
                contentLibrary: projection.contentLibrary,
                assetSources: projection.assetSources,
                animationSlot: projection.animationSlot,
                isAnimationPlaying: projection.isAnimationPlaying
              };
            },
            (projection) => {
              if (!projection.npcDefinition || !projection.contentLibrary) {
                return;
              }
              cameraController.updateTarget(
                Math.max(projection.npcDefinition.presentation.modelHeight * 0.55, 0.85)
              );
              void previewController
                .apply({
                  npcDefinition: projection.npcDefinition,
                  contentLibrary: projection.contentLibrary,
                  assetSources: projection.assetSources,
                  activeAnimationSlot: projection.animationSlot as never,
                  isPlaying: projection.isAnimationPlaying
                })
                .then((result) => {
                  warnings = result.warnings;
                  if (warnings.length > 0) {
                    console.warn("[sugarmagic] NPC preview warnings", warnings);
                  }
                });
            },
            { equalityFn: shallowEqual }
          );
        })
        .catch((error) => {
          console.error("[sugarmagic] Failed to initialize NPC preview viewport.", error);
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
