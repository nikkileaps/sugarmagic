import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  applyShaderToRenderable,
  createWebRenderHost,
  releaseShadersFromObjectTree,
  type ShaderRuntime,
  type WebRenderHost
} from "@sugarmagic/render-web";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
  type RegionLandscapeState
} from "@sugarmagic/domain";
import {
  resolveSceneObjects,
  computeSceneDelta,
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
  representationKey: string;
  shaderBindingsApplied: boolean;
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
  const runtimeManagedMaterials = releaseShadersFromObjectTree(root);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        if (!runtimeManagedMaterials.has(material)) {
          material.dispose();
        }
      }
    } else {
      if (!runtimeManagedMaterials.has(child.material)) {
        child.material.dispose();
      }
    }
  });
}

async function createRenderableRoot(
  object: SceneObject,
  assetSources: Record<string, string>,
  shaderRuntime: ShaderRuntime | null,
  host: WebRenderHost
): Promise<SceneObjectEntry> {
  const root = new THREE.Group();
  root.name = object.instanceId;
  applyObjectTransform(root, object);

  const assetSourceUrl =
    object.modelSourcePath ? assetSources[object.modelSourcePath] ?? null : null;

  if (!assetSourceUrl) {
    console.warn("[studio-viewport:renderable:fallback]", {
      instanceId: object.instanceId,
      assetSourceUrl: null,
      hasShaderRuntimeAtLoad: shaderRuntime !== null
    });
    root.add(object.kind === "asset" ? createFallbackMesh() : createCapsuleFallback(object));
    return {
      root,
      assetSourceUrl: null,
      representationKey: object.representationKey,
      shaderBindingsApplied: false
    };
  }

  try {
    const gltf = await gltfLoader.loadAsync(assetSourceUrl);
    const renderable = gltf.scene.clone(true);
    if (object.targetModelHeight) {
      normalizeModelScale(renderable, object.targetModelHeight);
    }
    host.enableShadowsOnObject(renderable);
    applyShaderToRenderable(renderable, object, shaderRuntime);
    console.warn("[studio-viewport:renderable:loaded]", {
      instanceId: object.instanceId,
      assetSourceUrl,
      hasShaderRuntimeAtLoad: shaderRuntime !== null,
      surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
      deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null
    });
    root.add(renderable);
    return {
      root,
      assetSourceUrl,
      representationKey: object.representationKey,
      shaderBindingsApplied: shaderRuntime !== null
    };
  } catch {
    console.warn("[studio-viewport:renderable:error-fallback]", {
      instanceId: object.instanceId,
      assetSourceUrl,
      hasShaderRuntimeAtLoad: shaderRuntime !== null
    });
    root.add(object.kind === "asset" ? createFallbackMesh() : createCapsuleFallback(object));
    return {
      root,
      assetSourceUrl,
      representationKey: object.representationKey,
      shaderBindingsApplied: false
    };
  }
}

function ensureRenderableShadersApplied(
  entry: SceneObjectEntry,
  object: SceneObject,
  shaderRuntime: ShaderRuntime | null
) {
  console.warn("[studio-viewport:ensure-shaders]", {
    instanceId: object.instanceId,
    shaderBindingsApplied: entry.shaderBindingsApplied,
    hasShaderRuntime: shaderRuntime !== null,
    surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
    deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null
  });
  if (!shaderRuntime || entry.shaderBindingsApplied) {
    return;
  }
  applyShaderToRenderable(entry.root, object, shaderRuntime);
  entry.shaderBindingsApplied = true;
}

