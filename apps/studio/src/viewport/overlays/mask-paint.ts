/**
 * Mask paint overlay.
 *
 * Hosts inline application-site painted-mask authoring in the shared Studio
 * viewport. Reusable Surface definitions never own painted masks; authors must
 * make a reference local before painting. This overlay writes the backing
 * `masks/*.png` file through the Studio IO seam exposed by the viewport
 * context.
 */

import * as THREE from "three";
import {
  getAssetDefinition,
  getMaskTextureDefinition,
  type AuthoringSession,
  type Layer,
  type MaskTextureDefinition,
  type PaintedMaskTargetAddress,
  type RegionDocument,
  type RegionLandscapeState,
  type SurfaceBinding
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import type { ViewportOverlayFactory } from "../overlay-context";

interface MaskPaintBrushSettings {
  radius: number;
  strength: number;
  falloff: number;
  mode: "paint" | "erase";
}

const DEFAULT_BRUSH_SETTINGS: MaskPaintBrushSettings = {
  radius: 4,
  strength: 0.25,
  falloff: 0.7,
  mode: "paint"
};

interface ResolvedPaintTarget {
  address: PaintedMaskTargetAddress;
  maskTextureId: string;
  definition: MaskTextureDefinition;
  landscape: RegionLandscapeState | null;
}

function resolveInlinePaintLayer(
  binding: SurfaceBinding | null | undefined,
  layerId: string
): Layer | null {
  if (!binding || binding.kind !== "inline") {
    return null;
  }
  return binding.surface.layers.find((layer) => layer.layerId === layerId) ?? null;
}

function resolvePaintTarget(
  session: AuthoringSession | null,
  region: RegionDocument | null,
  target: PaintedMaskTargetAddress | null
): ResolvedPaintTarget | null {
  if (!session || !region || !target) {
    return null;
  }

  let layer: Layer | null = null;
  let landscape: RegionLandscapeState | null = null;

  if (target.scope === "landscape-channel") {
    landscape = region.landscape;
    const slot = landscape.surfaceSlots.find(
      (candidate) => candidate.channelId === target.channelKey
    );
    layer = resolveInlinePaintLayer(slot?.surface, target.layerId);
  } else {
    const assetDefinition = getAssetDefinition(session.contentLibrary, target.assetDefinitionId);
    const slot = assetDefinition?.surfaceSlots.find(
      (candidate) => candidate.slotName === target.slotName
    );
    layer = resolveInlinePaintLayer(slot?.surface, target.layerId);
  }

  if (!layer || layer.mask.kind !== "painted" || !layer.mask.maskTextureId) {
    return null;
  }

  const definition = getMaskTextureDefinition(
    session.contentLibrary,
    layer.mask.maskTextureId
  );
  if (!definition) {
    return null;
  }

  return {
    address: target,
    maskTextureId: layer.mask.maskTextureId,
    definition,
    landscape
  };
}

function createPaintCanvas(definition: MaskTextureDefinition): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = definition.resolution[0];
  canvas.height = definition.resolution[1];
  return canvas;
}

function paintBrush(
  canvas: HTMLCanvasElement,
  uv: THREE.Vector2,
  settings: MaskPaintBrushSettings
): void {
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });
  if (!context) {
    return;
  }

  const x = uv.x * canvas.width;
  const y = (1 - uv.y) * canvas.height;
  const brushRadius = Math.max(1, settings.radius * 12);
  const gradient = context.createRadialGradient(x, y, 0, x, y, brushRadius);
  const strength = Math.max(0, Math.min(1, settings.strength));
  const edgeAlpha = Math.max(0, Math.min(1, strength * (1 - settings.falloff)));
  const center =
    settings.mode === "erase"
      ? `rgba(0, 0, 0, ${strength})`
      : `rgba(255, 255, 255, ${strength})`;
  const edge =
    settings.mode === "erase"
      ? `rgba(0, 0, 0, ${edgeAlpha})`
      : `rgba(255, 255, 255, ${edgeAlpha})`;

  gradient.addColorStop(0, center);
  gradient.addColorStop(1, edge);
  context.save();
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, brushRadius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function pointerUvOnLandscape(
  hitPoint: THREE.Vector3,
  landscape: RegionLandscapeState
): THREE.Vector2 {
  const size = Math.max(1, landscape.size);
  const halfSize = size / 2;
  return new THREE.Vector2(
    Math.max(0, Math.min(1, (hitPoint.x + halfSize) / size)),
    Math.max(0, Math.min(1, (hitPoint.z + halfSize) / size))
  );
}

