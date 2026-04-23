/**
 * Surface preview viewport.
 *
 * Studio-owned Surface Library preview panel. This is not a separate render
 * host; it mounts a RenderView on the shared WebRenderEngine so the preview
 * shares the same GPU device, ShaderRuntime, and authored asset resolver as
 * the rest of Studio.
 */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Box, SegmentedControl, Stack, Text } from "@mantine/core";
import type {
  ContentLibrarySnapshot,
  SurfaceDefinition
} from "@sugarmagic/domain";
import { getMaskTextureDefinition } from "@sugarmagic/domain";
import { resolveSurfaceBinding } from "@sugarmagic/runtime-core";
import {
  buildSurfaceScatterLayer,
  createRenderView,
  type RenderView,
  type SurfaceScatterBuildResult,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import {
  createSurfacePreviewGeometry,
  type SurfacePreviewGeometryKind
} from "./surface-preview-samplers";

export interface SurfacePreviewViewportProps {
  engine: WebRenderEngine;
  contentLibrary: ContentLibrarySnapshot | null;
  surfaceDefinition: SurfaceDefinition | null;
  previewGeometryKind: SurfacePreviewGeometryKind;
  activePaintMaskTextureId: string | null;
  onChangePreviewGeometryKind: (kind: SurfacePreviewGeometryKind) => void;
  onReadMaskTexture: (maskTextureId: string) => Promise<ImageData | null>;
  onWriteMaskTexture: (maskTextureId: string, imageData: ImageData) => Promise<void>;
}

const PREVIEW_PAINT_BRUSH_RADIUS = 24;
const PREVIEW_PAINT_BRUSH_STRENGTH = 0.75;

function syncPaintCanvasToPreviewMaskTexture(options: {
  renderView: RenderView | null;
  contentLibrary: ContentLibrarySnapshot | null;
  maskTextureId: string | null;
  canvas: HTMLCanvasElement | null;
}): void {
  const { renderView, contentLibrary, maskTextureId, canvas } = options;
  if (!renderView || !contentLibrary || !maskTextureId || !canvas) {
    return;
  }

  const definition = getMaskTextureDefinition(contentLibrary, maskTextureId);
  if (!definition) {
    return;
  }

  const texture = renderView.assetResolver.resolveMaskTextureDefinition(definition);
  texture.dispose();
  texture.image = canvas;
  texture.needsUpdate = true;
  renderView.markSceneMaterialsDirty();
}

function applyPaintBrushToCanvas(
  canvas: HTMLCanvasElement,
  uv: THREE.Vector2
): void {
  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });
  if (!context) {
    return;
  }

  const x = uv.x * canvas.width;
  const y = (1 - uv.y) * canvas.height;
  const gradient = context.createRadialGradient(
    x,
    y,
    0,
    x,
    y,
    PREVIEW_PAINT_BRUSH_RADIUS
  );
  gradient.addColorStop(0, `rgba(255, 255, 255, ${PREVIEW_PAINT_BRUSH_STRENGTH})`);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  context.save();
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, PREVIEW_PAINT_BRUSH_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function SurfacePreviewViewport({
  engine,
  contentLibrary,
  surfaceDefinition,
  previewGeometryKind,
  activePaintMaskTextureId,
  onChangePreviewGeometryKind,
  onReadMaskTexture,
  onWriteMaskTexture
}: SurfacePreviewViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderViewRef = useRef<RenderView | null>(null);
  const previewRootRef = useRef<THREE.Group | null>(null);
  const scatterBuildsRef = useRef<SurfaceScatterBuildResult[]>([]);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const previewMeshRef = useRef<THREE.Mesh | null>(null);
  const previewCarrierMaterialRef = useRef<THREE.Material | null>(null);
  const previewManagedMaterialRef = useRef<THREE.Material | null>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintPointerIdRef = useRef<number | null>(null);
  const paintDirtyRef = useRef(false);
  const paintWriteInFlightRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());

  const scene = useMemo(() => new THREE.Scene(), []);

  function disposeCurrentPreviewMesh() {
    const previewRoot = previewRootRef.current;
    const previewMesh = previewMeshRef.current;
    if (!previewMesh) {
      return;
    }

    if (previewRoot && previewMesh.parent === previewRoot) {
      previewRoot.remove(previewMesh);
    }

    previewMesh.geometry.dispose();
    if (previewManagedMaterialRef.current && renderViewRef.current) {
      renderViewRef.current.shaderRuntime.releaseMaterial(
        previewManagedMaterialRef.current
      );
    }
    previewCarrierMaterialRef.current?.dispose();

    previewMeshRef.current = null;
    previewCarrierMaterialRef.current = null;
    previewManagedMaterialRef.current = null;
  }

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(4.2, 3.2, 4.2);
    camera.lookAt(0, 0.5, 0);
    cameraRef.current = camera;

    const previewRoot = new THREE.Group();
    previewRoot.name = "surface-library-preview-root";
    previewRootRef.current = previewRoot;
    scene.add(previewRoot);

    const renderView = createRenderView({
      engine,
      scene,
      camera,
      compileProfile: "authoring-preview"
    });
    renderViewRef.current = renderView;

    const element = containerRef.current;
    if (element) {
      renderView.mount(element);
      renderView.startRenderLoop();
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      renderView.resize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer =
      element && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const next = entries[0];
            if (!next || !renderViewRef.current || !cameraRef.current) {
              return;
            }
            const width = next.contentRect.width || 1;
            const height = next.contentRect.height || 1;
            renderViewRef.current.resize(width, height);
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
          })
        : null;
    if (observer && element) {
      observer.observe(element);
    }

    return () => {
      observer?.disconnect();
      for (const build of scatterBuildsRef.current) {
        build.dispose();
      }
      scatterBuildsRef.current = [];
      disposeCurrentPreviewMesh();
      previewRootRef.current?.clear();
      renderView.unmount();
      renderViewRef.current = null;
      previewRootRef.current = null;
      cameraRef.current = null;
    };
  }, [engine, scene]);

  useEffect(() => {
    let cancelled = false;
    if (!activePaintMaskTextureId || !contentLibrary) {
      paintCanvasRef.current = null;
      paintDirtyRef.current = false;
      return;
    }

    const definition = getMaskTextureDefinition(contentLibrary, activePaintMaskTextureId);
    if (!definition) {
      paintCanvasRef.current = null;
      paintDirtyRef.current = false;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = definition.resolution[0];
    canvas.height = definition.resolution[1];
    const context = canvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!context) {
      paintCanvasRef.current = null;
      paintDirtyRef.current = false;
      return;
    }

    void onReadMaskTexture(activePaintMaskTextureId).then((imageData) => {
      if (cancelled) {
        return;
      }
      if (imageData) {
        context.putImageData(imageData, 0, 0);
      } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
      paintCanvasRef.current = canvas;
      paintDirtyRef.current = false;
      syncPaintCanvasToPreviewMaskTexture({
        renderView: renderViewRef.current,
        contentLibrary,
        maskTextureId: activePaintMaskTextureId,
        canvas
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activePaintMaskTextureId, contentLibrary, onReadMaskTexture]);

  useEffect(() => {
    const currentElement = containerRef.current;
    if (!currentElement) {
      return;
    }
    const hostElement = currentElement;

    function paintAtClientPosition(clientX: number, clientY: number): boolean {
      if (!activePaintMaskTextureId || !paintCanvasRef.current) {
        return false;
      }
      const previewMesh = previewMeshRef.current;
      const camera = cameraRef.current;
      if (!previewMesh || !camera) {
        return false;
      }

      const bounds = hostElement.getBoundingClientRect();
      const normalizedX = ((clientX - bounds.left) / bounds.width) * 2 - 1;
      const normalizedY = -(((clientY - bounds.top) / bounds.height) * 2 - 1);
      raycasterRef.current.setFromCamera(
        new THREE.Vector2(normalizedX, normalizedY),
        camera
      );
      const hit = raycasterRef.current.intersectObject(previewMesh, false)[0];
      if (!hit?.uv) {
        return false;
      }

      applyPaintBrushToCanvas(paintCanvasRef.current, hit.uv);
      paintDirtyRef.current = true;
      syncPaintCanvasToPreviewMaskTexture({
        renderView: renderViewRef.current,
        contentLibrary,
        maskTextureId: activePaintMaskTextureId,
        canvas: paintCanvasRef.current
      });
      return true;
    }

    async function commitPaintIfNeeded(maskTextureId: string) {
      if (!paintDirtyRef.current || !paintCanvasRef.current || paintWriteInFlightRef.current) {
        return;
      }
      const context = paintCanvasRef.current.getContext("2d");
      if (!context) {
        return;
      }
      paintWriteInFlightRef.current = true;
      try {
        await onWriteMaskTexture(
          maskTextureId,
          context.getImageData(
            0,
            0,
            paintCanvasRef.current.width,
            paintCanvasRef.current.height
          )
        );
        paintDirtyRef.current = false;
      } finally {
        paintWriteInFlightRef.current = false;
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (!activePaintMaskTextureId) {
        return;
      }
      if (!paintAtClientPosition(event.clientX, event.clientY)) {
        return;
      }
      paintPointerIdRef.current = event.pointerId;
      hostElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handlePointerMove(event: PointerEvent) {
      if (paintPointerIdRef.current !== event.pointerId) {
        return;
      }
      paintAtClientPosition(event.clientX, event.clientY);
    }

    async function finishPointer(event: PointerEvent) {
      if (paintPointerIdRef.current !== event.pointerId) {
        return;
      }
      paintPointerIdRef.current = null;
      if (activePaintMaskTextureId) {
        await commitPaintIfNeeded(activePaintMaskTextureId);
      }
    }

    hostElement.addEventListener("pointerdown", handlePointerDown);
    hostElement.addEventListener("pointermove", handlePointerMove);
    hostElement.addEventListener("pointerup", finishPointer);
    hostElement.addEventListener("pointercancel", finishPointer);
    return () => {
      hostElement.removeEventListener("pointerdown", handlePointerDown);
      hostElement.removeEventListener("pointermove", handlePointerMove);
      hostElement.removeEventListener("pointerup", finishPointer);
      hostElement.removeEventListener("pointercancel", finishPointer);
    };
  }, [activePaintMaskTextureId, contentLibrary, onWriteMaskTexture]);

  useEffect(() => {
    const renderView = renderViewRef.current;
    const previewRoot = previewRootRef.current;
    const camera = cameraRef.current;
    if (!renderView || !previewRoot || !camera) {
      return;
    }

    for (const build of scatterBuildsRef.current) {
      previewRoot.remove(build.root);
      build.dispose();
    }
    scatterBuildsRef.current = [];
    disposeCurrentPreviewMesh();

    if (!contentLibrary || !surfaceDefinition) {
      return;
    }

    const resolvedSurface = resolveSurfaceBinding(
      { kind: "reference", surfaceDefinitionId: surfaceDefinition.definitionId },
      contentLibrary,
      surfaceDefinition.surface.context
    );
    if (!resolvedSurface.ok) {
      console.error("[surface-preview] failed to resolve surface", {
        surfaceDefinitionId: surfaceDefinition.definitionId,
        diagnostic: resolvedSurface.diagnostic
      });
      return;
    }

    const spec = createSurfacePreviewGeometry(previewGeometryKind);
    const carrierMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0
    });
    const appliedMaterial = renderView.shaderRuntime.applyShaderSet(
      {
        surface: resolvedSurface.binding,
        deform: null,
        effect: null
      },
      {
        material: carrierMaterial,
        geometry: spec.mesh.geometry,
        fileSources: engine.getAssetSources()
      }
    );
    spec.mesh.material = appliedMaterial;
    spec.mesh.castShadow = true;
    spec.mesh.receiveShadow = true;
    previewRoot.add(spec.mesh);
    previewMeshRef.current = spec.mesh;
    previewCarrierMaterialRef.current = carrierMaterial;
    previewManagedMaterialRef.current = appliedMaterial;

    for (const layer of resolvedSurface.binding.layers) {
      if (layer.kind !== "scatter") {
        continue;
      }
      const build = buildSurfaceScatterLayer(
        layer,
        spec.scatterSamplesForDensity(layer.density),
        {
          contentLibrary,
          assetResolver: renderView.assetResolver,
          shaderRuntime: renderView.shaderRuntime,
          logger: engine.logger
        }
      );
      previewRoot.add(build.root);
      scatterBuildsRef.current.push(build);
    }

    camera.position.set(
      previewGeometryKind === "plane" ? 4.8 : 4.2,
      previewGeometryKind === "plane" ? 3.4 : 3.1,
      4.8
    );
    camera.lookAt(0, previewGeometryKind === "plane" ? 0 : 0.25, 0);
    camera.updateProjectionMatrix();
  }, [contentLibrary, engine, previewGeometryKind, surfaceDefinition]);

  return (
    <Stack h="100%" gap="sm" p="md">
      <SegmentedControl
        fullWidth
        value={previewGeometryKind}
        data={[
          { value: "plane", label: "Plane" },
          { value: "cube", label: "Cube" },
          { value: "sphere", label: "Sphere" }
        ]}
        onChange={(next) =>
          onChangePreviewGeometryKind(next as SurfacePreviewGeometryKind)
        }
      />
      <Box
        style={{
          position: "relative",
          flex: 1,
          minHeight: 320,
          borderRadius: "var(--mantine-radius-md)",
          overflow: "hidden",
          background: "var(--sm-color-base)"
        }}
      >
        <Box
          ref={containerRef}
          style={{ position: "absolute", inset: 0 }}
        />
        {activePaintMaskTextureId ? (
          <Text
            size="xs"
            c="var(--sm-color-subtext)"
            style={{
              position: "absolute",
              top: 10,
              left: 12,
              padding: "4px 8px",
              borderRadius: 999,
              background: "rgba(0, 0, 0, 0.45)",
              pointerEvents: "none"
            }}
          >
            Paint mode active: click and drag on the preview.
          </Text>
        ) : null}
        {!surfaceDefinition ? (
          <Stack
            align="center"
            justify="center"
            h="100%"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <Text size="sm" c="var(--sm-color-overlay0)">
              Select a surface to preview it.
            </Text>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}
