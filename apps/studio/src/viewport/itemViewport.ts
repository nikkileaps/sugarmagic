import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  createItemPreviewController,
  type ItemPreviewWarning
} from "@sugarmagic/runtime-core";
import type { ItemWorkspaceViewport } from "@sugarmagic/workspaces";

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

export function createItemViewport(): ItemWorkspaceViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1e2e);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(1.6, 1.2, 2.2);
  camera.lookAt(0, 0.4, 0);

  const ambientLight = new THREE.HemisphereLight(0xf8f2d8, 0x12131c, 1.1);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(3, 5, 2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xf9e2af, 0.35);
  fillLight.position.set(-2, 3, -3);
  scene.add(fillLight);

  const stageRoot = new THREE.Group();
  stageRoot.name = "item-preview-stage-root";
  stageRoot.add(createStagePlane());
  scene.add(stageRoot);

  const grid = createStageGrid();
  scene.add(grid);

  const previewController = createItemPreviewController(scene);
  const frameListeners = new Set<() => void>();
  let renderer: WebGPURenderer | null = null;
  let container: HTMLElement | null = null;
  let animationFrameId: number | null = null;
  let warnings: ItemPreviewWarning[] = [];

  return {
    scene,
    camera,
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
          const loop = () => {
            for (const listener of frameListeners) {
              listener();
            }
            renderer?.render(scene, camera);
            animationFrameId = requestAnimationFrame(loop);
          };
          animationFrameId = requestAnimationFrame(loop);
        })
        .catch((error) => {
          console.error("[sugarmagic] Failed to initialize item preview viewport.", error);
        });
    },
    unmount() {
      warnings = [];
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      previewController.dispose();
      scene.remove(grid);

      if (container && renderer?.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
      container = null;
      disposeGrid(grid);
    },
    updateFromItem(state) {
      void previewController.apply(state).then((result) => {
        warnings = result.warnings;
        if (warnings.length > 0) {
          console.warn("[sugarmagic] Item preview warnings", warnings);
        }
      });
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
