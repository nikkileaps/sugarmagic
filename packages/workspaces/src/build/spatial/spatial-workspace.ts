import * as THREE from "three";
import type { RegionAreaBounds } from "@sugarmagic/domain";
import {
  createHitTestService,
  createInputRouter,
  type HitTestService,
  type InputRouter,
  type InteractionController,
  type NormalizedPointerEvent
} from "../../interaction";

/** Plan 069.7 — the workspace draws any bounded thing (unified Volumes),
 *  not just areas: it only needs an id (for selection/hit-test) + bounds.
 *  Plan 069.8 QoL — an optional authoring tint (hex) to tell volumes apart. */
export interface SpatialRect {
  id: string;
  bounds: RegionAreaBounds;
  color?: string | null;
}

const DEFAULT_RECT_COLOR = 0x74c7ec;
const SELECTED_RECT_COLOR = 0x89b4fa;

function resolveRectColor(rect: SpatialRect): number {
  if (rect.color && /^#[0-9a-fA-F]{6}$/.test(rect.color)) {
    return parseInt(rect.color.slice(1), 16);
  }
  return DEFAULT_RECT_COLOR;
}

export interface SpatialWorkspaceConfig {
  getRects: () => SpatialRect[];
  getSelectedId: () => string | null;
  onCreateRectangle: (bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) => void;
}

export interface SpatialWorkspaceInstance {
  attach: (
    viewportElement: HTMLElement,
    camera: THREE.Camera,
    authoredRoot: THREE.Object3D,
    overlayRoot: THREE.Object3D,
    surfaceRoot: THREE.Object3D
  ) => void;
  detach: () => void;
  setDrawingEnabled: (enabled: boolean) => void;
  syncAreas: () => void;
  hitTestService: HitTestService;
  inputRouter: InputRouter;
}

const SNAP_SIZE = 1;
const AREA_FILL_Y = 0.04;
const AREA_OUTLINE_Y = 0.06;
const PREVIEW_Y = 0.08;

function snapCoordinate(value: number): number {
  return Math.round(value / SNAP_SIZE) * SNAP_SIZE;
}

function normalizeRectangle(a: { x: number; z: number }, b: { x: number; z: number }) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z);
  const maxZ = Math.max(a.z, b.z);
  return { minX, minZ, maxX, maxZ };
}

function createAreaFill(width: number, depth: number, color: number, opacity: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(Math.max(width, 0.001), Math.max(depth, 0.001));
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function createAreaOutline(width: number, depth: number, color: number): THREE.Line {
  const hx = width / 2;
  const hz = depth / 2;
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hx, 0, -hz),
    new THREE.Vector3(hx, 0, -hz),
    new THREE.Vector3(hx, 0, hz),
    new THREE.Vector3(-hx, 0, hz),
    new THREE.Vector3(-hx, 0, -hz)
  ]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  });
  return new THREE.Line(geometry, material);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
      return;
    }

    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function buildAreaVisual(rect: SpatialRect, isSelected: boolean): THREE.Group {
  const width = rect.bounds.size[0];
  const depth = rect.bounds.size[2];
  // Plan 069.8 QoL — the fill keeps the volume's authoring tint (or the
  // default blue); selection reads via a heavier fill + the accent-blue
  // outline, so it stays visible on top of any custom color.
  const baseColor = resolveRectColor(rect);
  const outlineColor = isSelected ? SELECTED_RECT_COLOR : baseColor;
  const fillOpacity = isSelected ? 0.28 : 0.14;
  const root = new THREE.Group();
  root.name = rect.id;
  root.position.set(rect.bounds.center[0], 0, rect.bounds.center[2]);

  const fill = createAreaFill(width, depth, baseColor, fillOpacity);
  fill.position.y = AREA_FILL_Y;
  root.add(fill);

  const outline = createAreaOutline(width, depth, outlineColor);
  outline.position.y = AREA_OUTLINE_Y;
  root.add(outline);

  return root;
}

