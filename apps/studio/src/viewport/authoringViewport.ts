import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
  type RegionLandscapeState
} from "@sugarmagic/domain";
import {
  resolveSceneObjects,
  computeSceneDelta,
  createEnvironmentSceneController,
  createLandscapeSceneController,
  createRuntimeRenderPipeline,
  resolveEnvironmentDefinition,
  type SceneObject
} from "@sugarmagic/runtime-core";
import type {
  WorkspaceViewport,
  ViewportSceneState
} from "@sugarmagic/workspaces";

const CUBE_COLOR = 0x89b4fa;
const GRID_COLOR = 0x45475a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
  assetSourceUrl: string | null;
}

interface LandscapeGridSpec {
  size: number;
  divisions: number;
}

function resolveLandscapeGridSpec(
  landscape: RegionLandscapeState | null | undefined
): LandscapeGridSpec {
  const size =
    landscape && Number.isFinite(landscape.size) && landscape.size > 0
      ? landscape.size
      : DEFAULT_REGION_LANDSCAPE_SIZE;

  return {
    size,
    divisions: Math.max(1, Math.min(200, Math.round(size)))
  };
}

function createLandscapeGrid(spec: LandscapeGridSpec): THREE.GridHelper {
  const grid = new THREE.GridHelper(spec.size, spec.divisions, GRID_COLOR, GRID_COLOR);
  grid.position.y = 0.01;
  grid.name = "authoring-landscape-grid";
  return grid;
}

function disposeGrid(grid: THREE.GridHelper) {
  grid.geometry.dispose();
}

function createFallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: CUBE_COLOR })
  );
}

function createCapsuleFallback(object: SceneObject): THREE.Mesh {
  const capsule = object.capsule;
  if (!capsule) {
    return createFallbackMesh();
  }

  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      capsule.radius,
      Math.max(0.05, capsule.height - capsule.radius * 2),
      8,
      16
    ),
    new THREE.MeshStandardMaterial({
      color: capsule.color,
      roughness: 0.38,
      metalness: 0.04
    })
  );
  mesh.position.y = capsule.height / 2;
  return mesh;
}

function applyObjectTransform(root: THREE.Object3D, object: SceneObject) {
  root.position.set(
    object.transform.position[0],
    object.transform.position[1],
    object.transform.position[2]
  );
  root.rotation.set(
    object.transform.rotation[0],
    object.transform.rotation[1],
    object.transform.rotation[2]
  );
  root.scale.set(
    object.transform.scale[0],
    object.transform.scale[1],
    object.transform.scale[2]
  );
}

function normalizeModelScale(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= 0) return;

  const scale = targetHeight / size.y;
  root.scale.setScalar(scale);
  box.setFromObject(root);
  root.position.y -= box.min.y;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else {
      child.material.dispose();
    }
  });
}

async function createRenderableRoot(
  object: SceneObject,
  assetSources: Record<string, string>
): Promise<SceneObjectEntry> {
  const root = new THREE.Group();
  root.name = object.instanceId;
  applyObjectTransform(root, object);

  const assetSourceUrl =
    object.modelSourcePath ? assetSources[object.modelSourcePath] ?? null : null;

  if (!assetSourceUrl) {
    root.add(object.kind === "asset" ? createFallbackMesh() : createCapsuleFallback(object));
    return { root, assetSourceUrl: null };
  }

  try {
    const gltf = await gltfLoader.loadAsync(assetSourceUrl);
    const renderable = gltf.scene.clone(true);
    if (object.targetModelHeight) {
      normalizeModelScale(renderable, object.targetModelHeight);
    }
    root.add(renderable);
    return { root, assetSourceUrl };
  } catch {
    root.add(object.kind === "asset" ? createFallbackMesh() : createCapsuleFallback(object));
    return { root, assetSourceUrl };
  }
}

