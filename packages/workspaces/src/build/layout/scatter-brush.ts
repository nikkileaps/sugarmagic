/**
 * Scatter/prop paint brush (Plan 065.2).
 *
 * Spray placed assets instead of placing them one-by-one: stamps land
 * along the stroke with density control, random palette pick, and
 * scale / yaw jitter; erase mode collects brushed instances under the
 * cursor. All placement math is seeded from stamp position (no
 * Math.random) so a stroke is deterministic. The stroke accumulates
 * locally and commits ONCE on pointer-up through the config callbacks
 * (one undoable command per stroke, per the plan).
 *
 * Owns viewport interaction + preview markers only. Canonical truth
 * (PlacedAssetInstance) and undo live behind the commit callbacks.
 */

import * as THREE from "three";
import type { BrushPlacement } from "@sugarmagic/domain";
import type { ScatterBrushSettings } from "@sugarmagic/shell";
import {
  createHitTestService,
  type InputRouter,
  type InteractionController,
  type NormalizedPointerEvent
} from "../../interaction";

export interface ScatterBrushConfig {
  /** Composed placed assets (base + active overlay) for erase hits. */
  getPlacedAssets(): Array<{
    instanceId: string;
    position: [number, number, number];
  }>;
  getAssetDisplayName(assetDefinitionId: string): string;
  createInstanceId(displayNameStem: string): string;
  commitPlacements(placements: BrushPlacement[]): void;
  commitErase(instanceIds: string[]): void;
}

export interface ScatterBrushAttachOptions {
  viewportElement: HTMLElement;
  /**
   * The LAYOUT WORKSPACE'S router -- the brush controller joins that
   * router's stack (top controller wins), so while the brush is armed
   * it swallows pointer input and select/gizmo interaction resumes
   * the moment it pops. A second router on the same element would
   * double-dispatch every event.
   *
   * Hit testing is NOT shared: the layout workspace's service has no
   * surface root (it only picks objects/gizmos), so the brush owns a
   * hit-test service aimed at the surface root, where the landscape
   * ground plane lives.
   */
  inputRouter: InputRouter;
  camera: THREE.Camera;
  authoredRoot: THREE.Object3D;
  surfaceRoot: THREE.Group;
  overlayRoot: THREE.Group;
}

export interface ScatterBrushTool {
  attach(options: ScatterBrushAttachOptions): void;
  detach(): void;
  setSettings(settings: ScatterBrushSettings): void;
}

/** Hard ceiling per stamp so a huge radius + density can't hitch. */
const MAX_INSTANCES_PER_STAMP = 32;
/** New stamp when the pointer travels this fraction of the radius. */
const STAMP_SPACING_FACTOR = 0.6;

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function stampSeed(x: number, z: number, salt: number): number {
  return x * 73.13 + z * 19.71 + salt * 7.31;
}

