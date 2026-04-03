import * as THREE from "three";
import type {
  RegionLandscapePaintPayload,
  RegionLandscapeState
} from "@sugarmagic/domain";
import {
  createInputRouter,
  createHitTestService,
  type HitTestService,
  type InputRouter,
  type InteractionController,
  type NormalizedPointerEvent
} from "../../interaction";

export type LandscapeBrushMode = "paint" | "erase";

export interface LandscapeBrushSettings {
  radius: number;
  strength: number;
  falloff: number;
  mode: LandscapeBrushMode;
}

export interface LandscapeWorkspaceConfig {
  getLandscape: () => RegionLandscapeState | null;
  previewLandscape: (landscape: RegionLandscapeState) => void;
  paintLandscapeAt: (options: {
    channelIndex: number;
    worldX: number;
    worldZ: number;
    radius: number;
    strength: number;
    falloff: number;
  }) => boolean;
  serializePaintPayload: () => RegionLandscapePaintPayload | null;
  commitPaint: (
    paintPayload: RegionLandscapePaintPayload | null,
    affectedBounds: [number, number, number, number]
  ) => void;
  onPreviewTick: () => void;
}

export interface LandscapeWorkspaceInstance {
  attach: (
    viewportElement: HTMLElement,
    camera: THREE.Camera,
    authoredRoot: THREE.Object3D,
    overlayRoot: THREE.Object3D,
    surfaceRoot: THREE.Object3D
  ) => void;
  detach: () => void;
  setActiveChannelIndex: (channelIndex: number) => void;
  setBrushSettings: (settings: LandscapeBrushSettings) => void;
  syncLandscape: () => void;
  hitTestService: HitTestService;
  inputRouter: InputRouter;
}

function cloneLandscape(landscape: RegionLandscapeState): RegionLandscapeState {
  return {
    ...landscape,
    channels: landscape.channels.map((channel) => ({ ...channel })),
    paintPayload: landscape.paintPayload
      ? {
          ...landscape.paintPayload,
          layers: [...landscape.paintPayload.layers]
        }
      : null
  };
}

function createBrushCursor(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.92, 1, 48);
  const material = new THREE.MeshBasicMaterial({
    color: 0xf5c2e7,
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
  mesh.name = "landscape-brush-cursor";
  return mesh;
}

function cloneBounds(bounds: [number, number, number, number] | null) {
  return bounds ? ([...bounds] as [number, number, number, number]) : null;
}

export function createLandscapeWorkspace(
  config: LandscapeWorkspaceConfig
): LandscapeWorkspaceInstance {
  const inputRouter = createInputRouter();
  const hitTestService = createHitTestService();
  const brushCursor = createBrushCursor();

  let activeChannelIndex = 1;
  let brushSettings: LandscapeBrushSettings = {
    radius: 4,
    strength: 0.25,
    falloff: 0.7,
    mode: "paint"
  };
  let canonicalLandscape: RegionLandscapeState | null = null;
  let attachedOverlayRoot: THREE.Object3D | null = null;
  let attachedElement: HTMLElement | null = null;
  let hoverHandler: ((event: PointerEvent) => void) | null = null;
  let pointerLeaveHandler: (() => void) | null = null;
  let strokeBounds: [number, number, number, number] | null = null;
  let lastStrokePoint: { x: number; z: number } | null = null;

  function updateBrushCursor(position: THREE.Vector3 | null) {
    brushCursor.scale.setScalar(brushSettings.radius);
    if (!position || activeChannelIndex < 1) {
      brushCursor.visible = false;
      return;
    }

    brushCursor.position.set(position.x, position.y + 0.03, position.z);
    brushCursor.visible = true;
  }

  function updateBounds(worldX: number, worldZ: number) {
    if (!strokeBounds) {
      strokeBounds = [worldX, worldZ, worldX, worldZ];
      return;
    }

    strokeBounds[0] = Math.min(strokeBounds[0], worldX);
    strokeBounds[1] = Math.min(strokeBounds[1], worldZ);
    strokeBounds[2] = Math.max(strokeBounds[2], worldX);
    strokeBounds[3] = Math.max(strokeBounds[3], worldZ);
  }

  function paintPoint(worldX: number, worldZ: number): boolean {
    const signedStrength =
      brushSettings.mode === "erase" ? -brushSettings.strength : brushSettings.strength;
    const painted = config.paintLandscapeAt({
      channelIndex: activeChannelIndex,
      worldX,
      worldZ,
      radius: brushSettings.radius,
      strength: signedStrength,
      falloff: brushSettings.falloff
    });
    if (!painted) {
      return false;
    }

    updateBounds(worldX, worldZ);
    config.onPreviewTick();
    return true;
  }

  function paintInterpolatedLine(from: { x: number; z: number }, to: { x: number; z: number }) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const step = Math.max(brushSettings.radius * 0.35, 0.25);
    const steps = Math.max(1, Math.ceil(distance / step));

    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      paintPoint(from.x + dx * t, from.z + dz * t);
    }
  }

  const brushController: InteractionController = {
    id: "landscape-brush-controller",
    onPointerDown(event: NormalizedPointerEvent) {
      if (event.button !== 0 || activeChannelIndex < 1) {
        return false;
      }

      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return false;
      }

      canonicalLandscape = config.getLandscape();
      strokeBounds = null;
      lastStrokePoint = { x: hit.point.x, z: hit.point.z };
      updateBrushCursor(hit.point);
      return paintPoint(hit.point.x, hit.point.z);
    },
    onPointerMove(event: NormalizedPointerEvent) {
      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return;
      }

      updateBrushCursor(hit.point);
      const nextPoint = { x: hit.point.x, z: hit.point.z };
      if (lastStrokePoint) {
        paintInterpolatedLine(lastStrokePoint, nextPoint);
      } else {
        paintPoint(nextPoint.x, nextPoint.z);
      }
      lastStrokePoint = nextPoint;
    },
    onPointerUp() {
      if (!lastStrokePoint) {
        return;
      }
      const payload = config.serializePaintPayload();
      config.commitPaint(payload, cloneBounds(strokeBounds) ?? [0, 0, 0, 0]);
      strokeBounds = null;
      lastStrokePoint = null;
    },
    onCancel() {
      if (canonicalLandscape) {
        config.previewLandscape(cloneLandscape(canonicalLandscape));
      }
      strokeBounds = null;
      lastStrokePoint = null;
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
      attachedOverlayRoot.add(brushCursor);
      attachedElement = viewportElement;

      inputRouter.pushController(brushController);
      inputRouter.attach(viewportElement);

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
      inputRouter.detach();
      inputRouter.popController(brushController.id);
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
        attachedOverlayRoot = null;
      }
      brushCursor.visible = false;
      if (canonicalLandscape) {
        config.previewLandscape(cloneLandscape(canonicalLandscape));
      }
      strokeBounds = null;
      lastStrokePoint = null;
    },
    setActiveChannelIndex(channelIndex) {
      activeChannelIndex = channelIndex;
      brushCursor.visible = false;
    },
    setBrushSettings(settings) {
      brushSettings = settings;
      brushCursor.scale.setScalar(settings.radius);
    },
    syncLandscape() {
      const landscape = config.getLandscape();
      canonicalLandscape = landscape ? cloneLandscape(landscape) : null;
    }
  };
}
