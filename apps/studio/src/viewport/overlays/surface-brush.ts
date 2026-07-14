/**
 * Surface Brush overlay (Plan 068.9 -- "the magic").
 *
 * Arm a library surface, paint on a placed asset, and the surface
 * appears where you paint. On the FIRST stroke over a slot the brush
 * sets that slot up: fork its binding to an inline override (preserving
 * the existing layers as the base) and append a masked surface-ref layer
 * carrying the chosen library surface with a fresh painted mask. Then --
 * and on every later stroke -- it paints the world-space projection
 * brush into that mask, so grass/moss/stone shows only where brushed.
 *
 * The painting itself reuses the shared projection-paint core (one
 * source of truth with the mask-paint overlay); this overlay adds the
 * first-touch setup + slot discovery on top.
 */

import * as THREE from "three";
import {
  applyCommand,
  cloneSurface,
  createDefaultSurface,
  createSurface,
  createSurfaceRefLayer,
  getActiveScene,
  getAssetDefinition,
  getSurfaceDefinition,
  type PlacedAssetInstance,
  type RegionDocument,
  type Surface,
  type SurfaceBinding,
  type AuthoringSession
} from "@sugarmagic/domain";
import { shallowEqual, type SurfaceBrushSettings } from "@sugarmagic/shell";
import {
  getLayoutWorkspaceForViewport,
  type InteractionController,
  type NormalizedPointerEvent
} from "@sugarmagic/workspaces";
import type { ViewportOverlayFactory } from "../overlay-context";
import {
  createPaintBrushRing,
  discoverAssetSlotHit,
  stampWorldSpaceBrush,
  type DiscoveredAssetSlotHit,
  type ProjectionBrushSettings
} from "./projection-paint";

function findInstance(
  session: AuthoringSession,
  region: RegionDocument,
  instanceId: string
): PlacedAssetInstance | null {
  const overlay = getActiveScene(session)?.regionOverlays[region.identity.id] ?? null;
  return (
    region.placedAssets.find((asset) => asset.instanceId === instanceId) ??
    overlay?.placedAssets.find((asset) => asset.instanceId === instanceId) ??
    null
  );
}

/** An existing surface-ref layer for THIS library surface with a
 *  painted mask -- so repeated strokes reuse it instead of stacking a
 *  new layer per stroke. */
function findSurfaceRefLayer(
  binding: SurfaceBinding | null,
  surfaceDefinitionId: string
): { layerId: string; maskTextureId: string } | null {
  if (!binding || binding.kind !== "inline") {
    return null;
  }
  for (const layer of binding.surface.layers) {
    if (
      layer.kind === "appearance" &&
      layer.content.kind === "surface" &&
      layer.content.surfaceDefinitionId === surfaceDefinitionId &&
      layer.mask.kind === "painted" &&
      layer.mask.maskTextureId
    ) {
      return { layerId: layer.layerId, maskTextureId: layer.mask.maskTextureId };
    }
  }
  return null;
}

/** Fork the slot's current binding into an inline surface whose layers
 *  become the base (makeBindingLocal in spirit); null falls back to a
 *  neutral base so the surface-ref always composites over something. */
function forkBaseSurface(
  binding: SurfaceBinding | null,
  session: AuthoringSession
): Surface {
  if (binding?.kind === "inline") {
    return cloneSurface(binding.surface);
  }
  if (binding?.kind === "reference") {
    const definition = getSurfaceDefinition(
      session.contentLibrary,
      binding.surfaceDefinitionId
    );
    if (definition) {
      return cloneSurface(definition.surface);
    }
  }
  return createDefaultSurface();
}