function createBrushCursor(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.92, 1, 48);
  const material = new THREE.MeshBasicMaterial({
    color: 0xa6e3a1,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1000;
  mesh.visible = false;
  mesh.name = "scatter-brush-cursor";
  return mesh;
}

/**
 * Stroke preview: one shared cone geometry, one instance marker per
 * landed placement. Real renderable assets appear on commit; the
 * markers just show where the stroke landed while it is live.
 */
function createMarkerPrototype(): {
  geometry: THREE.ConeGeometry;
  material: THREE.MeshBasicMaterial;
} {
  return {
    geometry: new THREE.ConeGeometry(0.12, 0.5, 6),
    material: new THREE.MeshBasicMaterial({
      color: 0xa6e3a1,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false
    })
  };
}

export function createScatterBrushTool(
  config: ScatterBrushConfig
): ScatterBrushTool {
  const hitTestService = createHitTestService();
  let inputRouter: InputRouter | null = null;
  const brushCursor = createBrushCursor();
  const markerProto = createMarkerPrototype();
  const markerGroup = new THREE.Group();
  markerGroup.name = "scatter-brush-stroke-preview";

  let settings: ScatterBrushSettings | null = null;
  let attachedElement: HTMLElement | null = null;
  let attachedOverlayRoot: THREE.Group | null = null;
  let hoverHandler: ((event: PointerEvent) => void) | null = null;
  let pointerLeaveHandler: (() => void) | null = null;

  let strokeActive = false;
  let lastStampPoint: { x: number; z: number } | null = null;
  let strokePlacements: BrushPlacement[] = [];
  let strokeEraseIds = new Set<string>();

  function updateBrushCursor(point: THREE.Vector3 | null) {
    if (!point || !settings) {
      brushCursor.visible = false;
      return;
    }
    brushCursor.visible = true;
    brushCursor.position.set(point.x, 0.06, point.z);
    brushCursor.scale.set(settings.radius, settings.radius, settings.radius);
  }

  function addMarker(x: number, z: number) {
    const marker = new THREE.Mesh(markerProto.geometry, markerProto.material);
    marker.position.set(x, 0.25, z);
    markerGroup.add(marker);
  }

  function clearStrokePreview() {
    markerGroup.clear();
  }

  function stampPlace(x: number, z: number) {
    if (!settings || settings.paletteAssetDefinitionIds.length === 0) {
      return;
    }
    const area = Math.PI * settings.radius * settings.radius;
    const count = Math.min(
      MAX_INSTANCES_PER_STAMP,
      Math.max(1, Math.round(area * settings.density))
    );
    for (let index = 0; index < count; index += 1) {
      // Random-in-disc via sqrt for uniform area distribution; every
      // roll is seeded from the stamp position so re-running the same
      // stroke lands the same props.
      const angle = hash01(stampSeed(x, z, index * 4 + 1)) * Math.PI * 2;
      const distance =
        Math.sqrt(hash01(stampSeed(x, z, index * 4 + 2))) * settings.radius;
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;

      const palettePick =
        settings.paletteAssetDefinitionIds[
          Math.floor(
            hash01(stampSeed(x, z, index * 4 + 3)) *
              settings.paletteAssetDefinitionIds.length
          ) % settings.paletteAssetDefinitionIds.length
        ]!;
      const yaw =
        (hash01(stampSeed(x, z, index * 4 + 4)) - 0.5) *
        Math.PI *
        2 *
        settings.rotationJitter;
      const scale =
        settings.scaleJitter[0] +
        (settings.scaleJitter[1] - settings.scaleJitter[0]) *
          hash01(stampSeed(px, pz, 5));

      const displayName = config.getAssetDisplayName(palettePick);
      strokePlacements.push({
        instanceId: config.createInstanceId(displayName),
        assetDefinitionId: palettePick,
        displayName,
        position: [px, 0, pz],
        rotation: [0, yaw, 0],
        scale: [scale, scale, scale]
      });
      addMarker(px, pz);
    }
  }

  function stampErase(x: number, z: number) {
    if (!settings) return;
    const radiusSq = settings.radius * settings.radius;
    for (const asset of config.getPlacedAssets()) {
      const dx = asset.position[0] - x;
      const dz = asset.position[2] - z;
      if (dx * dx + dz * dz <= radiusSq) {
        strokeEraseIds.add(asset.instanceId);
      }
    }
  }

  function stamp(x: number, z: number) {
    if (!settings) return;
    if (settings.mode === "erase") {
      stampErase(x, z);
    } else {
      stampPlace(x, z);
    }
  }

  function commitStroke() {
    if (strokePlacements.length > 0) {
      config.commitPlacements(strokePlacements);
    }
    if (strokeEraseIds.size > 0) {
      config.commitErase([...strokeEraseIds]);
    }
    strokePlacements = [];
    strokeEraseIds = new Set();
    clearStrokePreview();
  }

  const brushController: InteractionController = {
    id: "scatter-brush-controller",
    onPointerDown(event: NormalizedPointerEvent) {
      if (event.button !== 0 || !settings) {
        return false;
      }
      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return false;
      }
      strokeActive = true;
      lastStampPoint = { x: hit.point.x, z: hit.point.z };
      updateBrushCursor(hit.point);
      stamp(hit.point.x, hit.point.z);
      return true;
    },
    onPointerMove(event: NormalizedPointerEvent) {
      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return;
      }
      updateBrushCursor(hit.point);
      if (!strokeActive || !settings) {
        return;
      }
      const spacing = settings.radius * STAMP_SPACING_FACTOR;
      const dx = hit.point.x - (lastStampPoint?.x ?? hit.point.x);
      const dz = hit.point.z - (lastStampPoint?.z ?? hit.point.z);
      if (lastStampPoint && dx * dx + dz * dz < spacing * spacing) {
        return;
      }
      lastStampPoint = { x: hit.point.x, z: hit.point.z };
      stamp(hit.point.x, hit.point.z);
    },
    onPointerUp() {
      if (!strokeActive) {
        return false;
      }
      strokeActive = false;
      lastStampPoint = null;
      commitStroke();
      return true;
    }
  };

  return {
    attach(options) {
      hitTestService.setCamera(options.camera);
      hitTestService.setAuthoredRoot(options.authoredRoot);
      hitTestService.setOverlayRoot(options.overlayRoot);
      hitTestService.setSurfaceRoot(options.surfaceRoot);
      inputRouter = options.inputRouter;
      attachedOverlayRoot = options.overlayRoot;
      attachedOverlayRoot.add(brushCursor);
      attachedOverlayRoot.add(markerGroup);
      attachedElement = options.viewportElement;

      // Join the layout router's stack -- do NOT attach a second
      // router to the element.
      inputRouter.pushController(brushController);

      const viewportElement = options.viewportElement;
      hoverHandler = (event: PointerEvent) => {
        const rect = viewportElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const normalizedY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        const hit = hitTestService.testSurface(normalizedX, normalizedY);
        updateBrushCursor(hit?.point ?? null);
      };
      viewportElement.addEventListener("pointermove", hoverHandler);

      pointerLeaveHandler = () => updateBrushCursor(null);
      viewportElement.addEventListener("pointerleave", pointerLeaveHandler);
    },
    detach() {
      // Commit any in-flight stroke rather than dropping it -- tool
      // deactivation mid-drag should not eat landed props.
      if (strokeActive) {
        strokeActive = false;
        lastStampPoint = null;
        commitStroke();
      }
      inputRouter?.popController(brushController.id);
      if (hoverHandler && attachedElement) {
        attachedElement.removeEventListener("pointermove", hoverHandler);
        hoverHandler = null;
      }
      if (pointerLeaveHandler && attachedElement) {
        attachedElement.removeEventListener("pointerleave", pointerLeaveHandler);
        pointerLeaveHandler = null;
      }
      attachedElement = null;
      if (attachedOverlayRoot) {
        attachedOverlayRoot.remove(brushCursor);
        attachedOverlayRoot.remove(markerGroup);
        attachedOverlayRoot = null;
      }
      brushCursor.visible = false;
      clearStrokePreview();
      inputRouter = null;
    },
    setSettings(next) {
      settings = next;
    }
  };
}
