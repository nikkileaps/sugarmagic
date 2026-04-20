import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createCapsuleFallback,
  createFallbackMesh,
  createRenderableShaderApplicationState,
  createWebRenderHost,
  disposeRenderableObject,
  ensureShaderSetAppliedToRenderable,
  normalizeModelScale,
  type RenderableShaderApplicationState,
  type ShaderRuntime,
  type WebRenderHost
} from "@sugarmagic/render-web";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
  EDITOR_NEUTRAL_CLAY_COLOR,
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

const GRID_COLOR = 0x45475a;

const gltfLoader = new GLTFLoader();

interface SceneObjectEntry {
  root: THREE.Group;
  object: SceneObject;
  representationKey: string;
  loadedWithAsset: boolean;
  shaderApplication: RenderableShaderApplicationState;
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

/**
 * Visibly distinct "something went wrong" mesh — bright magenta with rough
 * emissive glow so authors can tell an error fallback apart from an
 * asset-not-yet-loaded placeholder cube. Pair with a console error + alert
 * explaining why it's here.
 */
function createErrorFallbackMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xff00ff,
      emissive: 0xff00ff,
      emissiveIntensity: 0.6,
      roughness: 1,
      metalness: 0
    })
  );
}

// Dedupe key → last-seen error message. Prevents an alert-storm when the
// per-frame shader-ensure loop re-fires a broken shader every frame.
const alertedRenderableErrors = new Map<string, string>();

function reportRenderableError(
  object: SceneObject,
  phase: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const payload = {
    instanceId: object.instanceId,
    kind: object.kind,
    displayName: object.displayName,
    modelSourcePath: object.modelSourcePath ?? null,
    representationKey: object.representationKey,
    surfaceShader: object.effectiveShaders.surface?.shaderDefinitionId ?? null,
    deformShader: object.effectiveShaders.deform?.shaderDefinitionId ?? null,
    phase,
    error,
    ...extra
  };
  console.error(`[authoring-viewport:renderable:${phase}] ${message}`, payload);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }

  const dedupeKey = `${object.instanceId}|${phase}`;
  if (alertedRenderableErrors.get(dedupeKey) === message) {
    return;
  }
  alertedRenderableErrors.set(dedupeKey, message);
  window.alert(
    `Renderable failed (${phase}) for "${object.displayName}" (${object.instanceId}).\n\n${message}\n\nSee console for full details.`
  );
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

function assetSourceAvailable(
  object: SceneObject,
  assetSources: Record<string, string>
): boolean {
  if (!object.modelSourcePath) return false;
  return Boolean(assetSources[object.modelSourcePath]);
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
    root.add(
      object.kind === "asset"
        ? createFallbackMesh({ color: EDITOR_NEUTRAL_CLAY_COLOR })
        : createCapsuleFallback(object, {
            fallbackColor: EDITOR_NEUTRAL_CLAY_COLOR
          })
    );
    return {
      root,
      object,
      representationKey: object.representationKey,
      loadedWithAsset: false,
      shaderApplication: createRenderableShaderApplicationState()
    };
  }

  let gltf: Awaited<ReturnType<typeof gltfLoader.loadAsync>>;
  try {
    gltf = await gltfLoader.loadAsync(assetSourceUrl);
  } catch (error) {
    reportRenderableError(object, "gltf-load", error, { assetSourceUrl });
    root.add(createErrorFallbackMesh());
    return {
      root,
      object,
      representationKey: object.representationKey,
      loadedWithAsset: false,
      shaderApplication: createRenderableShaderApplicationState()
    };
  }

  const renderable = gltf.scene.clone(true);
  if (object.targetModelHeight) {
    normalizeModelScale(renderable, object.targetModelHeight);
  }
  host.enableShadowsOnObject(renderable);
  const shaderApplication = createRenderableShaderApplicationState();
  try {
    ensureShaderSetAppliedToRenderable(
      renderable,
      object,
      shaderRuntime,
      shaderApplication,
      assetSources
    );
  } catch (error) {
    reportRenderableError(object, "shader-apply", error);
    root.add(createErrorFallbackMesh());
    return {
      root,
      object,
      representationKey: object.representationKey,
      loadedWithAsset: false,
      shaderApplication: createRenderableShaderApplicationState()
    };
  }
  root.add(renderable);
  return {
    root,
    object,
    representationKey: object.representationKey,
    loadedWithAsset: true,
    shaderApplication
  };
}

