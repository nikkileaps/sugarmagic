import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  createNPCPreviewController,
  type NPCPreviewWarning
} from "@sugarmagic/runtime-core";
import type { NPCWorkspaceViewport } from "@sugarmagic/workspaces";

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

export function createNPCViewport(): NPCWorkspaceViewport {
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
  const frameListeners = new Set<() => void>();
  let renderer: WebGPURenderer | null = null;
  let animationFrameId: number | null = null;
  let container: HTMLElement | null = null;
  let lastFrameTime = 0;
  let warnings: NPCPreviewWarning[] = [];

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
          console.error("[sugarmagic] Failed to initialize NPC preview viewport.", error);
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

    updateFromNPC(state) {
      void previewController
        .apply({
          ...state,
          isPlaying: state.isAnimationPlaying
        })
        .then((result) => {
          warnings = result.warnings;
          if (warnings.length > 0) {
            console.warn("[sugarmagic] NPC preview warnings", warnings);
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
