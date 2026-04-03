import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  createPlayerPreviewController,
  type PlayerPreviewWarning
} from "@sugarmagic/runtime-core";
import type { PlayerWorkspaceViewport } from "@sugarmagic/workspaces";

const GRID_COLOR = 0x45475a;

function createStageGrid(): THREE.GridHelper {
  const grid = new THREE.GridHelper(8, 16, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0.001;
  return grid;
}

function disposeGrid(grid: THREE.GridHelper) {
  grid.geometry.dispose();
  if (Array.isArray(grid.material)) {
    for (const material of grid.material) {
      material.dispose();
    }
  } else {
    grid.material.dispose();
  }
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

export function createPlayerViewport(): PlayerWorkspaceViewport {
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
  const frameListeners = new Set<() => void>();
  let renderer: WebGPURenderer | null = null;
  let animationFrameId: number | null = null;
  let container: HTMLElement | null = null;
  let lastFrameTime = 0;
  let warnings: PlayerPreviewWarning[] = [];

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
          lastFrameTime = 0;
          animationFrameId = requestAnimationFrame(renderLoop);
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

      previewController.dispose();

      if (container && renderer?.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
      container = null;
      disposeGrid(grid);
    },

    updateFromPlayer(state) {
      void previewController
        .apply({
          ...state,
          isPlaying: state.isAnimationPlaying
        })
        .then((result) => {
          warnings = result.warnings;
          if (warnings.length > 0) {
            console.warn("[sugarmagic] Player preview warnings", warnings);
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
