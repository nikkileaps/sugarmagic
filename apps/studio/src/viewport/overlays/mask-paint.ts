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
  getActiveScene,
  getAssetDefinition,
  getMaskTextureDefinition,
  type AuthoringSession,
  type Layer,
  type MaskTextureDefinition,
  type PaintedMaskTargetAddress,
  type PlacedAssetInstance,
  type RegionDocument,
  type RegionLandscapeState,
  type SurfaceBinding
} from "@sugarmagic/domain";
import { shallowEqual } from "@sugarmagic/shell";
import {
  getLayoutWorkspaceForViewport,
  type InteractionController,
  type NormalizedPointerEvent
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";
import {
  createPaintBrushRing,
  findSceneObjectMetadata,
  stampWorldSpaceBrush,
  type ProjectionBrushSettings
} from "./projection-paint";

type MaskPaintBrushSettings = ProjectionBrushSettings;

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
  } else if (target.scope === "asset-slot") {
    const assetDefinition = getAssetDefinition(session.contentLibrary, target.assetDefinitionId);
    const slot = assetDefinition?.surfaceSlots.find(
      (candidate) => candidate.slotName === target.slotName
    );
    layer = resolveInlinePaintLayer(slot?.surface, target.layerId);
  } else {
    // Plan 068.4 -- the painted layer lives on a PLACED INSTANCE's
    // override: the Scene restyle record, a scene-contained
    // instance, or a base instance. layerIds are unique, so search
    // every tier that can own an inline surface for this instance.
    const activeScene = getActiveScene(session);
    const overlay = activeScene?.regionOverlays[region.identity.id] ?? null;
    const instance: PlacedAssetInstance | null =
      region.placedAssets.find(
        (candidate) => candidate.instanceId === target.instanceId
      ) ??
      overlay?.placedAssets.find(
        (candidate) => candidate.instanceId === target.instanceId
      ) ??
      null;
    const sceneRecordOverride = overlay?.assetAppearanceOverrides[
      target.instanceId
    ]?.surfaceSlotOverrides?.find(
      (candidate) => candidate.slotName === target.slotName
    );
    const instanceOverride = instance?.surfaceSlotOverrides?.find(
      (candidate) => candidate.slotName === target.slotName
    );
    layer =
      resolveInlinePaintLayer(sceneRecordOverride?.surface, target.layerId) ??
      resolveInlinePaintLayer(instanceOverride?.surface, target.layerId);
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
  settings: MaskPaintBrushSettings,
  radiusPx: number
): void {
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });
  if (!context) {
    return;
  }

  const x = uv.x * canvas.width;
  const y = (1 - uv.y) * canvas.height;
  const brushRadius = Math.max(1, radiusPx);
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