export function createAuthoringViewport(): WorkspaceViewport {
  const scene = new THREE.Scene();

  const perspectiveCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  perspectiveCamera.position.set(5, 5, 5);
  perspectiveCamera.lookAt(0, 0, 0);

  const orthographicCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 1000);
  orthographicCamera.position.set(0, 48, 0.001);
  orthographicCamera.up.set(0, 0, -1);
  orthographicCamera.lookAt(0, 0, 0);
  orthographicCamera.zoom = 1;
  orthographicCamera.updateProjectionMatrix();

  let projectionMode: "perspective" | "orthographic-top" = "perspective";
  let activeCamera: THREE.Camera = perspectiveCamera;

  // Single shared host owns renderer config, render pipeline, shader runtime,
  // environment + landscape controllers, post-process application, and the
  // render loop. Studio composes authoring-specific state on top of it.
  const host: WebRenderHost = createWebRenderHost({
    scene,
    camera: activeCamera,
    compileProfile: "authoring-preview"
  });

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
  const pendingRenderableLoads = new Set<string>();
  let previousObjects: SceneObject[] = [];
  let currentState: ViewportSceneState | null = null;
  let renderGeneration = 0;

  function scheduleRenderableLoad(
    object: SceneObject,
    assetSources: Record<string, string>,
    activeShaderRuntime: ShaderRuntime | null,
    generation: number
  ) {
    if (pendingRenderableLoads.has(object.instanceId)) {
      return;
    }

    pendingRenderableLoads.add(object.instanceId);
    void createRenderableRoot(object, assetSources, activeShaderRuntime, host)
      .then((entry) => {
        pendingRenderableLoads.delete(object.instanceId);
        if (generation !== renderGeneration) {
          disposeObject(entry.root);
          return;
        }
        const existing = objectMap.get(object.instanceId);
        if (existing) {
          authoredRoot.remove(existing.root);
          disposeObject(existing.root);
        }
        authoredRoot.add(entry.root);
        ensureRenderableShadersApplied(entry, object, host.shaderRuntime);
        objectMap.set(object.instanceId, entry);
      })
      .catch(() => {
        pendingRenderableLoads.delete(object.instanceId);
      });
  }

  function syncCameraProjection(width: number, height: number) {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    const aspect = safeWidth / safeHeight;

    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();

    const halfHeight = 20;
    orthographicCamera.left = -halfHeight * aspect;
    orthographicCamera.right = halfHeight * aspect;
    orthographicCamera.top = halfHeight;
    orthographicCamera.bottom = -halfHeight;
    orthographicCamera.updateProjectionMatrix();
  }

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

  return {
    scene,
    get camera() {
      return activeCamera;
    },
    authoredRoot,
    overlayRoot,
    surfaceRoot: host.landscapeController.surfaceRoot,
    setProjectionMode(mode) {
      projectionMode = mode;
      activeCamera =
        projectionMode === "orthographic-top"
          ? orthographicCamera
          : perspectiveCamera;
      host.setCamera(activeCamera);
    },

    mount(element: HTMLElement) {
      host.mount(element);
      // Studio has no gameplay loop of its own — let the host drive rendering
      // so frame listeners fire every tick. Runtime host (which has its own
      // gameplay loop) does NOT opt into this; it calls host.render() from
      // its own loop instead.
      host.startRenderLoop();
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      syncCameraProjection(width, height);
    },

    unmount() {
      renderGeneration += 1;

      for (const entry of objectMap.values()) {
        authoredRoot.remove(entry.root);
        disposeObject(entry.root);
      }
      objectMap.clear();
      pendingRenderableLoads.clear();
      currentState = null;
      host.unmount();
    },

    updateFromRegion(state: ViewportSceneState) {
      currentState = state;
      const {
        region,
        contentLibrary,
        playerDefinition,
        itemDefinitions,
        npcDefinitions,
        assetSources,
        environmentOverrideId = null
      } = state;
      console.warn("[studio-viewport:update-from-region]", {
        regionId: region.identity.id,
        environmentOverrideId,
        activeEnvironmentId: region.environmentBinding.defaultEnvironmentId,
        hasShaderRuntime: host.shaderRuntime !== null
      });
      console.warn(
        `[studio-viewport:update-from-region:summary] region=${region.identity.id} override=${environmentOverrideId ?? "none"} regionEnv=${region.environmentBinding.defaultEnvironmentId ?? "none"} shaderRuntime=${host.shaderRuntime !== null}`
      );
      // Host handles environment + post-process apply, and keeps the shader
      // runtime's content library in sync without dispose/recreate.
      host.applyEnvironment(region, contentLibrary, environmentOverrideId);
      syncLandscapeGrid(region.landscape);

      const currentObjects = resolveSceneObjects(region, {
        contentLibrary,
        playerDefinition,
        itemDefinitions,
        npcDefinitions
      });
      console.warn("[studio-viewport:resolved-objects]", {
        count: currentObjects.length,
        objects: currentObjects.map((object) => ({
          instanceId: object.instanceId,
          kind: object.kind,
          assetKind: object.assetKind ?? null,
          surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
          deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null
        }))
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
        scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
      }

      for (const object of delta.updated) {
        const existing = objectMap.get(object.instanceId);
        const nextAssetSourceUrl = object.modelSourcePath
          ? assetSources[object.modelSourcePath] ?? null
          : null;
        if (
          existing &&
          existing.assetSourceUrl === nextAssetSourceUrl &&
          existing.representationKey === object.representationKey
        ) {
          applyObjectTransform(existing.root, object);
          ensureRenderableShadersApplied(existing, object, host.shaderRuntime);
          continue;
        }
        if (existing) {
          authoredRoot.remove(existing.root);
          disposeObject(existing.root);
          objectMap.delete(object.instanceId);
        }

        scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
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

          scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
          continue;
        }
        if (!entry) {
          scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
          continue;
        }
        applyObjectTransform(entry.root, object);
        ensureRenderableShadersApplied(entry, object, host.shaderRuntime);
      }

      previousObjects = currentObjects;
    },

    previewLandscape(landscape) {
      if (!currentState) return;
      host.landscapeController.applyLandscape(landscape);
      syncLandscapeGrid(landscape);
    },

    paintLandscapeAt(options) {
      return host.landscapeController.paintStroke({
        channelIndex: options.channelIndex,
        worldX: options.worldX,
        worldZ: options.worldZ,
        radius: options.radius,
        strength: options.strength,
        falloff: options.falloff
      });
    },

    renderLandscapeMask(channelIndex, canvas) {
      host.landscapeController.renderMaskToCanvas(channelIndex, canvas);
    },

    serializeLandscapePaintPayload() {
      return host.landscapeController.serializePaintPayload();
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
      host.resize(width, height);
      syncCameraProjection(width, height);
    },

    render() {
      host.render();
    },

    subscribeFrame(listener) {
      return host.subscribeFrame(listener);
    }
  };
}
