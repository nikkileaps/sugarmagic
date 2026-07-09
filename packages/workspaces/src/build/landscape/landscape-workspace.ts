import * as THREE from "three";
import type {
  RegionLandscapePaintPayload,
  RegionLandscapeState,
  RegionLayoutSketchState
} from "@sugarmagic/domain";
import { cloneSurfaceBinding } from "@sugarmagic/domain";
import type { LandscapeSketchSettings } from "@sugarmagic/shell";
import {
  createInputRouter,
  createHitTestService,
  type HitTestService,
  type InputRouter,
  type InteractionController,
  type NormalizedPointerEvent
} from "../../interaction";

export type LandscapeBrushMode = "paint" | "erase" | "sketch";

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
  /** Plan 065 §065.1 — canonical Layout Sketch for the active region. */
  getLayoutSketch: () => RegionLayoutSketchState | null;
  /** Commit the sketch after a pencil stroke ends. */
  commitLayoutSketch: (sketch: RegionLayoutSketchState) => void;
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
  setSketchSettings: (settings: LandscapeSketchSettings) => void;
  syncLandscape: () => void;
  syncSketch: () => void;
  hitTestService: HitTestService;
  inputRouter: InputRouter;
}

function cloneLandscape(landscape: RegionLandscapeState): RegionLandscapeState {
  return {
    ...landscape,
    surfaceSlots: landscape.surfaceSlots.map((slot) => ({
      ...slot,
      surface: cloneSurfaceBinding(slot.surface)
    })),
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

/**
 * Plan 065 §065.1 — Layout Sketch ink bitmap resolution. One canvas
 * per region, stretched across the whole landscape plane; at the
 * default 100m landscape that is ~2cm per texel, plenty for
 * blockout ink.
 */
const SKETCH_CANVAS_SIZE = 2048;
const DEFAULT_SKETCH_PLANE_SIZE = 100;

interface SketchLayer {
  group: THREE.Group;
  inkMesh: THREE.Mesh;
  inkMaterial: THREE.MeshBasicMaterial;
  referenceMesh: THREE.Mesh;
  referenceMaterial: THREE.MeshBasicMaterial;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  planeSize: number;
}

function createSketchLayer(): SketchLayer {
  const canvas = document.createElement("canvas");
  canvas.width = SKETCH_CANVAS_SIZE;
  canvas.height = SKETCH_CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Layout Sketch could not create a 2d canvas context.");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Ink above reference; both float just over the landscape plane
  // (mesh sits at y=0.001) and under the brush cursor (renderOrder
  // 1000). depthWrite off so translucent ink never occludes gizmos.
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);

  const referenceMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    toneMapped: false
  });
  const referenceMesh = new THREE.Mesh(geometry, referenceMaterial);
  referenceMesh.name = "layout-sketch-reference";
  referenceMesh.position.y = 0.045;
  referenceMesh.renderOrder = 899;
  referenceMesh.visible = false;

  const inkMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  });
  const inkMesh = new THREE.Mesh(geometry, inkMaterial);
  inkMesh.name = "layout-sketch-ink";
  inkMesh.position.y = 0.055;
  inkMesh.renderOrder = 900;

  const group = new THREE.Group();
  group.name = "layout-sketch-root";
  group.add(referenceMesh);
  group.add(inkMesh);
  // Scale x/z only — the meshes' small y offsets are real meters.
  group.scale.set(DEFAULT_SKETCH_PLANE_SIZE, 1, DEFAULT_SKETCH_PLANE_SIZE);

  return {
    group,
    inkMesh,
    inkMaterial,
    referenceMesh,
    referenceMaterial,
    canvas,
    ctx,
    texture,
    planeSize: DEFAULT_SKETCH_PLANE_SIZE
  };
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

  // Plan 065 §065.1 — Layout Sketch layer state.
  const sketchLayer = createSketchLayer();
  let sketchSettings: LandscapeSketchSettings = {
    color: "#1e1e2e",
    size: 0.6,
    opacity: 0.9,
    erase: false,
    visible: true
  };
  let currentSketch: RegionLayoutSketchState | null = null;
  /**
   * The ink / reference strings currently realized on the canvas and
   * reference texture. Compared against the canonical payload in
   * syncSketch so we only reload bitmaps when someone ELSE changed
   * them (undo, region switch) — after our own commit the canonical
   * string round-trips identically and we skip the async reload.
   */
  let loadedInkKey: string | null = null;
  let loadedReferenceKey: string | null = null;
  let sketchStrokeActive = false;

  function worldToSketchPx(worldX: number, worldZ: number): [number, number] {
    // Canvas row 0 lands at world -z (CanvasTexture flipY + the
    // rotateX(-PI/2) plane), matching the splatmap's orientation.
    const size = sketchLayer.planeSize;
    return [
      (worldX / size + 0.5) * sketchLayer.canvas.width,
      (worldZ / size + 0.5) * sketchLayer.canvas.height
    ];
  }

  function sketchStrokeWidthPx(): number {
    return Math.max(
      1.5,
      (sketchSettings.size / sketchLayer.planeSize) * sketchLayer.canvas.width
    );
  }

  function applySketchInkStyle(ctx: CanvasRenderingContext2D) {
    if (sketchSettings.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = sketchSettings.opacity;
      ctx.strokeStyle = sketchSettings.color;
      ctx.fillStyle = sketchSettings.color;
    }
  }

  function drawSketchDot(worldX: number, worldZ: number) {
    const [px, py] = worldToSketchPx(worldX, worldZ);
    const ctx = sketchLayer.ctx;
    ctx.save();
    applySketchInkStyle(ctx);
    ctx.beginPath();
    ctx.arc(px, py, sketchStrokeWidthPx() / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    sketchLayer.texture.needsUpdate = true;
  }

  function drawSketchSegment(
    from: { x: number; z: number },
    to: { x: number; z: number }
  ) {
    const [fx, fy] = worldToSketchPx(from.x, from.z);
    const [tx, ty] = worldToSketchPx(to.x, to.z);
    const ctx = sketchLayer.ctx;
    ctx.save();
    applySketchInkStyle(ctx);
    ctx.lineWidth = sketchStrokeWidthPx();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
    sketchLayer.texture.needsUpdate = true;
  }

  function loadSketchInk(ink: string | null) {
    loadedInkKey = ink;
    const ctx = sketchLayer.ctx;
    ctx.clearRect(0, 0, sketchLayer.canvas.width, sketchLayer.canvas.height);
    sketchLayer.texture.needsUpdate = true;
    if (!ink) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      // A newer payload may have loaded while this image decoded.
      if (loadedInkKey !== ink) {
        return;
      }
      ctx.clearRect(0, 0, sketchLayer.canvas.width, sketchLayer.canvas.height);
      ctx.drawImage(image, 0, 0, sketchLayer.canvas.width, sketchLayer.canvas.height);
      sketchLayer.texture.needsUpdate = true;
    };
    image.src = ink;
  }

  function loadSketchReference(referenceImage: string | null) {
    loadedReferenceKey = referenceImage;
    if (!referenceImage) {
      sketchLayer.referenceMesh.visible = false;
      sketchLayer.referenceMaterial.map = null;
      sketchLayer.referenceMaterial.needsUpdate = true;
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(referenceImage, (texture) => {
      if (loadedReferenceKey !== referenceImage) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      sketchLayer.referenceMaterial.map = texture;
      sketchLayer.referenceMaterial.needsUpdate = true;
      sketchLayer.referenceMesh.visible = sketchSettings.visible;
    });
  }

  function serializeSketch(): RegionLayoutSketchState {
    return {
      ink: sketchLayer.canvas.toDataURL("image/png"),
      referenceImage: currentSketch?.referenceImage ?? null,
      referenceOpacity: currentSketch?.referenceOpacity ?? 0.4
    };
  }

  function commitSketchStroke() {
    const sketch = serializeSketch();
    // Our own commit round-trips verbatim; mark it realized so the
    // projection re-fire doesn't reload the canvas we just drew on.
    loadedInkKey = sketch.ink;
    currentSketch = sketch;
    config.commitLayoutSketch(sketch);
  }

  function updateSketchVisibility() {
    sketchLayer.group.visible = sketchSettings.visible;
    sketchLayer.referenceMesh.visible =
      sketchSettings.visible && Boolean(sketchLayer.referenceMaterial.map);
  }

  function updateBrushCursor(position: THREE.Vector3 | null) {
    const sketching = brushSettings.mode === "sketch";
    brushCursor.scale.setScalar(
      sketching ? Math.max(sketchSettings.size / 2, 0.12) : brushSettings.radius
    );
    // Paint/erase need a paintable channel selected; the pencil
    // draws regardless of channel.
    if (!position || (!sketching && activeChannelIndex < 1)) {
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
      const sketching = brushSettings.mode === "sketch";
      if (event.button !== 0 || (!sketching && activeChannelIndex < 1)) {
        return false;
      }

      const hit = hitTestService.testSurface(event.normalizedX, event.normalizedY);
      if (!hit) {
        return false;
      }

      if (sketching) {
        sketchStrokeActive = true;
        lastStrokePoint = { x: hit.point.x, z: hit.point.z };
        updateBrushCursor(hit.point);
        drawSketchDot(hit.point.x, hit.point.z);
        return true;
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
      if (sketchStrokeActive) {
        if (lastStrokePoint) {
          drawSketchSegment(lastStrokePoint, nextPoint);
        }
        lastStrokePoint = nextPoint;
        return;
      }
      if (lastStrokePoint) {
        paintInterpolatedLine(lastStrokePoint, nextPoint);
      } else {
        paintPoint(nextPoint.x, nextPoint.z);
      }
      lastStrokePoint = nextPoint;
    },
    onPointerUp() {
      if (sketchStrokeActive) {
        sketchStrokeActive = false;
        lastStrokePoint = null;
        commitSketchStroke();
        return;
      }
      if (!lastStrokePoint) {
        return;
      }
      const payload = config.serializePaintPayload();
      config.commitPaint(payload, cloneBounds(strokeBounds) ?? [0, 0, 0, 0]);
      strokeBounds = null;
      lastStrokePoint = null;
    },
    onCancel() {
      if (sketchStrokeActive) {
        // Reload the canonical ink, dropping the aborted stroke.
        sketchStrokeActive = false;
        lastStrokePoint = null;
        loadSketchInk(currentSketch?.ink ?? null);
        return;
      }
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
      attachedOverlayRoot.add(sketchLayer.group);
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
        attachedOverlayRoot.remove(sketchLayer.group);
        attachedOverlayRoot = null;
      }
      brushCursor.visible = false;
      sketchStrokeActive = false;
      // Do NOT write `canonicalLandscape` back through previewLandscape on
      // detach. Under the Epic 033 store model, previewLandscape writes to
      // viewportStore.landscapeDraft — leaving a stale clone here would
      // shadow the real region.landscape in the React view every time the
      // overlay detaches (workspace switch), hiding subsequent canonical
      // updates like CreateLandscapeChannel. Detach is purely teardown.
      strokeBounds = null;
      lastStrokePoint = null;
    },
    setActiveChannelIndex(channelIndex) {
      activeChannelIndex = channelIndex;
      brushCursor.visible = false;
    },
    setBrushSettings(settings) {
      brushSettings = settings;
      brushCursor.scale.setScalar(
        settings.mode === "sketch"
          ? Math.max(sketchSettings.size / 2, 0.12)
          : settings.radius
      );
    },
    setSketchSettings(settings) {
      sketchSettings = settings;
      updateSketchVisibility();
    },
    syncLandscape() {
      const landscape = config.getLandscape();
      canonicalLandscape = landscape ? cloneLandscape(landscape) : null;
    },
    syncSketch() {
      // Mid-stroke the canvas is ahead of the canonical payload;
      // never reload out from under the author's pencil.
      if (sketchStrokeActive) {
        return;
      }
      const sketch = config.getLayoutSketch();
      const landscapeSize = Math.max(
        1,
        config.getLandscape()?.size ?? DEFAULT_SKETCH_PLANE_SIZE
      );
      if (landscapeSize !== sketchLayer.planeSize) {
        sketchLayer.planeSize = landscapeSize;
        sketchLayer.group.scale.set(landscapeSize, 1, landscapeSize);
      }
      if ((sketch?.ink ?? null) !== loadedInkKey) {
        loadSketchInk(sketch?.ink ?? null);
      }
      if ((sketch?.referenceImage ?? null) !== loadedReferenceKey) {
        loadSketchReference(sketch?.referenceImage ?? null);
      }
      sketchLayer.referenceMaterial.opacity = sketch?.referenceOpacity ?? 0.4;
      currentSketch = sketch;
      updateSketchVisibility();
    }
  };
}