function applyPreviewRectangle(
  previewRoot: THREE.Group,
  start: { x: number; z: number } | null,
  current: { x: number; z: number } | null
) {
  while (previewRoot.children.length > 0) {
    const child = previewRoot.children[0]!;
    previewRoot.remove(child);
    disposeObject(child);
  }

  if (!start || !current) {
    return;
  }

  const rect = normalizeRectangle(start, current);
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  if (width < SNAP_SIZE * 0.5 || depth < SNAP_SIZE * 0.5) {
    return;
  }

  const root = new THREE.Group();
  root.position.set((rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2);
  const fill = createAreaFill(width, depth, 0xf9e2af, 0.2);
  fill.position.y = PREVIEW_Y;
  root.add(fill);
  const outline = createAreaOutline(width, depth, 0xf9e2af);
  outline.position.y = PREVIEW_Y + 0.02;
  root.add(outline);
  previewRoot.add(root);
}

export function createSpatialWorkspace(config: SpatialWorkspaceConfig): SpatialWorkspaceInstance {
  const inputRouter = createInputRouter();
  const hitTestService = createHitTestService();
  const areasRoot = new THREE.Group();
  const previewRoot = new THREE.Group();
  areasRoot.name = "spatial-areas-root";
  previewRoot.name = "spatial-preview-root";

  let attachedOverlayRoot: THREE.Object3D | null = null;
  let drawingEnabled = false;
  let dragStart: { x: number; z: number } | null = null;
  let dragCurrent: { x: number; z: number } | null = null;

  function syncAreas() {
    while (areasRoot.children.length > 0) {
      const child = areasRoot.children[0]!;
      areasRoot.remove(child);
      disposeObject(child);
    }

    const selectedId = config.getSelectedId();
    for (const rect of config.getRects()) {
      areasRoot.add(buildAreaVisual(rect, rect.id === selectedId));
    }
  }

  const drawController: InteractionController = {
    id: "spatial-draw-controller",
    onPointerDown(event: NormalizedPointerEvent) {
      if (!drawingEnabled || event.button !== 0) {
        return false;
      }

      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return false;
      }

      dragStart = {
        x: snapCoordinate(hit.point.x),
        z: snapCoordinate(hit.point.z)
      };
      dragCurrent = dragStart;
      applyPreviewRectangle(previewRoot, dragStart, dragCurrent);
      return true;
    },
    onPointerMove(event: NormalizedPointerEvent) {
      if (!drawingEnabled || !dragStart) {
        return;
      }

      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return;
      }

      dragCurrent = {
        x: snapCoordinate(hit.point.x),
        z: snapCoordinate(hit.point.z)
      };
      applyPreviewRectangle(previewRoot, dragStart, dragCurrent);
    },
    onPointerUp() {
      if (!drawingEnabled || !dragStart || !dragCurrent) {
        dragStart = null;
        dragCurrent = null;
        applyPreviewRectangle(previewRoot, null, null);
        return;
      }

      const rect = normalizeRectangle(dragStart, dragCurrent);
      dragStart = null;
      dragCurrent = null;
      applyPreviewRectangle(previewRoot, null, null);

      if (rect.maxX - rect.minX < SNAP_SIZE || rect.maxZ - rect.minZ < SNAP_SIZE) {
        return;
      }

      config.onCreateRectangle(rect);
    },
    onCancel() {
      dragStart = null;
      dragCurrent = null;
      applyPreviewRectangle(previewRoot, null, null);
    }
  };

  return {
    hitTestService,
    inputRouter,
    attach(viewportElement, camera, authoredRoot, overlayRoot, surfaceRoot) {
      hitTestService.setCamera(camera);
      hitTestService.setAuthoredRoot(authoredRoot);
      hitTestService.setOverlayRoot(overlayRoot);
      hitTestService.setSurfaceRoot(surfaceRoot);
      attachedOverlayRoot = overlayRoot;
      overlayRoot.add(areasRoot);
      overlayRoot.add(previewRoot);
      inputRouter.pushController(drawController);
      inputRouter.attach(viewportElement);
      syncAreas();
    },
    detach() {
      inputRouter.detach();
      inputRouter.popController(drawController.id);
      if (attachedOverlayRoot) {
        attachedOverlayRoot.remove(areasRoot);
        attachedOverlayRoot.remove(previewRoot);
      }
      syncAreas();
      applyPreviewRectangle(previewRoot, null, null);
      attachedOverlayRoot = null;
      drawingEnabled = false;
      dragStart = null;
      dragCurrent = null;
    },
    setDrawingEnabled(enabled) {
      drawingEnabled = enabled;
      if (!enabled) {
        dragStart = null;
        dragCurrent = null;
        applyPreviewRectangle(previewRoot, null, null);
      }
    },
    syncAreas
  };
}
