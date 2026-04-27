import * as THREE from "three";
import { createRenderView, type WebRenderEngine } from "@sugarmagic/render-web";
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
  engine: WebRenderEngine;
  stores: ProjectionStores;
}

export function createPlayerViewport(
  options: PlayerViewportOptions
): PlayerWorkspaceViewport {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(2.4, 1.8, 3.2);
  camera.lookAt(0, 1, 0);

  const stageRoot = new THREE.Group();
  stageRoot.name = "player-preview-stage-root";
  const stagePlane = createStagePlane();
  stageRoot.add(stagePlane);
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createPlayerPreviewController(scene);
  const cameraController = createPlayerCameraController();
  const renderView = createRenderView({
    engine: options.engine,
    scene,
    camera,
    compileProfile: "authoring-preview"
  });
  let lastFrameTime = 0;
  let warnings: PlayerPreviewWarning[] = [];
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
      cameraSyncUnsubscribe = () => {
        stopPreviewTick();
      };
      const stopFramingSync = renderView.subscribeFrame(syncCameraFraming);
      const previousCameraSyncUnsubscribe = cameraSyncUnsubscribe;
      cameraSyncUnsubscribe = () => {
        previousCameraSyncUnsubscribe?.();
        stopFramingSync();
      };
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