function findSceneObjectMetadata(object: THREE.Object3D): {
  instanceId: string;
  assetDefinitionId: string | null;
  kind: string;
} | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const metadata = current.userData.sugarmagicSceneObject;
    if (metadata) {
      return metadata as {
        instanceId: string;
        assetDefinitionId: string | null;
        kind: string;
      };
    }
    current = current.parent;
  }
  return null;
}

function matchesAssetSlotHit(
  hit: THREE.Intersection<THREE.Object3D>,
  target: Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>
): THREE.Vector2 | null {
  if (!(hit.object instanceof THREE.Mesh) || !hit.uv) {
    return null;
  }
  const metadata = findSceneObjectMetadata(hit.object);
  if (!metadata || metadata.assetDefinitionId !== target.assetDefinitionId) {
    return null;
  }
  const slotMetadata = hit.object.userData.sugarmagicMaterialSlots as
    | Array<{ slotName: string; slotIndex: number } | null>
    | undefined;
  if (!slotMetadata?.length) {
    return null;
  }
  const materialIndex = hit.face?.materialIndex ?? 0;
  const slot =
    slotMetadata[materialIndex] ??
    slotMetadata[0] ??
    null;
  if (!slot || slot.slotName !== target.slotName) {
    return null;
  }
  return hit.uv;
}

function findLandscapeHit(
  root: THREE.Object3D,
  raycaster: THREE.Raycaster
): THREE.Intersection<THREE.Object3D> | null {
  const hits = raycaster.intersectObject(root, true);
  return (
    hits.find(
      (hit) => hit.object.userData?.sugarmagicLandscapeSurface === true
    ) ?? null
  );
}

function findAssetSlotHit(
  root: THREE.Object3D,
  raycaster: THREE.Raycaster,
  target: Extract<PaintedMaskTargetAddress, { scope: "asset-slot" }>
): THREE.Vector2 | null {
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    const uv = matchesAssetSlotHit(hit, target);
    if (uv) {
      return uv;
    }
  }
  return null;
}

