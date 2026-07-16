/**
 * Surface Studio viewport (Plan 068.10b).
 *
 * A focused preview of ONE placed asset -- not the whole scene. Mounts
 * its own RenderView on the shared WebRenderEngine (same GPU device,
 * ShaderRuntime, asset resolver as the rest of Studio), loads just the
 * selected asset's GLB, and applies its resolved surface (including the
 * Studio's live layer edits). Orbit controls spin the asset.
 *
 * Painting (068.10b): when a layer's painted mask is armed
 * (`maskPaintTarget`), left-drag paints that mask on the asset via the
 * shared world-space projection brush -- live-updating the Studio's own
 * material and persisting on release. Orbit is suppressed while painting
 * (capture-phase) and resumes when nothing is armed.
 *
 * While the Studio is open the main scene viewport is unmounted, so only
 * this one render loop runs.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Box } from "@mantine/core";
import {
  getActiveRegion,
  getActiveScene,
  getMaskTextureDefinition,
  type AuthoringSession
} from "@sugarmagic/domain";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";
import {
  createRenderView,
  createRenderableShaderApplicationState,
  ensureShaderSetAppliedToRenderable,
  registerLivePaintedMask,
  type RenderView,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import { createItemCameraController } from "@sugarmagic/workspaces";
import {
  createPaintBrushRing,
  stampWorldSpaceBrush,
  type ProjectionBrushSettings
} from "./overlays/projection-paint";

const gltfLoader = new GLTFLoader();

export interface SurfaceStudioViewportTarget {
  instanceId: string;
  assetDefinitionId: string;
  slotName: string;
}

export interface SurfaceStudioViewportProps {
  engine: WebRenderEngine;
  session: AuthoringSession | null;
  target: SurfaceStudioViewportTarget | null;
  /** The selected layer's painted-mask texture id, or null. When set,
   *  left-drag paints it (the always-on Studio brush, Plan 068.10b). */
  paintMaskId: string | null;
  brushSettings: ProjectionBrushSettings;
  readMaskTexture: (maskTextureId: string) => Promise<ImageData | null>;
  writeMaskTexture: (maskTextureId: string, imageData: ImageData) => Promise<void>;
  /** Reports the loaded asset's paint-UV triangles (flattened
   *  [u0,v0,u1,v1,u2,v2, ...]) for the UV panel wireframe (Plan
   *  068.10c). Null when the asset has no paint UVs. */
  onPaintUvTriangles?: (triangles: number[] | null) => void;
  /** Live in-memory pixels of a painted mask (kept current on every
   *  commit, Layout or Studio). Preferred over the disk read so the
   *  paint canvas always starts from the CURRENT mask -- painting is
   *  additive and never wipes existing coverage (Plan 068). */
  getMaskPreviewCanvas: (maskTextureId: string) => HTMLCanvasElement | null;
}

