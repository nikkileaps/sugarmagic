import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createCapsuleFallback,
  registerLivePaintedMask,
  createFallbackMesh,
  createRenderView,
  createRenderableReconciler,
  disposeRenderableObject,
  ensureShaderSetsAppliedToRenderables,
  type RenderableReconciler,
  type RenderView,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  DEFAULT_REGION_LANDSCAPE_SIZE,
  EDITOR_NEUTRAL_CLAY_COLOR,
  type AuthoringSession,
  getActiveRegion,
  getMaskTextureDefinition,
  resolveHiddenAssetInstanceIds,
  resolveRegionVolumes,
  type MaskTextureDefinition,
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
  assetObjectIsInstanceable,
  loadNavMeshDebugGeometry,
  type SceneObject
} from "@sugarmagic/runtime-core";
import {
  SCENE_OBJECT_MARKER_KEY,
  buildSceneObjectMarker,
  type WorkspaceViewport
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

interface LandscapeGridSpec {
  size: number;
  divisions: number;
}

interface AuthoringViewportOptions {
  engine: WebRenderEngine;
  stores: ProjectionStores;
  readMaskTexture: (maskTextureId: string) => Promise<ImageData | null>;
  writeMaskTexture: (maskTextureId: string, imageData: ImageData) => Promise<void>;
  createMaskTextureDefinition: () => Promise<MaskTextureDefinition | null>;
  ensureAssetPaintUvs: (assetDefinitionId: string) => Promise<void>;
  /** Fires when in-flight renderable loads drain to zero -- used to
   *  dismiss the "updating scene" toast after a reload (e.g. remount
   *  when the Surface Studio closes). */
  onRenderablesSettled?: () => void;
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

  // Plan 069.6 — collider + volume-blocker wireframes, toggled by
  // `showColliders`. World space (colliders resolve to world AABBs), so it
  // sits directly under the scene, rebuilt whenever the projection changes.
  const colliderWireframeRoot = new THREE.Group();
  colliderWireframeRoot.name = "collider-wireframes";
  scene.add(colliderWireframeRoot);
  const COLLIDER_WIRE_COLOR = 0x89b4fa; // asset collider (blue)
  const BLOCKER_WIRE_COLOR = 0xf38ba8; // volume blocker (red)
  const CONTAINMENT_WIRE_COLOR = 0xf9a825; // containment boundary (amber)
  const _wireBox = new THREE.Box3();
  const _wireMin = new THREE.Vector3();
  const _wireMax = new THREE.Vector3();
  const _wireMat = new THREE.Matrix4();
  const _wirePos = new THREE.Vector3();
  const _wireQuat = new THREE.Quaternion();
  const _wireEuler = new THREE.Euler();
  const _wireScale = new THREE.Vector3();

  // Plan 069.8 — the baked navmesh walkable surface, toggled by
  // `showNavMesh`. Loaded async from the artifact blob (asset-source store)
  // and cached by the bake's input hash so it only reloads on a fresh bake.
  const navMeshVizRoot = new THREE.Group();
  navMeshVizRoot.name = "navmesh-viz";
  scene.add(navMeshVizRoot);
  const NAVMESH_VIZ_COLOR = 0x89dceb;
  let navMeshVizHash: string | null = null;
  let navMeshVizToken = 0;

  /** Dispose the drawn mesh only — does NOT touch the hash cache. */
  function disposeNavMeshVizChildren() {
    for (let i = navMeshVizRoot.children.length - 1; i >= 0; i -= 1) {
      const child = navMeshVizRoot.children[i]!;
      navMeshVizRoot.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  /** Full reset: drop the mesh AND the cache key, and supersede any
   *  in-flight load (else a toggled-off load would still draw late). */
  function clearNavMeshViz() {
    navMeshVizHash = null;
    navMeshVizToken += 1;
    disposeNavMeshVizChildren();
  }

  function buildNavMeshVizMesh(positions: number[], indices: number[]) {
    // Children only — clearing the hash here would defeat the cache and
    // refetch + WASM-reimport on every projection tick (mini-review r3 #1).
    disposeNavMeshVizChildren();
    if (positions.length === 0 || indices.length === 0) {
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setIndex(indices);
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: NAVMESH_VIZ_COLOR,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false
      })
    );
    // Hover just above the ground plane to avoid z-fighting the grid.
    fill.position.y = 0.05;
    navMeshVizRoot.add(fill);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: NAVMESH_VIZ_COLOR,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        toneMapped: false
      })
    );
    wire.position.y = 0.05;
    navMeshVizRoot.add(wire);
  }

  async function syncNavMeshViz(projection: ViewportProjection) {
    const artifact = projection.region?.navMesh ?? null;
    const url = artifact
      ? projection.assetSources[artifact.assetPath]
      : undefined;
    if (!projection.showNavMesh || !artifact || !url) {
      clearNavMeshViz();
      return;
    }
    if (navMeshVizHash === artifact.inputHash) {
      return; // already showing this bake
    }
    navMeshVizHash = artifact.inputHash;
    const token = navMeshVizToken + 1;
    navMeshVizToken = token;
    try {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const geometry = await loadNavMeshDebugGeometry(bytes);
      if (token !== navMeshVizToken) {
        return; // a newer request superseded this one
      }
      buildNavMeshVizMesh(geometry.positions, geometry.indices);
    } catch (error) {
      console.warn("[navmesh-viz] load failed", error);
      if (token === navMeshVizToken) {
        clearNavMeshViz();
      }
    }
  }

  function clearColliderWireframes() {
    for (let i = colliderWireframeRoot.children.length - 1; i >= 0; i -= 1) {
      const child = colliderWireframeRoot.children[i]!;
      colliderWireframeRoot.remove(child);
      if (child instanceof THREE.Box3Helper) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  function addWireBox(box: THREE.Box3, color: number) {
    colliderWireframeRoot.add(new THREE.Box3Helper(box.clone(), color));
  }

  function syncColliderWireframes(
    objects: readonly SceneObject[],
    region: RegionDocument,
    show: boolean
  ) {
    clearColliderWireframes();
    if (!show) {
      return;
    }
    // Asset colliders (definition/instance/scene-resolved, matches the
    // collision world's single source of truth).
    for (const object of objects) {
      const collider = object.collider;
      if (!collider || collider.shape === "none" || !collider.localBounds) {
        continue;
      }
      _wirePos.set(
        object.transform.position[0],
        object.transform.position[1],
        object.transform.position[2]
      );
      _wireEuler.set(
        object.transform.rotation[0],
        object.transform.rotation[1],
        object.transform.rotation[2]
      );
      _wireQuat.setFromEuler(_wireEuler);
      _wireScale.set(
        object.transform.scale[0],
        object.transform.scale[1],
        object.transform.scale[2]
      );
      _wireMat.compose(_wirePos, _wireQuat, _wireScale);
      _wireMin.set(
        collider.localBounds.min[0],
        collider.localBounds.min[1],
        collider.localBounds.min[2]
      );
      _wireMax.set(
        collider.localBounds.max[0],
        collider.localBounds.max[1],
        collider.localBounds.max[2]
      );
      _wireBox.set(_wireMin, _wireMax).applyMatrix4(_wireMat);
      addWireBox(_wireBox, COLLIDER_WIRE_COLOR);
    }
    // Volume blockers / containment boundaries (already world-space boxes).
    for (const volume of resolveRegionVolumes(region)) {
      if (!volume.enabled) {
        continue;
      }
      const isBlocker = volume.roles.includes("blocker");
      const isContainment = volume.roles.includes("containment-boundary");
      if (!isBlocker && !isContainment) {
        continue;
      }
      const [cx, cy, cz] = volume.bounds.center;
      const [sx, sy, sz] = volume.bounds.size;
      _wireBox.min.set(cx - sx / 2, cy - sy / 2, cz - sz / 2);
      _wireBox.max.set(cx + sx / 2, cy + sy / 2, cz + sz / 2);
      addWireBox(
        _wireBox,
        isContainment ? CONTAINMENT_WIRE_COLOR : BLOCKER_WIRE_COLOR
      );
    }
  }

  const overlayRoot = asOverlayViewportRoot(new THREE.Group());
  overlayRoot.name = "authoring-overlay-root";
  scene.add(overlayRoot);

  let currentAssetSources: Record<string, string> = {};
  // Plan 070.2/070.6 — the shared reconciler owns the authored renderables.
  // Grouping is now ON in the studio too (070.6): brushed placements batch
  // into InstancedMeshes (fast meadows in the editor), and picking + the
  // gizmo resolve individual members via the instanceOrder marker +
  // per-instance matrix-patch.
  const renderableReconciler: RenderableReconciler = createRenderableReconciler({
    parent: authoredRoot,
    resolveUrl: (object) =>
      object.modelSourcePath
        ? renderView.assetResolver.resolveAssetUrl(object.modelSourcePath) ??
          null
        : null,
    loadModel: (url) => gltfLoader.loadAsync(url).then((gltf) => gltf.scene),
    createFallback: (object) =>
      object.kind === "asset"
        ? createFallbackMesh({ color: EDITOR_NEUTRAL_CLAY_COLOR })
        : createCapsuleFallback(object, {
            fallbackColor: EDITOR_NEUTRAL_CLAY_COLOR
          }),
    createErrorFallback: (object, error) => {
      reportRenderableError(object, "load", error);
      return createErrorFallbackMesh();
    },
    shaderRuntime: renderView.shaderRuntime,
    getFileSources: () => currentAssetSources,
    enableShadows: (renderableRoot) =>
      renderView.enableShadowsOnObject(renderableRoot),
    grouping: true,
    isInstanceable: assetObjectIsInstanceable,
    onSettled: () => options.onRenderablesSettled?.(),
    // Every authored renderable root carries the scene-object marker so the
    // single hit-test enforcer + surface painting can resolve it (was set by
    // the old createRenderableRoot; the reconciler doesn't know this key, so
    // the studio stamps it here). Instanced group roots (070.6, once grouping
    // flips ON) carry the instanceOrder so a raycast index resolves to the
    // member PlacedAssetInstance.
    onEntryLoaded: (entry) => {
      entry.root.userData[SCENE_OBJECT_MARKER_KEY] = buildSceneObjectMarker(entry);
    },
    logger: {
      warn: (message, payload) =>
        console.warn("[authoring-viewport]", message, payload)
    }
  });
  let unsubscribeProjection: (() => void) | null = null;
  let unsubscribeShaderEnsureFrame: (() => void) | null = null;
  let unsubscribeTexturesUpdated: (() => void) | null = null;
  let overlayTeardowns: Array<() => void> = [];

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
    void syncNavMeshViz(projection);

    if (!projection.region || !projection.contentLibrary) {
      clearColliderWireframes();
      renderableReconciler.reconcile([]);
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
      npcDefinitions,
      // Compose the ambient Scene's overlay exactly like the game does --
      // Scene-scoped placements must render in the viewport too.
      activeScene: projection.activeScene
    });
    const currentObjects = resolvedObjects.map((object) =>
      applyTransformOverride(
        object,
        projection.transformOverrides[object.instanceId]
      )
    );
    syncColliderWireframes(currentObjects, region, projection.showColliders);
    // Plan 070.2 — the reconciler diffs against its live set and applies
    // add / update-in-place / remove (grouping OFF, so every object is a
    // singleton exactly as before).
    renderableReconciler.reconcile(currentObjects);
    applyFolderVisibility(region, projection.hiddenFolderIds);
  }

  // Plan 070.3 — apply the Scene Explorer's per-folder eye. Ephemeral display
  // state, never persisted: hide the renderables of assets under a hidden folder
  // via `.visible` / per-instance collapse (snappy — no reload/rebuild, unlike
  // filtering the reconcile input, which re-runs loadModel on every toggle).
  //
  // Singletons flip `.visible`. Instanced GROUPS must hide PER MEMBER, not at the
  // root: a studio batch merges every same-asset+surface instance across the
  // WHOLE scene into one InstancedMesh regardless of folder, so a group routinely
  // spans hidden and visible folders. `setInstanceVisible` collapses just the
  // hidden members in place; the calls are idempotent, so calling for every
  // member each projection is cheap (only real transitions rewrite a matrix).
  function applyFolderVisibility(
    region: RegionDocument,
    hiddenFolderIds: readonly string[]
  ) {
    const hidden = resolveHiddenAssetInstanceIds(region, hiddenFolderIds);
    for (const entry of renderableReconciler.entries()) {
      if (entry.instanced && entry.instanceOrder && entry.setInstanceVisible) {
        for (let i = 0; i < entry.instanceOrder.length; i += 1) {
          entry.setInstanceVisible(i, !hidden.has(entry.instanceOrder[i]!));
        }
      } else {
        entry.root.visible = !hidden.has(entry.object.instanceId);
      }
    }
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
          renderableReconciler.entries(),
          renderView.shaderRuntime,
          currentAssetSources
        );
      });
      // Painted-mask grass on assets is placed at build time from the
      // mask PIXELS; on fresh load the PNG decodes async, so the first
      // build sees an empty mask. When a texture finishes loading,
      // invalidate scatter-bearing renderables so the ensure loop
      // above rebuilds their grass with the now-ready mask (Plan
      // 068.11). Per-frame debounced: the ensure pass runs once next
      // frame regardless of how many textures resolved.
      unsubscribeTexturesUpdated = renderView.subscribeTexturesUpdated(() => {
        for (const entry of renderableReconciler.entries()) {
          const hasScatter = (entry.object.effectiveMaterialSlots ?? []).some(
            (slot) =>
              slot.surface?.layers?.some((layer) => layer.kind === "scatter")
          );
          if (!hasScatter) {
            continue;
          }
          entry.shaderApplication.appliedShaderSignature = null;
          entry.shaderApplication.appliedFileSources = null;
        }
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
          setActiveMaskPaintTarget(target) {
            options.stores.viewportStore.getState().setActiveMaskPaintTarget(target);
          },
          clearMaskPaintFillRequest() {
            options.stores.viewportStore.getState().clearMaskPaintFillRequest();
          },
          invalidateRenderableShaders(filter) {
            for (const entry of renderableReconciler.entries()) {
              const matches =
                (filter.instanceId &&
                  entry.object.instanceId === filter.instanceId) ||
                (filter.assetDefinitionId &&
                  entry.object.assetDefinitionId === filter.assetDefinitionId);
              if (!matches) {
                continue;
              }
              entry.shaderApplication.appliedShaderSignature = null;
              entry.shaderApplication.appliedFileSources = null;
            }
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
        readMaskTexture(maskTextureId: string) {
          return options.readMaskTexture(maskTextureId);
        },
        writeMaskTexture(maskTextureId: string, imageData: ImageData) {
          return options.writeMaskTexture(maskTextureId, imageData);
        },
        createMaskTextureDefinition() {
          return options.createMaskTextureDefinition();
        },
        ensureAssetPaintUvs(assetDefinitionId: string) {
          return options.ensureAssetPaintUvs(assetDefinitionId);
        },
        previewMaskTexture(maskTextureId: string, canvas: HTMLCanvasElement) {
          // Live pixels for CPU scatter placement (painted-mask-live).
          registerLivePaintedMask(maskTextureId, canvas);
          const session = options.stores.projectStore.getState().session;
          if (!session) {
            return;
          }
          const definition = getMaskTextureDefinition(session.contentLibrary, maskTextureId);
          if (!definition) {
            return;
          }
          const texture = renderView.assetResolver.resolveMaskTextureDefinition(definition);
          texture.dispose();
          texture.image = canvas;
          texture.needsUpdate = true;
          renderView.markSceneMaterialsDirty();
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
      renderableReconciler.dispose();
      for (const teardown of overlayTeardowns) {
        teardown();
      }
      overlayTeardowns = [];
      unsubscribeShaderEnsureFrame?.();
      unsubscribeShaderEnsureFrame = null;
      unsubscribeTexturesUpdated?.();
      unsubscribeTexturesUpdated = null;
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

    reloadAssetRenderables(assetDefinitionId) {
      // Dropping the entries is enough: the next applyProjection pass
      // (any store tick -- the caller's assetSources refresh provides
      // one) finds no entry, re-schedules with the fresh source. Same
      // convergence path as first load.
      for (const entry of [...renderableReconciler.entries()]) {
        if (entry.object.assetDefinitionId === assetDefinitionId) {
          renderableReconciler.remove(entry.object.instanceId);
        }
      }
    },

    assetHasPaintUvs(assetDefinitionId) {
      // True only if a loaded renderable for this asset exists and every
      // one of its meshes carries uv1. Any mesh without it -> needs a
      // bake -> return false.
      for (const entry of renderableReconciler.entries()) {
        if (entry.object.assetDefinitionId !== assetDefinitionId) {
          continue;
        }
        let allMeshesHaveUv1 = true;
        entry.root.traverse((child) => {
          if (
            child instanceof THREE.Mesh &&
            !child.geometry.getAttribute("uv1")
          ) {
            allMeshesHaveUv1 = false;
          }
        });
        if (allMeshesHaveUv1) {
          return true;
        }
      }
      // Loaded but missing uv1, or not loaded at all -> false. The ensure
      // op then attempts a bake, which no-ops per mesh already unwrapped.
      return false;
    },

    subscribeFrame(listener) {
      return renderView.subscribeFrame(listener);
    }
  };
}