export const mountMaskPaintOverlay: ViewportOverlayFactory = (context) => {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let currentTarget: ResolvedPaintTarget | null = null;
  let paintCanvas: HTMLCanvasElement | null = null;
  let paintDirty = false;
  let writeInFlight = false;
  let pointerId: number | null = null;
  let currentBrushSettings = DEFAULT_BRUSH_SETTINGS;

  async function loadCanvasForTarget(target: ResolvedPaintTarget | null): Promise<void> {
    currentTarget = target;
    paintDirty = false;
    if (!target) {
      paintCanvas = null;
      return;
    }
    const canvas = createPaintCanvas(target.definition);
    const context2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!context2d) {
      paintCanvas = null;
      return;
    }
    const imageData = await context.readMaskTexture(target.maskTextureId);
    if (imageData) {
      context2d.putImageData(imageData, 0, 0);
    } else {
      context2d.clearRect(0, 0, canvas.width, canvas.height);
    }
    paintCanvas = canvas;
    context.previewMaskTexture(target.maskTextureId, canvas);
  }

  async function commitPaintIfNeeded(): Promise<void> {
    if (!paintDirty || !paintCanvas || !currentTarget || writeInFlight) {
      return;
    }
    const context2d = paintCanvas.getContext("2d");
    if (!context2d) {
      return;
    }
    writeInFlight = true;
    try {
      await context.writeMaskTexture(
        currentTarget.maskTextureId,
        context2d.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
      );
      paintDirty = false;
    } finally {
      writeInFlight = false;
    }
  }

  function paintAtClientPosition(
    clientX: number,
    clientY: number,
    brushSettings: MaskPaintBrushSettings
  ): boolean {
    if (!currentTarget || !paintCanvas) {
      return false;
    }

    const bounds = context.domElement.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -(((clientY - bounds.top) / bounds.height) * 2 - 1);
    raycaster.setFromCamera(pointer, context.getCamera());

    let uv: THREE.Vector2 | null = null;
    if (currentTarget.address.scope === "landscape-channel") {
      const landscapeHit = findLandscapeHit(context.surfaceRoot, raycaster);
      if (landscapeHit && currentTarget.landscape) {
        uv = pointerUvOnLandscape(landscapeHit.point, currentTarget.landscape);
      }
    } else {
      uv = findAssetSlotHit(
        context.authoredRoot,
        raycaster,
        currentTarget.address
      );
    }

    if (!uv) {
      return false;
    }

    paintBrush(paintCanvas, uv, brushSettings);
    paintDirty = true;
    context.previewMaskTexture(currentTarget.maskTextureId, paintCanvas);
    return true;
  }

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      target: viewport.activeMaskPaintTarget,
      brushSettings: viewport.brushSettings ?? DEFAULT_BRUSH_SETTINGS,
      session: project.session,
      activeRegion: project.session ? context.stateAccess.getActiveRegion() : null
    }),
    (slice) => {
      currentBrushSettings = slice.brushSettings;
      const isActive = slice.activeProductMode === "build";
      if (!isActive || !slice.target) {
        currentTarget = null;
        paintCanvas = null;
        paintDirty = false;
        pointerId = null;
        return;
      }

      const resolvedTarget = resolvePaintTarget(
        slice.session,
        slice.activeRegion,
        slice.target
      );
      if (!resolvedTarget) {
        context.stateAccess.setActiveMaskPaintTarget(null);
        currentTarget = null;
        paintCanvas = null;
        paintDirty = false;
        return;
      }

      if (
        currentTarget?.maskTextureId !== resolvedTarget.maskTextureId ||
        currentTarget.address.scope !== resolvedTarget.address.scope ||
        currentTarget.address.layerId !== resolvedTarget.address.layerId ||
        (
          currentTarget.address.scope === "landscape-channel"
            ? currentTarget.address.channelKey !==
              (resolvedTarget.address.scope === "landscape-channel"
                ? resolvedTarget.address.channelKey
                : "")
            : currentTarget.address.slotName !==
                (resolvedTarget.address.scope === "asset-slot"
                  ? resolvedTarget.address.slotName
                  : "") ||
              currentTarget.address.assetDefinitionId !==
                (resolvedTarget.address.scope === "asset-slot"
                  ? resolvedTarget.address.assetDefinitionId
                  : "")
        )
      ) {
        void loadCanvasForTarget(resolvedTarget);
      }
    },
    { equalityFn: shallowEqual }
  );

  async function finishPointer(event: PointerEvent) {
    if (pointerId !== event.pointerId) {
      return;
    }
    pointerId = null;
    await commitPaintIfNeeded();
  }

  function handlePointerDown(event: PointerEvent) {
    if (!paintAtClientPosition(event.clientX, event.clientY, currentBrushSettings)) {
      return;
    }
    pointerId = event.pointerId;
    context.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) {
      return;
    }
    paintAtClientPosition(event.clientX, event.clientY, currentBrushSettings);
  }

  context.domElement.addEventListener("pointerdown", handlePointerDown);
  context.domElement.addEventListener("pointermove", handlePointerMove);
  context.domElement.addEventListener("pointerup", finishPointer);
  context.domElement.addEventListener("pointercancel", finishPointer);

  return () => {
    unsubscribeProjection();
    context.domElement.removeEventListener("pointerdown", handlePointerDown);
    context.domElement.removeEventListener("pointermove", handlePointerMove);
    context.domElement.removeEventListener("pointerup", finishPointer);
    context.domElement.removeEventListener("pointercancel", finishPointer);
  };
};