export function SurfaceStudioViewport({
  engine,
  session,
  target,
  paintMaskId,
  brushSettings,
  readMaskTexture,
  writeMaskTexture,
  getMaskPreviewCanvas,
  onPaintUvTriangles
}: SurfaceStudioViewportProps) {
  const onPaintUvTrianglesRef = useRef(onPaintUvTriangles);
  onPaintUvTrianglesRef.current = onPaintUvTriangles;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderViewRef = useRef<RenderView | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraControllerRef = useRef<ReturnType<
    typeof createItemCameraController
  > | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const loadedInstanceRef = useRef<string | null>(null);
  const shaderApplicationRef = useRef(createRenderableShaderApplicationState());

  // Paint state (read by pointer handlers attached once at mount).
  const sessionRef = useRef(session);
  const brushSettingsRef = useRef(brushSettings);
  const writeMaskRef = useRef(writeMaskTexture);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeMaskIdRef = useRef<string | null>(null);
  const paintingRef = useRef(false);
  const paintDirtyRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());

  sessionRef.current = session;
  brushSettingsRef.current = brushSettings;
  writeMaskRef.current = writeMaskTexture;

  // Lifecycle: scene, camera, lights, render view, orbit, paint handlers.
  useEffect(() => {
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(1.6, 1.2, 2.2);
    camera.lookAt(0, 0.4, 0);
    cameraRef.current = camera;

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 0.9);
    keyLight.position.set(4, 6, 3);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb0c8ff, 0.3);
    fillLight.position.set(-3, 2.5, -2);
    scene.add(fillLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const brushRing = createPaintBrushRing(0xf9e2af);
    scene.add(brushRing);

    const renderView = createRenderView({
      engine,
      scene,
      camera,
      compileProfile: "authoring-preview"
    });
    renderViewRef.current = renderView;

    const cameraController = createItemCameraController();
    cameraControllerRef.current = cameraController;

    const element = containerRef.current;

    function updateMaskTextureLive(maskId: string, canvas: HTMLCanvasElement) {
      const renderViewNow = renderViewRef.current;
      const sessionNow = sessionRef.current;
      if (!renderViewNow || !sessionNow) {
        return;
      }
      const definition = getMaskTextureDefinition(
        sessionNow.contentLibrary,
        maskId
      );
      if (!definition) {
        return;
      }
      const texture = renderViewNow.assetResolver.resolveMaskTextureDefinition(
        definition
      );
      texture.dispose();
      texture.image = canvas;
      texture.needsUpdate = true;
      renderViewNow.markSceneMaterialsDirty();
      // CPU scatter placement samples the live painted-mask registry
      // first, so the Studio must push its pixels there too -- otherwise
      // the scene's grass rebuilds from the stale Layout snapshot on
      // close and the Studio painting doesn't show (Plan 068).
      registerLivePaintedMask(maskId, canvas);
    }

    function raycastStudioHit(
      clientX: number,
      clientY: number
    ): THREE.Intersection<THREE.Object3D> | null {
      const camera2 = cameraRef.current;
      const modelRoot = modelRootRef.current;
      if (!camera2 || !modelRoot || !element) {
        return null;
      }
      const bounds = element.getBoundingClientRect();
      pointerRef.current.x =
        ((clientX - bounds.left) / bounds.width) * 2 - 1;
      pointerRef.current.y =
        -(((clientY - bounds.top) / bounds.height) * 2 - 1);
      raycasterRef.current.setFromCamera(pointerRef.current, camera2);
      const hits = raycasterRef.current.intersectObject(modelRoot, true);
      // Single focused asset -- take the nearest hit that carries a paint
      // UV. (Slot matching is unnecessary here; multi-slot atlases share
      // uv1, refine later if a slot needs isolating.)
      for (const hit of hits) {
        if (!(hit.object instanceof THREE.Mesh)) {
          continue;
        }
        const geometry = hit.object.geometry;
        if (
          geometry instanceof THREE.BufferGeometry &&
          (geometry.getAttribute("uv1") || geometry.getAttribute("uv"))
        ) {
          return hit;
        }
      }
      return null;
    }

    function paintAt(clientX: number, clientY: number): boolean {
      const canvas = paintCanvasRef.current;
      const maskId = activeMaskIdRef.current;
      if (!canvas || !maskId) {
        return false;
      }
      const hit = raycastStudioHit(clientX, clientY);
      if (!hit) {
        return false;
      }
      stampWorldSpaceBrush(canvas, hit, brushSettingsRef.current);
      updateMaskTextureLive(maskId, canvas);
      paintDirtyRef.current = true;
      return true;
    }

    function updateBrushRing(clientX: number, clientY: number) {
      if (!activeMaskIdRef.current) {
        brushRing.visible = false;
        return;
      }
      const hit = raycastStudioHit(clientX, clientY);
      if (!hit) {
        brushRing.visible = false;
        return;
      }
      const worldNormal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      brushRing.visible = true;
      brushRing.position.copy(hit.point).addScaledVector(worldNormal, 0.02);
      brushRing.lookAt(hit.point.clone().add(worldNormal));
      brushRing.scale.setScalar(Math.max(0.03, brushSettingsRef.current.radius));
    }

    async function commitPaint() {
      const canvas = paintCanvasRef.current;
      const maskId = activeMaskIdRef.current;
      if (!paintDirtyRef.current || !canvas || !maskId) {
        return;
      }
      const context2d = canvas.getContext("2d");
      if (!context2d) {
        return;
      }
      paintDirtyRef.current = false;
      await writeMaskRef.current(
        maskId,
        context2d.getImageData(0, 0, canvas.width, canvas.height)
      );
    }

    // Capture phase so a paint stroke can suppress OrbitControls' rotate.
    function onPointerDownCapture(event: PointerEvent) {
      if (event.button !== 0 || !activeMaskIdRef.current) {
        return;
      }
      if (paintAt(event.clientX, event.clientY)) {
        paintingRef.current = true;
        event.stopPropagation();
        event.preventDefault();
        element?.setPointerCapture(event.pointerId);
      }
    }
    function onPointerMove(event: PointerEvent) {
      if (paintingRef.current) {
        paintAt(event.clientX, event.clientY);
      }
      updateBrushRing(event.clientX, event.clientY);
    }
    function onPointerUp() {
      if (paintingRef.current) {
        paintingRef.current = false;
        void commitPaint();
      }
    }
    function onPointerLeave() {
      brushRing.visible = false;
    }

    if (element) {
      renderView.mount(element);
      renderView.startRenderLoop();
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      renderView.resize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Generous zoom range so large assets (e.g. the outcrop) can be
      // framed and pulled back far enough; the default item range (max 8)
      // is too tight for arbitrary meshes.
      cameraController.attach(camera, element, renderView.subscribeFrame, 0.4, {
        min: 0.05,
        max: 2000
      });
      element.addEventListener("pointerdown", onPointerDownCapture, true);
      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerup", onPointerUp);
      element.addEventListener("pointercancel", onPointerUp);
      element.addEventListener("pointerleave", onPointerLeave);
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
      if (element) {
        element.removeEventListener("pointerdown", onPointerDownCapture, true);
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerup", onPointerUp);
        element.removeEventListener("pointercancel", onPointerUp);
        element.removeEventListener("pointerleave", onPointerLeave);
      }
      scene.remove(brushRing);
      brushRing.geometry.dispose();
      (brushRing.material as THREE.Material).dispose();
      cameraController.detach();
      if (modelRootRef.current) {
        scene.remove(modelRootRef.current);
        modelRootRef.current = null;
      }
      renderView.unmount();
      renderViewRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      cameraControllerRef.current = null;
      loadedInstanceRef.current = null;
    };
  }, [engine]);

  // Load the asset + apply the (edited) surface. The GLB reloads only
  // when the target instance changes; the surface re-applies on every
  // session change so Studio layer edits show live.
  useEffect(() => {
    const renderView = renderViewRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderView || !scene || !camera || !session || !target) {
      return;
    }
    const region = getActiveRegion(session);
    if (!region) {
      return;
    }
    const sceneObjects = resolveSceneObjects(region, {
      contentLibrary: session.contentLibrary,
      activeScene: getActiveScene(session)
    });
    const sceneObject = sceneObjects.find(
      (candidate) => candidate.instanceId === target.instanceId
    );
    if (!sceneObject) {
      return;
    }

    let cancelled = false;

    async function ensureModel() {
      if (
        loadedInstanceRef.current === target!.instanceId &&
        modelRootRef.current
      ) {
        ensureShaderSetAppliedToRenderable(
          modelRootRef.current,
          sceneObject!,
          engine.shaderRuntime,
          shaderApplicationRef.current,
          engine.getAssetSources()
        );
        return;
      }

      if (modelRootRef.current) {
        scene!.remove(modelRootRef.current);
        modelRootRef.current = null;
      }

      const path = sceneObject!.modelSourcePath;
      const url = path ? renderView!.assetResolver.resolveAssetUrl(path) : null;
      if (!url) {
        return;
      }
      const gltf = await gltfLoader.loadAsync(url);
      if (cancelled) {
        return;
      }
      const modelRoot = gltf.scene.clone(true);
      // Apply the instance's placed transform so the Studio matches the
      // Layout in WORLD space -- world-position masks (Height / Gradient)
      // and world-XZ effects ramp identically instead of over the
      // unscaled GLB at the origin (Plan 068.10).
      const transform = sceneObject!.transform;
      modelRoot.position.set(
        transform.position[0],
        transform.position[1],
        transform.position[2]
      );
      modelRoot.rotation.set(
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2]
      );
      modelRoot.scale.set(
        transform.scale[0],
        transform.scale[1],
        transform.scale[2]
      );
      modelRoot.updateMatrixWorld(true);
      scene!.add(modelRoot);
      modelRootRef.current = modelRoot;
      loadedInstanceRef.current = target!.instanceId;

      // Extract paint-UV (uv1) triangles for the UV panel wireframe.
      const triangles: number[] = [];
      modelRoot.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }
        const geometry = child.geometry;
        const uv = geometry.getAttribute("uv1");
        if (!uv) {
          return;
        }
        const index = geometry.index;
        const triangleCount = index ? index.count / 3 : uv.count / 3;
        for (let t = 0; t < triangleCount; t += 1) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          triangles.push(
            uv.getX(ia),
            uv.getY(ia),
            uv.getX(ib),
            uv.getY(ib),
            uv.getX(ic),
            uv.getY(ic)
          );
        }
      });
      onPaintUvTrianglesRef.current?.(triangles.length > 0 ? triangles : null);

      const box = new THREE.Box3().setFromObject(modelRoot);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 0.1);
      camera!.position.set(
        center.x + radius * 1.6,
        center.y + radius * 1.2,
        center.z + radius * 2.0
      );
      camera!.lookAt(center);
      camera!.updateProjectionMatrix();
      cameraControllerRef.current?.updateTarget(center.y);

      shaderApplicationRef.current = createRenderableShaderApplicationState();
      ensureShaderSetAppliedToRenderable(
        modelRoot,
        sceneObject!,
        engine.shaderRuntime,
        shaderApplicationRef.current,
        engine.getAssetSources()
      );
    }

    void ensureModel();
    return () => {
      cancelled = true;
    };
  }, [engine, session, target]);

  // Load the selected layer's mask into a paint canvas (or clear when
  // the selected layer has no painted mask).
  useEffect(() => {
    let cancelled = false;
    const maskId = paintMaskId;
    if (!maskId) {
      paintCanvasRef.current = null;
      activeMaskIdRef.current = null;
      return;
    }
    void (async () => {
      const definition = session
        ? getMaskTextureDefinition(session.contentLibrary, maskId)
        : null;
      const [width, height] = definition?.resolution ?? [512, 512];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context2d = canvas.getContext("2d", { willReadFrequently: true });
      if (!context2d) {
        return;
      }
      // Prefer the LIVE preview canvas (what the scene currently shows)
      // over the disk read, so the paint canvas starts from the current
      // mask and painting stays additive. Fall back to disk only when the
      // preview isn't cached yet.
      const previewCanvas = getMaskPreviewCanvas(maskId);
      if (
        previewCanvas &&
        previewCanvas.width > 0 &&
        previewCanvas.height > 0
      ) {
        canvas.width = previewCanvas.width;
        canvas.height = previewCanvas.height;
        context2d.drawImage(previewCanvas, 0, 0);
        paintCanvasRef.current = canvas;
        activeMaskIdRef.current = maskId;
        return;
      }
      const imageData = await readMaskTexture(maskId);
      if (cancelled) {
        return;
      }
      if (imageData) {
        context2d.putImageData(imageData, 0, 0);
      } else {
        context2d.clearRect(0, 0, width, height);
      }
      paintCanvasRef.current = canvas;
      activeMaskIdRef.current = maskId;
    })();
    return () => {
      cancelled = true;
    };
  }, [session, paintMaskId, readMaskTexture, getMaskPreviewCanvas]);

  return <Box ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
