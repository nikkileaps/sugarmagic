import * as THREE from "three";
import { createRenderView, type WebRenderEngine } from "@sugarmagic/render-web";
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
  engine: WebRenderEngine;
  stores: ProjectionStores;
}

export function createNPCViewport(
  options: NPCViewportOptions
): NPCWorkspaceViewport {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(2.8, 1.7, 3.4);
  camera.lookAt(0, 1, 0);

  const stageRoot = new THREE.Group();
  stageRoot.name = "npc-preview-stage-root";
  stageRoot.add(createStagePlane());
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createNPCPreviewController(scene);
  const cameraController = createNPCCameraController();
  const renderView = createRenderView({
    engine: options.engine,
    scene,
    camera,
    compileProfile: "authoring-preview"
  });
  let lastFrameTime = 0;
  let warnings: NPCPreviewWarning[] = [];
  let unsubscribeProjection: (() => void) | null = null;
  let cameraSyncUnsubscribe: (() => void) | null = null;

  return {
    setProjectionMode() {},
    mount(element) {
      renderView.mount(element);
      renderView.startRenderLoop();
      camera.aspect = (element.clientWidth || 1) / (element.clientHeight || 1);
      camera.updateProjectionMatrix();
      const syncCameraFraming = () => {
        syncDesignPreviewCameraFraming(
          options.stores.designPreviewStore,
          camera,
          previewController.stageTargetHeight
        );
      };
      const tickPreviewController = () => {
        const now = performance.now();
        const deltaSeconds =
          lastFrameTime === 0 ? 1 / 60 : (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        previewController.update(deltaSeconds);
      };
      cameraController.attach(camera, element, renderView.subscribeFrame, 1);
      const stopPreviewTick = renderView.subscribeFrame(tickPreviewController);
      const stopFramingSync = renderView.subscribeFrame(syncCameraFraming);
      cameraSyncUnsubscribe = () => {
        stopPreviewTick();
        stopFramingSync();
      };
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
    },

    unmount() {
      warnings = [];
      cameraSyncUnsubscribe?.();
      cameraSyncUnsubscribe = null;
      cameraController.detach();
      previewController.dispose();
      unsubscribeProjection?.();
      unsubscribeProjection = null;
      scene.remove(grid);
      renderView.unmount();
      disposeGrid(grid);
    },
    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderView.resize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    render() {
      renderView.render();
    },

    subscribeFrame(listener) {
      return renderView.subscribeFrame(listener);
    }
  };
}