export const mountSurfaceBrushOverlay: ViewportOverlayFactory = (context) => {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let currentSettings: SurfaceBrushSettings | null = null;
  let activeBuildWorkspaceKind: string | null = null;
  let productModeIsBuild = false;

  // Active painted slot (set on first touch; reused across strokes).
  let activeSlotKey: string | null = null;
  let activeInstanceId: string | null = null;
  let activeSlotName: string | null = null;
  let activeMaskTextureId: string | null = null;
  let paintCanvas: HTMLCanvasElement | null = null;

  let strokeActive = false;
  let setupInFlight = false;
  let paintDirty = false;
  let writeInFlight = false;

  const brushRing = createPaintBrushRing(0xcba6f7);
  context.overlayRoot.add(brushRing);
  let controllerPushed = false;

  function projectionSettings(): ProjectionBrushSettings {
    const settings = currentSettings ?? {
      radius: 2,
      strength: 0.6,
      falloff: 0.7,
      mode: "paint" as const
    };
    return {
      radius: settings.radius,
      strength: settings.strength,
      falloff: settings.falloff,
      mode: settings.mode
    };
  }

  function raycastDiscover(
    clientX: number,
    clientY: number
  ): DiscoveredAssetSlotHit | null {
    const bounds = context.domElement.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -(((clientY - bounds.top) / bounds.height) * 2 - 1);
    raycaster.setFromCamera(pointer, context.getCamera());
    const hits = raycaster.intersectObject(context.authoredRoot, true);
    return discoverAssetSlotHit(hits);
  }

  async function ensureSlotLayer(
    disc: DiscoveredAssetSlotHit,
    surfaceDefinitionId: string
  ): Promise<{ maskTextureId: string } | null> {
    const session = context.stateAccess.getSession();
    const region = context.stateAccess.getActiveRegion();
    if (!session || !region) {
      return null;
    }
    const instance = findInstance(session, region, disc.instanceId);
    const currentOverride =
      instance?.surfaceSlotOverrides?.find(
        (candidate) => candidate.slotName === disc.slotName
      )?.surface ?? null;

    const existing = findSurfaceRefLayer(currentOverride, surfaceDefinitionId);
    if (existing) {
      return { maskTextureId: existing.maskTextureId };
    }

    // Mint a blank painted mask (creates the backing PNG + registers the
    // definition in the session synchronously before we reference it).
    const definition = await context.createMaskTextureDefinition();
    if (!definition) {
      return null;
    }

    const assetDefinition = getAssetDefinition(
      session.contentLibrary,
      disc.assetDefinitionId
    );
    const assetSlotBinding =
      assetDefinition?.surfaceSlots.find(
        (candidate) => candidate.slotName === disc.slotName
      )?.surface ?? null;

    const latest = context.stateAccess.getSession();
    if (!latest) {
      return null;
    }
    const base = forkBaseSurface(currentOverride ?? assetSlotBinding, latest);
    const surfaceName =
      getSurfaceDefinition(latest.contentLibrary, surfaceDefinitionId)
        ?.displayName ?? "Surface";
    const refLayer = createSurfaceRefLayer(surfaceDefinitionId, {
      blendMode: "mix",
      displayName: surfaceName,
      mask: { kind: "painted", maskTextureId: definition.definitionId }
    });
    // Asset surface slots are universal; the forked base + surface-ref
    // never introduce landscape-only masks, so the cast is safe.
    const nextSurface = createSurface([...base.layers, refLayer]) as Surface<"universal">;
    const nextBinding: SurfaceBinding<"universal"> = {
      kind: "inline",
      surface: nextSurface
    };

    const nextSession = applyCommand(latest, {
      kind: "SetPlacedAssetSurfaceSlotOverride",
      target: {
        aggregateKind: "region-document",
        aggregateId: region.identity.id
      },
      subject: { subjectKind: "placed-asset", subjectId: disc.instanceId },
      payload: {
        instanceId: disc.instanceId,
        slotName: disc.slotName,
        surface: nextBinding,
        // v1 writes the instance base tier; Scene-scoped brushing is a
        // follow-up (reuses the AssetAppearanceSection scope control).
        scope: "base"
      }
    });
    context.stateAccess.updateSession(nextSession);
    return { maskTextureId: definition.definitionId };
  }

  async function loadCanvasForMask(
    maskTextureId: string
  ): Promise<HTMLCanvasElement | null> {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!context2d) {
      return null;
    }
    const imageData = await context.readMaskTexture(maskTextureId);
    if (imageData) {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      context2d.putImageData(imageData, 0, 0);
    } else {
      context2d.clearRect(0, 0, canvas.width, canvas.height);
    }
    context.previewMaskTexture(maskTextureId, canvas);
    return canvas;
  }

  function stampInto(disc: DiscoveredAssetSlotHit): void {
    if (!paintCanvas || !activeMaskTextureId) {
      return;
    }
    stampWorldSpaceBrush(paintCanvas, disc.hit, projectionSettings());
    paintDirty = true;
    context.previewMaskTexture(activeMaskTextureId, paintCanvas);
  }

  async function beginStroke(clientX: number, clientY: number): Promise<void> {
    const surfaceDefinitionId = currentSettings?.surfaceDefinitionId ?? null;
    if (!surfaceDefinitionId) {
      return;
    }
    const disc = raycastDiscover(clientX, clientY);
    if (!disc) {
      return;
    }
    const slotKey = `${disc.instanceId}::${disc.slotName}::${surfaceDefinitionId}`;
    if (slotKey !== activeSlotKey || !paintCanvas) {
      if (setupInFlight) {
        return;
      }
      setupInFlight = true;
      try {
        const setup = await ensureSlotLayer(disc, surfaceDefinitionId);
        if (!setup) {
          return;
        }
        const canvas = await loadCanvasForMask(setup.maskTextureId);
        if (!canvas) {
          return;
        }
        activeSlotKey = slotKey;
        activeInstanceId = disc.instanceId;
        activeSlotName = disc.slotName;
        activeMaskTextureId = setup.maskTextureId;
        paintCanvas = canvas;
      } finally {
        setupInFlight = false;
      }
    }
    // Only stamp if the gesture is still down (an await may have elapsed).
    if (strokeActive) {
      stampInto(disc);
    }
  }

  function moveStroke(clientX: number, clientY: number): void {
    if (!strokeActive || !paintCanvas) {
      return;
    }
    const disc = raycastDiscover(clientX, clientY);
    if (
      !disc ||
      disc.instanceId !== activeInstanceId ||
      disc.slotName !== activeSlotName
    ) {
      return;
    }
    stampInto(disc);
  }

  async function commitPaintIfNeeded(): Promise<void> {
    if (!paintDirty || !paintCanvas || !activeMaskTextureId || writeInFlight) {
      return;
    }
    const context2d = paintCanvas.getContext("2d");
    if (!context2d) {
      return;
    }
    writeInFlight = true;
    const maskTextureId = activeMaskTextureId;
    const instanceId = activeInstanceId;
    try {
      await context.writeMaskTexture(
        maskTextureId,
        context2d.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
      );
      paintDirty = false;
      // Scatter layers inside the painted surface are CPU-built: force
      // the owning renderable's shader application to re-run so grass
      // reflects the stroke (appearance layers update via the live
      // texture and don't need this).
      if (instanceId) {
        context.stateAccess.invalidateRenderableShaders({ instanceId });
      }
    } finally {
      writeInFlight = false;
    }
  }

  function updateBrushRing(clientX: number, clientY: number): void {
    const disc = raycastDiscover(clientX, clientY);
    if (!disc) {
      brushRing.visible = false;
      return;
    }
    const worldNormal = disc.hit.face
      ? disc.hit.face.normal
          .clone()
          .transformDirection(disc.hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    brushRing.visible = true;
    brushRing.position.copy(disc.hit.point).addScaledVector(worldNormal, 0.02);
    brushRing.lookAt(disc.hit.point.clone().add(worldNormal));
    brushRing.scale.setScalar(Math.max(0.03, projectionSettings().radius));
  }

  const brushController: InteractionController = {
    id: "surface-brush-controller",
    onPointerDown(event: NormalizedPointerEvent): boolean {
      if (event.button !== 0) {
        return false;
      }
      // No surface armed: let normal select/gizmo interaction through.
      if (!currentSettings?.surfaceDefinitionId) {
        return false;
      }
      strokeActive = true;
      void beginStroke(event.screenX, event.screenY);
      // Swallow so a miss doesn't fall through to click-deselect.
      return true;
    },
    onPointerMove(event: NormalizedPointerEvent): void {
      if (!strokeActive) {
        return;
      }
      moveStroke(event.screenX, event.screenY);
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

  function syncController(): void {
    const wantsController =
      productModeIsBuild &&
      activeBuildWorkspaceKind === "layout" &&
      Boolean(currentSettings?.surfaceDefinitionId);
    const layout = getLayoutWorkspaceForViewport(context.domElement);
    if (wantsController && layout && !controllerPushed) {
      layout.inputRouter.pushController(brushController);
      controllerPushed = true;
    } else if (!wantsController && controllerPushed) {
      layout?.inputRouter.popController(brushController.id);
      controllerPushed = false;
      brushRing.visible = false;
      strokeActive = false;
      void commitPaintIfNeeded();
    }
  }

  const unsubscribeProjection = context.subscribeToProjection(
    ({ shell, viewport }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind,
      surfaceBrushSettings: viewport.surfaceBrushSettings
    }),
    (slice) => {
      productModeIsBuild = slice.activeProductMode === "build";
      activeBuildWorkspaceKind = slice.activeBuildWorkspaceKind ?? null;
      const previousSurfaceId = currentSettings?.surfaceDefinitionId ?? null;
      currentSettings = slice.surfaceBrushSettings;
      // Disarming or switching the armed surface drops the cached slot
      // so the next touch reloads/creates the right mask.
      if (
        !currentSettings ||
        currentSettings.surfaceDefinitionId !== previousSurfaceId
      ) {
        activeSlotKey = null;
        activeInstanceId = null;
        activeSlotName = null;
        activeMaskTextureId = null;
        paintCanvas = null;
      }
      syncController();
    },
    { equalityFn: shallowEqual }
  );

  // The layout workspace may mount a beat after this overlay; retry the
  // controller push each frame until it exists (mirrors scatter brush).
  const unsubscribeFrame = context.subscribeFrame(() => {
    if (!controllerPushed) {
      syncController();
    }
  });

  return () => {
    unsubscribeProjection();
    unsubscribeFrame();
    if (controllerPushed) {
      getLayoutWorkspaceForViewport(context.domElement)?.inputRouter.popController(
        brushController.id
      );
      controllerPushed = false;
    }
    context.overlayRoot.remove(brushRing);
    brushRing.geometry.dispose();
    (brushRing.material as THREE.Material).dispose();
  };
};