export function createAuthoringViewport(): WorkspaceViewport {
  const scene = new THREE.Scene();
  const environmentController = createEnvironmentSceneController(scene);
  const landscapeController = createLandscapeSceneController(scene);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  let renderer: WebGPURenderer | null = null;
  let renderPipeline: ReturnType<typeof createRuntimeRenderPipeline> | null = null;
  let currentGridSpec = resolveLandscapeGridSpec(null);
  let grid = createLandscapeGrid(currentGridSpec);
  scene.add(grid);

  const authoredRoot = new THREE.Group();
  authoredRoot.name = "authoring-authored-root";
  scene.add(authoredRoot);

  const overlayRoot = new THREE.Group();
  overlayRoot.name = "authoring-overlay-root";
  scene.add(overlayRoot);

  const objectMap = new Map<string, SceneObjectEntry>();
  const frameListeners = new Set<() => void>();
  let previousObjects: SceneObject[] = [];
  let currentState: ViewportSceneState | null = null;
  let animationId: number | null = null;
  let container: HTMLElement | null = null;
  let renderGeneration = 0;
  let mountGeneration = 0;

  function syncLandscapeGrid(landscape: RegionLandscapeState | null | undefined) {
    const nextSpec = resolveLandscapeGridSpec(landscape);
    if (
      nextSpec.size === currentGridSpec.size &&
      nextSpec.divisions === currentGridSpec.divisions
    ) {
      return;
    }

    scene.remove(grid);
    disposeGrid(grid);
    grid = createLandscapeGrid(nextSpec);
    scene.add(grid);
    currentGridSpec = nextSpec;
  }

  function renderLoop() {
    for (const listener of frameListeners) {
      listener();
    }
    if (renderPipeline) {
      renderPipeline.render();
    } else if (renderer) {
      renderer.render(scene, camera);
    }
    animationId = requestAnimationFrame(renderLoop);
  }

  return {
    scene,
    camera,
    authoredRoot,
    overlayRoot,
    surfaceRoot: landscapeController.surfaceRoot,

    mount(element: HTMLElement) {
      container = element;
      const generation = ++mountGeneration;
      const nextRenderer = new WebGPURenderer({ antialias: true });
      renderer = nextRenderer;
      nextRenderer.domElement.style.display = "block";
      nextRenderer.domElement.style.width = "100%";
      nextRenderer.domElement.style.height = "100%";
      element.appendChild(nextRenderer.domElement);

      void nextRenderer
        .init()
        .then(() => {
          if (mountGeneration !== generation || container !== element) {
            nextRenderer.dispose();
            if (nextRenderer.domElement.parentElement === element) {
              element.removeChild(nextRenderer.domElement);
            }
            return;
          }

          nextRenderer.setPixelRatio(window.devicePixelRatio);
          const width = element.clientWidth || 1;
          const height = element.clientHeight || 1;
          nextRenderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderPipeline = createRuntimeRenderPipeline({
            renderer: nextRenderer,
            scene,
            camera,
            width,
            height
          });

          renderLoop();
        })
        .catch((error) => {
          console.error("[sugarmagic] Failed to initialize WebGPU authoring viewport.", error);
        });
    },

    unmount() {
      renderGeneration += 1;

      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      for (const entry of objectMap.values()) {
        authoredRoot.remove(entry.root);
        disposeObject(entry.root);
      }
      objectMap.clear();
      currentState = null;
      environmentController.dispose();
      landscapeController.dispose();
      renderPipeline?.dispose();
      renderPipeline = null;

      if (container && renderer?.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
    },

    updateFromRegion(state: ViewportSceneState) {
      currentState = state;
      const {
        region,
        contentLibrary,
        playerDefinition,
        npcDefinitions,
        assetSources,
        environmentOverrideId = null
      } = state;
      environmentController.apply(region, contentLibrary, environmentOverrideId);
      landscapeController.apply(region);
      syncLandscapeGrid(region.landscape);
      renderPipeline?.applyEnvironment(
        resolveEnvironmentDefinition(region, contentLibrary, environmentOverrideId)
      );

      const currentObjects = resolveSceneObjects(region, {
        contentLibrary,
        playerDefinition,
        npcDefinitions
      });
      const delta = computeSceneDelta(previousObjects, currentObjects);
      const generation = ++renderGeneration;

      for (const id of delta.removed) {
        const entry = objectMap.get(id);
        if (!entry) continue;
        authoredRoot.remove(entry.root);
        disposeObject(entry.root);
        objectMap.delete(id);
      }

      for (const object of delta.added) {
        void createRenderableRoot(object, assetSources).then((entry) => {
          if (generation !== renderGeneration) {
            disposeObject(entry.root);
            return;
          }
          authoredRoot.add(entry.root);
          objectMap.set(object.instanceId, entry);
        });
      }

      for (const object of delta.updated) {
        const existing = objectMap.get(object.instanceId);
        const nextAssetSourceUrl = object.modelSourcePath
          ? assetSources[object.modelSourcePath] ?? null
          : null;
        if (existing && existing.assetSourceUrl === nextAssetSourceUrl) {
          applyObjectTransform(existing.root, object);
          continue;
        }
        if (existing) {
          authoredRoot.remove(existing.root);
          disposeObject(existing.root);
          objectMap.delete(object.instanceId);
        }

        void createRenderableRoot(object, assetSources).then((entry) => {
          if (generation !== renderGeneration) {
            disposeObject(entry.root);
            return;
          }
          authoredRoot.add(entry.root);
          objectMap.set(object.instanceId, entry);
        });
      }

      for (const object of currentObjects) {
        const entry = objectMap.get(object.instanceId);
        const nextAssetSourceUrl = object.modelSourcePath
          ? assetSources[object.modelSourcePath] ?? null
          : null;
        if (entry && entry.assetSourceUrl !== nextAssetSourceUrl) {
          authoredRoot.remove(entry.root);
          disposeObject(entry.root);
          objectMap.delete(object.instanceId);

          void createRenderableRoot(object, assetSources).then((nextEntry) => {
            if (generation !== renderGeneration) {
              disposeObject(nextEntry.root);
              return;
            }
            authoredRoot.add(nextEntry.root);
            objectMap.set(object.instanceId, nextEntry);
          });
          continue;
        }
        if (!entry) continue;
        applyObjectTransform(entry.root, object);
      }

      previousObjects = currentObjects;
    },

    previewLandscape(landscape) {
      if (!currentState) return;
      landscapeController.applyLandscape(landscape);
      syncLandscapeGrid(landscape);
    },

    paintLandscapeAt(options) {
      return landscapeController.paintStroke({
        channelIndex: options.channelIndex,
        worldX: options.worldX,
        worldZ: options.worldZ,
        radius: options.radius,
        strength: options.strength,
        falloff: options.falloff
      });
    },

    renderLandscapeMask(channelIndex, canvas) {
      landscapeController.renderMaskToCanvas(channelIndex, canvas);
    },

    serializeLandscapePaintPayload() {
      return landscapeController.serializePaintPayload();
    },

    previewTransform(instanceId, position, rotation, scale) {
      const entry = objectMap.get(instanceId);
      if (!entry) return;

      entry.root.position.set(position[0], position[1], position[2]);
      entry.root.rotation.set(rotation[0], rotation[1], rotation[2]);
      entry.root.scale.set(scale[0], scale[1], scale[2]);
    },

    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderer?.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderPipeline?.resize(width, height);
    },

    render() {
      if (renderPipeline) {
        renderPipeline.render();
      } else if (renderer) {
        renderer.render(scene, camera);
      }
    },

    subscribeFrame(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    }
  };
}
