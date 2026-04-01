/**
 * Three.js runtime viewport — browser-specific rendering adapter.
 *
 * Scene loading semantics (what objects exist, transforms) are owned
 * by runtime-core. This adapter only handles Three.js rendering.
 */

import * as THREE from "three";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  resolveSceneObjects,
  computeSceneDelta,
  type SceneObject
} from "@sugarmagic/runtime-core";

export interface RuntimeViewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  mount: (container: HTMLElement) => void;
  unmount: () => void;
  updateFromRegion: (region: RegionDocument) => void;
  resize: (width: number, height: number) => void;
  render: () => void;
}

const CUBE_COLOR = 0x89b4fa;
const GRID_COLOR = 0x45475a;
const BG_COLOR = 0x1e1e2e;

function createMeshForSceneObject(obj: SceneObject): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: CUBE_COLOR });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...obj.transform.position);
  mesh.rotation.set(...obj.transform.rotation);
  mesh.scale.set(...obj.transform.scale);
  mesh.name = obj.instanceId;
  return mesh;
}

export function createRuntimeViewport(): RuntimeViewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  scene.add(directional);

  const grid = new THREE.GridHelper(20, 20, GRID_COLOR, GRID_COLOR);
  scene.add(grid);

  const meshMap = new Map<string, THREE.Mesh>();
  let previousObjects: SceneObject[] = [];
  let animationId: number | null = null;
  let container: HTMLElement | null = null;

  function renderLoop() {
    renderer.render(scene, camera);
    animationId = requestAnimationFrame(renderLoop);
  }

  return {
    scene,
    camera,
    renderer,

    mount(el: HTMLElement) {
      container = el;
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      el.appendChild(renderer.domElement);

      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      renderLoop();
    },

    unmount() {
      if (animationId !== null) cancelAnimationFrame(animationId);
      animationId = null;
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    },

    updateFromRegion(region: RegionDocument) {
      // Scene loading semantics come from runtime-core
      const currentObjects = resolveSceneObjects(region);
      const delta = computeSceneDelta(previousObjects, currentObjects);

      for (const id of delta.removed) {
        const mesh = meshMap.get(id);
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          meshMap.delete(id);
        }
      }

      for (const obj of delta.added) {
        const mesh = createMeshForSceneObject(obj);
        scene.add(mesh);
        meshMap.set(obj.instanceId, mesh);
      }

      for (const obj of delta.updated) {
        const mesh = meshMap.get(obj.instanceId);
        if (mesh) {
          mesh.position.set(...obj.transform.position);
          mesh.rotation.set(...obj.transform.rotation);
          mesh.scale.set(...obj.transform.scale);
        }
      }

      previousObjects = currentObjects;
    },

    resize(width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    render() {
      renderer.render(scene, camera);
    }
  };
}
