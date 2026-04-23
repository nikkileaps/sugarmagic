import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createCapsuleFallback,
  createFallbackMesh,
  createRenderView,
  createRenderableShaderApplicationState,
  disposeRenderableObject,
  ensureShaderSetAppliedToRenderable,
  ensureShaderSetsAppliedToRenderables,
  normalizeModelScale,
  type RenderableShaderApplicationState,
  type RenderView,
  type ShaderRuntime,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
  EDITOR_NEUTRAL_CLAY_COLOR,
  type AuthoringSession,
  getActiveRegion,
  type RegionDocument,
  type RegionLandscapeState
} from "@sugarmagic/domain";
import {
  selectViewportProjection,
  shallowEqual,
  subscribeToProjection,
  type TransformDraft,
  type ProjectionStores,
  type ViewportProjection,
  type LandscapePaintStroke
} from "@sugarmagic/shell";
import {
  resolveSceneObjects,
  computeSceneDelta,
  type SceneObject
} from "@sugarmagic/runtime-core";
import type {
  WorkspaceViewport
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "./overlay-context";
import {
  asAuthoredViewportRoot,
  asOverlayViewportRoot,
  asSurfaceViewportRoot,
  type ViewportOverlayContext
} from "./overlay-context";

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

interface AuthoringViewportOptions {
  engine: WebRenderEngine;
  stores: ProjectionStores;
  overlays?: ViewportOverlayFactory[];
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

function applyTransformOverride(
  object: SceneObject,
  transformOverride: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  } | undefined
): SceneObject {
  if (!transformOverride) {
    return object;
  }

  return {
    ...object,
    transform: {
      position: [...transformOverride.position] as [number, number, number],
      rotation: [...transformOverride.rotation] as [number, number, number],
      scale: [...transformOverride.scale] as [number, number, number]
    }
  };
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
  renderView: RenderView
): Promise<SceneObjectEntry> {
  const root = new THREE.Group();
  root.name = object.instanceId;
  applyObjectTransform(root, object);

  const assetSourceUrl = object.modelSourcePath
    ? renderView.assetResolver.resolveAssetUrl(object.modelSourcePath)
    : null;

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
  renderView.enableShadowsOnObject(renderable);
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

export function createAuthoringViewport(
  options: AuthoringViewportOptions
): WorkspaceViewport {
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

  const renderView: RenderView = createRenderView({
    engine: options.engine,
    scene,
    camera: activeCamera,
    compileProfile: "authoring-preview"
  });

  let currentGridSpec = resolveLandscapeGridSpec(null);
  let grid = createLandscapeGrid(currentGridSpec);
  scene.add(grid);

  const authoredRoot = asAuthoredViewportRoot(new THREE.Group());
  authoredRoot.name = "authoring-authored-root";
  scene.add(authoredRoot);

  const overlayRoot = asOverlayViewportRoot(new THREE.Group());
  overlayRoot.name = "authoring-overlay-root";
  scene.add(overlayRoot);

  const objectMap = new Map<string, SceneObjectEntry>();
  const pendingRenderableLoads = new Set<string>();
  let previousObjects: SceneObject[] = [];
  let currentAssetSources: Record<string, string> = {};
  let renderGeneration = 0;
  let unsubscribeProjection: (() => void) | null = null;
  let unsubscribeShaderEnsureFrame: (() => void) | null = null;
  let overlayTeardowns: Array<() => void> = [];

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
    void createRenderableRoot(object, assetSources, activeShaderRuntime, renderView)
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
          renderView.shaderRuntime,
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

  function applyProjection(projection: ViewportProjection) {
    currentAssetSources = projection.assetSources;

    if (!projection.region || !projection.contentLibrary) {
      renderGeneration += 1;
      previousObjects = [];
      for (const entry of objectMap.values()) {
        authoredRoot.remove(entry.root);
        disposeRenderableObject(entry.root);
      }
      objectMap.clear();
      pendingRenderableLoads.clear();
      return;
    }

    const { region, contentLibrary, playerDefinition, itemDefinitions, npcDefinitions } =
      projection;
    const landscape = projection.landscapeOverride ?? region.landscape;
    renderView.landscapeController.applyLandscape(
      landscape,
      contentLibrary,
      projection.assetSources
    );
    syncLandscapeGrid(landscape);

    const resolvedObjects = resolveSceneObjects(region, {
      contentLibrary,
      playerDefinition,
      itemDefinitions,
      npcDefinitions
    });
    const currentObjects = resolvedObjects.map((object) =>
      applyTransformOverride(
        object,
        projection.transformOverrides[object.instanceId]
      )
    );
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
      scheduleRenderableLoad(object, projection.assetSources, renderView.shaderRuntime, generation);
    }

    for (const object of delta.updated) {
      const existing = objectMap.get(object.instanceId);
      const assetAvailable = assetSourceAvailable(object, projection.assetSources);
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
          renderView.shaderRuntime,
          projection.assetSources
        );
        continue;
      }
      if (existing) {
        authoredRoot.remove(existing.root);
        disposeRenderableObject(existing.root);
        objectMap.delete(object.instanceId);
      }
      scheduleRenderableLoad(object, projection.assetSources, renderView.shaderRuntime, generation);
    }

    for (const object of currentObjects) {
      const entry = objectMap.get(object.instanceId);
      const assetAvailable = assetSourceAvailable(object, projection.assetSources);
      if (entry && entry.loadedWithAsset !== assetAvailable) {
        authoredRoot.remove(entry.root);
        disposeRenderableObject(entry.root);
        objectMap.delete(object.instanceId);
        scheduleRenderableLoad(object, projection.assetSources, renderView.shaderRuntime, generation);
        continue;
      }
      if (!entry) {
        scheduleRenderableLoad(object, projection.assetSources, renderView.shaderRuntime, generation);
        continue;
      }
      entry.object = object;
      applyObjectTransform(entry.root, object);
      ensureRenderableShadersApplied(
        entry,
        object,
        renderView.shaderRuntime,
        projection.assetSources
      );
    }

    previousObjects = currentObjects;
  }

  return {
    setProjectionMode(mode) {
      projectionMode = mode;
      activeCamera =
        projectionMode === "orthographic-top"
          ? orthographicCamera
          : perspectiveCamera;
      renderView.setCamera(activeCamera);
    },

    mount(element: HTMLElement) {
      renderView.mount(element);
      // Studio has no gameplay loop of its own — let the host drive rendering
      // so frame listeners fire every tick. Runtime host (which has its own
      // gameplay loop) does NOT opt into this; it calls host.render() from
      // its own loop instead.
      renderView.startRenderLoop();
      // Maintain the same late-load shader-application invariant as runtime:
      // shared render-web logic must eventually re-apply the effective shader
      // set if a renderable subtree or authored file source becomes ready
      // after first mount, without depending on host-specific load order.
      unsubscribeShaderEnsureFrame = renderView.subscribeFrame(() => {
        ensureShaderSetsAppliedToRenderables(
          objectMap.values(),
          renderView.shaderRuntime,
          currentAssetSources
        );
      });
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      syncCameraProjection(width, height);
      const overlayContext: ViewportOverlayContext = {
        overlayRoot,
        authoredRoot,
        surfaceRoot: asSurfaceViewportRoot(renderView.landscapeController.surfaceRoot),
        domElement: element,
        stateAccess: {
          getSession(): AuthoringSession | null {
            return options.stores.projectStore.getState().session;
          },
          getActiveRegion(): RegionDocument | null {
            const session = options.stores.projectStore.getState().session;
            return session ? getActiveRegion(session) : null;
          },
          updateSession(session: AuthoringSession) {
            options.stores.projectStore.getState().updateSession(session);
          },
          getSelectionIds(): string[] {
            return options.stores.shellStore.getState().selection.entityIds;
          },
          setSelection(entityIds: string[]) {
            options.stores.shellStore.getState().setSelection(entityIds);
          },
          setTransformDraft(instanceId: string, transform: TransformDraft) {
            options.stores.viewportStore.getState().setTransformDraft(
              instanceId,
              transform
            );
          },
          getLandscapeDraft(): RegionLandscapeState | null {
            return options.stores.viewportStore.getState().landscapeDraft;
          },
          setLandscapeDraft(landscape: RegionLandscapeState | null) {
            options.stores.viewportStore.getState().setLandscapeDraft(landscape);
          },
          paintLandscape(
            canonicalLandscape: RegionLandscapeState,
            stroke: LandscapePaintStroke
          ): boolean {
            return options.stores.viewportStore
              .getState()
              .paintLandscape(canonicalLandscape, stroke);
          },
          clearLandscapeDraft() {
            options.stores.viewportStore.getState().clearLandscapeDraft();
          },
          setCameraQuaternion(quaternion: [number, number, number, number]) {
            options.stores.viewportStore.getState().setCameraQuaternion(quaternion);
          }
        },
        getCamera() {
          return activeCamera;
        },
        setProjectionMode(mode: "perspective" | "orthographic-top") {
          projectionMode = mode;
          activeCamera =
            projectionMode === "orthographic-top"
              ? orthographicCamera
              : perspectiveCamera;
          renderView.setCamera(activeCamera);
        },
        subscribeToProjection<T>(
          selector: Parameters<typeof subscribeToProjection<T>>[1],
          listener: Parameters<typeof subscribeToProjection<T>>[2],
          opts?: Parameters<typeof subscribeToProjection<T>>[3]
        ) {
          return subscribeToProjection(options.stores, selector, listener, opts);
        },
        subscribeFrame: renderView.subscribeFrame
      };
      overlayTeardowns = (options.overlays ?? []).map((overlay) =>
        overlay(overlayContext)
      );
      unsubscribeProjection = subscribeToProjection(
        options.stores,
        ({ project, shell, viewport, assetSources }) =>
          selectViewportProjection(project, shell, viewport, assetSources),
        applyProjection,
        { equalityFn: shallowEqual }
      );
    },

    unmount() {
      renderGeneration += 1;

      for (const entry of objectMap.values()) {
        authoredRoot.remove(entry.root);
        disposeRenderableObject(entry.root);
      }
      objectMap.clear();
      pendingRenderableLoads.clear();
      for (const teardown of overlayTeardowns) {
        teardown();
      }
      overlayTeardowns = [];
      unsubscribeShaderEnsureFrame?.();
      unsubscribeShaderEnsureFrame = null;
      unsubscribeProjection?.();
      unsubscribeProjection = null;
      renderView.unmount();
    },

    resize(width, height) {
      if (width <= 0 || height <= 0) return;
      renderView.resize(width, height);
      syncCameraProjection(width, height);
    },

    render() {
      renderView.render();
    },

    subscribeFrame(listener) {
      return renderView.subscribeFrame(listener);
    }
  };
}