function ensureRenderableShadersApplied(
  entry: SceneObjectEntry,
  object: SceneObject,
  shaderRuntime: ShaderRuntime | null,
  assetSources: Record<string, string>
) {
  try {
    ensureShaderSetAppliedToRenderable(
      entry.root,
      object,
      shaderRuntime,
      entry.shaderApplication,
      assetSources
    );
  } catch (error) {
    reportRenderableError(object, "shader-ensure", error);
  }
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
  let currentAssetSources: Record<string, string> = {};
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
          disposeRenderableObject(entry.root);
          return;
        }
        const existing = objectMap.get(object.instanceId);
        if (existing) {
          authoredRoot.remove(existing.root);
          disposeRenderableObject(existing.root);
        }
        authoredRoot.add(entry.root);
        ensureRenderableShadersApplied(
          entry,
          object,
          host.shaderRuntime,
          assetSources
        );
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
      // Match runtime host behavior: re-ensure every scene object's shader
      // application each frame. Diagnostic — isolating whether the bug is
      // "authoring lacks this step" or something else.
      host.subscribeFrame(() => {
        for (const entry of objectMap.values()) {
          ensureShaderSetAppliedToRenderable(
            entry.root,
            entry.object,
            host.shaderRuntime,
            entry.shaderApplication,
            currentAssetSources
          );
        }
      });
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      syncCameraProjection(width, height);
    },

    unmount() {
      renderGeneration += 1;

      for (const entry of objectMap.values()) {
        authoredRoot.remove(entry.root);
        disposeRenderableObject(entry.root);
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
      currentAssetSources = assetSources;
      // Host handles environment + post-process apply, and keeps the shader
      // runtime's content library in sync without dispose/recreate.
      host.applyEnvironment(region, contentLibrary, environmentOverrideId, assetSources);
      syncLandscapeGrid(region.landscape);

      const currentObjects = resolveSceneObjects(region, {
        contentLibrary,
        playerDefinition,
        itemDefinitions,
        npcDefinitions
      });
      const delta = computeSceneDelta(previousObjects, currentObjects);
      const generation = ++renderGeneration;

      for (const id of delta.removed) {
        const entry = objectMap.get(id);
        if (!entry) continue;
        authoredRoot.remove(entry.root);
        disposeRenderableObject(entry.root);
        objectMap.delete(id);
      }

      for (const object of delta.added) {
        scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
      }

      for (const object of delta.updated) {
        const existing = objectMap.get(object.instanceId);
        const assetAvailable = assetSourceAvailable(object, assetSources);
        if (
          existing &&
          existing.representationKey === object.representationKey &&
          existing.loadedWithAsset === assetAvailable
        ) {
          existing.object = object;
          applyObjectTransform(existing.root, object);
          ensureRenderableShadersApplied(
            existing,
            object,
            host.shaderRuntime,
            assetSources
          );
          continue;
        }
        if (existing) {
          authoredRoot.remove(existing.root);
          disposeRenderableObject(existing.root);
          objectMap.delete(object.instanceId);
        }

        scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
      }

      for (const object of currentObjects) {
        const entry = objectMap.get(object.instanceId);
        const assetAvailable = assetSourceAvailable(object, assetSources);
        if (entry && entry.loadedWithAsset !== assetAvailable) {
          authoredRoot.remove(entry.root);
          disposeRenderableObject(entry.root);
          objectMap.delete(object.instanceId);

          scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
          continue;
        }
        if (!entry) {
          scheduleRenderableLoad(object, assetSources, host.shaderRuntime, generation);
          continue;
        }
        entry.object = object;
        applyObjectTransform(entry.root, object);
        ensureRenderableShadersApplied(
          entry,
          object,
          host.shaderRuntime,
          assetSources
        );
      }

      previousObjects = currentObjects;
    },

    previewLandscape(landscape) {
      if (!currentState) return;
      // Pass the current content library and asset sources — without
      // them the landscape controller can't resolve material-bound
      // channels and falls back to flat-color rendering, which would
      // clobber any real material that had just been applied via a
      // full state update.
      host.landscapeController.applyLandscape(
        landscape,
        currentState.contentLibrary,
        currentState.assetSources
      );
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
