import * as THREE from "three";
import type { RegionDocument } from "@sugarmagic/domain";
import {
  resolveSceneObjects,
  computeSceneDelta,
  type SceneObject
} from "@sugarmagic/runtime-core";
import type { WorkspaceViewport } from "@sugarmagic/workspaces";

const CUBE_COLOR = 0x89b4fa;
const GRID_COLOR = 0x45475a;
const BG_COLOR = 0x1e1e2e;

function createMeshForSceneObject(obj: SceneObject): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: CUBE_COLOR });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    obj.transform.position[0],
    obj.transform.position[1],
    obj.transform.position[2]
  );
  mesh.rotation.set(
    obj.transform.rotation[0],
    obj.transform.rotation[1],
    obj.transform.rotation[2]
  );
  mesh.scale.set(
    obj.transform.scale[0],
    obj.transform.scale[1],
    obj.transform.scale[2]
  );
  mesh.name = obj.instanceId;
  return mesh;
}

export function createAuthoringViewport(): WorkspaceViewport {
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

  const authoredRoot = new THREE.Group();
  authoredRoot.name = "authoring-authored-root";
  scene.add(authoredRoot);

  const overlayRoot = new THREE.Group();
  overlayRoot.name = "authoring-overlay-root";
  scene.add(overlayRoot);

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
    authoredRoot,
    overlayRoot,

    mount(element: HTMLElement) {
      container = element;
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      element.appendChild(renderer.domElement);

      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderLoop();
    },

    unmount() {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer.dispose();
    },

    updateFromRegion(region: RegionDocument) {
      const currentObjects = resolveSceneObjects(region);
      const delta = computeSceneDelta(previousObjects, currentObjects);

      for (const id of delta.removed) {
        const mesh = meshMap.get(id);
        if (!mesh) continue;

        authoredRoot.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        meshMap.delete(id);
      }

      for (const object of delta.added) {
        const mesh = createMeshForSceneObject(object);
        authoredRoot.add(mesh);
        meshMap.set(object.instanceId, mesh);
      }

      for (const object of delta.updated) {
        const mesh = meshMap.get(object.instanceId);
        if (!mesh) continue;

        mesh.position.set(
          object.transform.position[0],
          object.transform.position[1],
          object.transform.position[2]
        );
        mesh.rotation.set(
          object.transform.rotation[0],
          object.transform.rotation[1],
          object.transform.rotation[2]
        );
        mesh.scale.set(
          object.transform.scale[0],
          object.transform.scale[1],
          object.transform.scale[2]
        );
      }

      previousObjects = currentObjects;
    },

    previewTransform(instanceId, position, rotation, scale) {
      const mesh = meshMap.get(instanceId);
      if (!mesh) return;

      mesh.position.set(position[0], position[1], position[2]);
      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
    },

    resize(width, height) {
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
