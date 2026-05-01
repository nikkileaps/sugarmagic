import * as THREE from "three";
import { createRenderView, type WebRenderEngine } from "@sugarmagic/render-web";
import {
  createItemPreviewController,
  type ItemPreviewWarning
} from "@sugarmagic/runtime-core";
import {
  selectItemPreviewProjection,
  shallowEqual,
  subscribeToProjection,
  type ProjectionStores
} from "@sugarmagic/shell";
import {
  createItemCameraController,
  type ItemWorkspaceViewport
} from "@sugarmagic/workspaces";
import { syncDesignPreviewCameraFraming } from "./design-preview-camera-framing";

const GRID_COLOR = 0x45475a;

function createStageGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(4, 8, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0.001;
  return grid;
}

function disposeGrid(grid: THREE.GridHelper) {
  grid.geometry.dispose();
}

function createStagePlane(): THREE.Mesh {
  const plane = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({
      color: 0x2f3247,
      roughness: 0.92,
      metalness: 0.02
    })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = true;
  return plane;
}

export interface ItemViewportOptions {
  engine: WebRenderEngine;
  stores: ProjectionStores;
}

export function createItemViewport(
  options: ItemViewportOptions
): ItemWorkspaceViewport {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(1.6, 1.2, 2.2);
  camera.lookAt(0, 0.4, 0);

  const stageRoot = new THREE.Group();
  stageRoot.name = "item-preview-stage-root";
  stageRoot.add(createStagePlane());
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createItemPreviewController(scene);
  const cameraController = createItemCameraController();
  const renderView = createRenderView({
    engine: options.engine,
    scene,
    camera,
    compileProfile: "authoring-preview"
  });
  let warnings: ItemPreviewWarning[] = [];
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
          0.2
        );
      };
      cameraController.attach(camera, element, renderView.subscribeFrame, 0.2);
      const stopFramingSync = renderView.subscribeFrame(syncCameraFraming);
      cameraSyncUnsubscribe = () => {
        stopFramingSync();
      };
      unsubscribeProjection = subscribeToProjection(
        options.stores,
        ({ project, shell, designPreview, assetSources }) => {
          const projection = selectItemPreviewProjection(
            project,
            shell,
            designPreview,
            assetSources
          );
          return {
            itemDefinition: projection.itemDefinition,
            contentLibrary: projection.contentLibrary,
            assetSources: projection.assetSources
          };
        },
        (projection) => {
          if (!projection.itemDefinition || !projection.contentLibrary) {
            return;
          }
          // Items render at their GLB's authored size, so we no longer have a
          // definition-level height to drive the inspector camera target.
          // 0.25m centers the preview reasonably for typical-prop-scale GLBs.
          cameraController.updateTarget(0.25);
          void previewController.apply({
            itemDefinition: projection.itemDefinition,
            contentLibrary: projection.contentLibrary,
            assetSources: projection.assetSources
          }).then((result) => {
            warnings = result.warnings;
            if (warnings.length > 0) {
              console.warn("[sugarmagic] Item preview warnings", warnings);
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