function matchesAssetSlotHit(
  hit: THREE.Intersection<THREE.Object3D>,
  target: Extract<
    PaintedMaskTargetAddress,
    { scope: "asset-slot" } | { scope: "instance-slot" }
  >
): THREE.Vector2 | null {
  // Paint UV channel first (Plan 068.8): three populates hit.uv1
  // from the TEXCOORD_1 attribute when the geometry carries it.
  const paintUv = hit.uv1 ?? hit.uv;
  if (!(hit.object instanceof THREE.Mesh) || !paintUv) {
    return null;
  }
  const metadata = findSceneObjectMetadata(hit.object);
  if (!metadata || metadata.assetDefinitionId !== target.assetDefinitionId) {
    return null;
  }
  // Instance-owned layers paint THIS placement only -- strokes on a
  // sibling of the same asset must not land (Plan 068.4).
  if (target.scope === "instance-slot" && metadata.instanceId !== target.instanceId) {
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
  return paintUv;
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
  target: Extract<
    PaintedMaskTargetAddress,
    { scope: "asset-slot" } | { scope: "instance-slot" }
  >
): { uv: THREE.Vector2; hit: THREE.Intersection<THREE.Object3D> } | null {
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    const uv = matchesAssetSlotHit(hit, target);
    if (uv) {
      return { uv, hit };
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
    const committedTarget = currentTarget;
    try {
      await context.writeMaskTexture(
        committedTarget.maskTextureId,
        context2d.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
      );
      paintDirty = false;
      // Scatter layers gated by this mask are CPU-built: force the
      // owning renderable's shader application to re-run so grass
      // reflects the stroke (appearance layers update via the live
      // texture and don't need this).
      if (committedTarget.address.scope === "instance-slot") {
        context.stateAccess.invalidateRenderableShaders({
          instanceId: committedTarget.address.instanceId
        });
      } else if (committedTarget.address.scope === "asset-slot") {
        context.stateAccess.invalidateRenderableShaders({
          assetDefinitionId: committedTarget.address.assetDefinitionId
        });
      }
    } finally {
      writeInFlight = false;
    }
  }

  function fillMask(mode: "paint" | "erase"): void {
    if (!currentTarget || !paintCanvas) {
      return;
    }
    const context2d = paintCanvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!context2d) {
      return;
    }
    context2d.save();
    context2d.fillStyle = mode === "erase" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
    context2d.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    context2d.restore();
    paintDirty = true;
    context.previewMaskTexture(currentTarget.maskTextureId, paintCanvas);
    void commitPaintIfNeeded();
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

    if (currentTarget.address.scope === "landscape-channel") {
      // The landscape is a flat plane whose UV IS world XZ -- a
      // texture-space circle is correct there, no fragmentation.
      const landscapeHit = findLandscapeHit(context.surfaceRoot, raycaster);
      if (!landscapeHit || !currentTarget.landscape) {
        return false;
      }
      const uv = pointerUvOnLandscape(
        landscapeHit.point,
        currentTarget.landscape
      );
      paintBrush(
        paintCanvas,
        uv,
        brushSettings,
        Math.max(1, brushSettings.radius * 12)
      );
    } else {
      // Assets: WORLD-space projection paint (Plan 068.11) -- a
      // texture circle is the wrong shape on the fragmented paint-UV
      // atlas.
      const result = findAssetSlotHit(
        context.authoredRoot,
        raycaster,
        currentTarget.address
      );
      if (!result) {
        return false;
      }
      stampWorldSpaceBrush(paintCanvas, result.hit, brushSettings);
    }

    paintDirty = true;
    context.previewMaskTexture(currentTarget.maskTextureId, paintCanvas);
    return true;
  }

  // Plan 068.4 -- in the LAYOUT workspace, painting joins the layout
  // InputRouter as a controller (top controller wins: click-select,
  // gizmo, and scatter brush are suspended while the brush is armed).
  // The raw DOM listeners below remain ONLY for the Landscape
  // workspace, which has no router; they no-op while the controller
  // is pushed.
  const brushRing = createPaintBrushRing();
  context.overlayRoot.add(brushRing);
  let controllerPushed = false;
  let strokeActive = false;
  let activeBuildWorkspaceKind: string | null = null;

  function updateBrushRing(clientX: number, clientY: number): void {
    if (
      !currentTarget ||
      currentTarget.address.scope === "landscape-channel"
    ) {
      brushRing.visible = false;
      return;
    }
    const bounds = context.domElement.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -(((clientY - bounds.top) / bounds.height) * 2 - 1);
    raycaster.setFromCamera(pointer, context.getCamera());
    const result = findAssetSlotHit(
      context.authoredRoot,
      raycaster,
      currentTarget.address
    );
    if (!result) {
      brushRing.visible = false;
      return;
    }
    const worldNormal = result.hit.face
      ? result.hit.face.normal
          .clone()
          .transformDirection(result.hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    brushRing.visible = true;
    brushRing.position
      .copy(result.hit.point)
      .addScaledVector(worldNormal, 0.02);
    brushRing.lookAt(result.hit.point.clone().add(worldNormal));
    // Radius is world meters on the surface; ring geometry has unit
    // outer radius, so scale IS the radius.
    brushRing.scale.setScalar(Math.max(0.03, currentBrushSettings.radius));
  }

  const paintController: InteractionController = {
    id: "mask-paint-controller",
    onPointerDown(event: NormalizedPointerEvent): boolean {
      if (event.button !== 0) {
        return false;
      }
      // Swallow every left press while the brush is armed -- a miss
      // must not fall through to click-select/deselect underneath.
      strokeActive = paintAtClientPosition(
        event.screenX,
        event.screenY,
        currentBrushSettings
      );
      return true;
    },
    onPointerMove(event: NormalizedPointerEvent): void {
      if (!strokeActive) {
        return;
      }
      paintAtClientPosition(event.screenX, event.screenY, currentBrushSettings);
      updateBrushRing(event.screenX, event.screenY);
    },
    onPointerUp(): void {
      strokeActive = false;
      void commitPaintIfNeeded();
    },
    onHoverMove(event: NormalizedPointerEvent): void {
      updateBrushRing(event.screenX, event.screenY);
    },
    onHoverLeave(): void {
      brushRing.visible = false;
    },
    onCancel(): void {
      strokeActive = false;
      void commitPaintIfNeeded();
    }
  };

  function syncControllerForTarget(): void {
    // Controller mode is a LAYOUT-workspace arrangement; other build
    // workspaces (Landscape) keep the raw-listener path. Without this
    // gate, switching workspaces mid-paint stranded the controller in
    // the router and suppressed landscape strokes until Done.
    const wantsController =
      Boolean(currentTarget) &&
      currentTarget!.address.scope !== "landscape-channel" &&
      activeBuildWorkspaceKind === "layout";
    const layout = getLayoutWorkspaceForViewport(context.domElement);
    if (wantsController && layout && !controllerPushed) {
      layout.inputRouter.pushController(paintController);
      controllerPushed = true;
    } else if (!wantsController && controllerPushed) {
      layout?.inputRouter.popController(paintController.id);
      controllerPushed = false;
      brushRing.visible = false;
      strokeActive = false;
    }
  }

  // Escape exits paint mode (Done button's keyboard sibling). The
  // router only routes Escape mid-gesture, so this listens directly.
  function handlePaintModeKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !controllerPushed) {
      return;
    }
    void commitPaintIfNeeded();
    context.stateAccess.setActiveMaskPaintTarget(null);
  }
  window.addEventListener("keydown", handlePaintModeKeydown);

  const unsubscribeProjection = context.subscribeToProjection(
    ({ project, shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      target: viewport.activeMaskPaintTarget,
      fillRequest: viewport.maskPaintFillRequest,
      brushSettings: viewport.brushSettings ?? DEFAULT_BRUSH_SETTINGS,
      session: project.session,
      activeRegion: project.session ? context.stateAccess.getActiveRegion() : null
    }),
    (slice) => {
      activeBuildWorkspaceKind = slice.activeBuildWorkspaceKind ?? null;
      // Mask painting has no sketch concept; the pencil coerces to
      // paint so a stale mask target can't erase by accident.
      currentBrushSettings = {
        ...slice.brushSettings,
        mode:
          slice.brushSettings.mode === "sketch"
            ? "paint"
            : slice.brushSettings.mode
      };
      const isActive = slice.activeProductMode === "build";
      if (!isActive || !slice.target) {
        currentTarget = null;
        paintCanvas = null;
        paintDirty = false;
        pointerId = null;
        syncControllerForTarget();
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
        syncControllerForTarget();
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
        void loadCanvasForTarget(resolvedTarget).then(() => {
          consumeFillRequest(slice.fillRequest);
        });
      } else {
        currentTarget = resolvedTarget;
        consumeFillRequest(slice.fillRequest);
      }
      syncControllerForTarget();
    },
    { equalityFn: shallowEqual }
  );

  let consumedFillNonce = 0;
  function consumeFillRequest(
    request: { mode: "paint" | "erase"; nonce: number } | null
  ): void {
    if (!request || request.nonce === consumedFillNonce) {
      return;
    }
    consumedFillNonce = request.nonce;
    fillMask(request.mode);
    context.stateAccess.clearMaskPaintFillRequest();
  }

  async function finishPointer(event: PointerEvent) {
    if (pointerId !== event.pointerId) {
      return;
    }
    pointerId = null;
    await commitPaintIfNeeded();
  }

  function handlePointerDown(event: PointerEvent) {
    if (controllerPushed) {
      // Layout painting rides the InputRouter controller; the raw
      // path would double-paint every stroke.
      return;
    }
    if (!paintAtClientPosition(event.clientX, event.clientY, currentBrushSettings)) {
      return;
    }
    pointerId = event.pointerId;
    context.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    if (controllerPushed || pointerId !== event.pointerId) {
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
    if (controllerPushed) {
      getLayoutWorkspaceForViewport(context.domElement)?.inputRouter.popController(
        paintController.id
      );
      controllerPushed = false;
    }
    window.removeEventListener("keydown", handlePaintModeKeydown);
    context.overlayRoot.remove(brushRing);
    brushRing.geometry.dispose();
    (brushRing.material as THREE.Material).dispose();
    context.domElement.removeEventListener("pointerdown", handlePointerDown);
    context.domElement.removeEventListener("pointermove", handlePointerMove);
    context.domElement.removeEventListener("pointerup", finishPointer);
    context.domElement.removeEventListener("pointercancel", finishPointer);
  };
};
