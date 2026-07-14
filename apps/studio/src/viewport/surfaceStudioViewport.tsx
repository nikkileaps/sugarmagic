/**
 * Surface Studio viewport (Plan 068.10b).
 *
 * A focused preview of ONE placed asset -- not the whole scene. Mounts
 * its own RenderView on the shared WebRenderEngine (same GPU device,
 * ShaderRuntime, asset resolver as the rest of Studio), loads just the
 * selected asset's GLB, and applies its resolved surface (including the
 * Studio's live layer edits). Orbit controls let you spin the asset.
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
  type AuthoringSession
} from "@sugarmagic/domain";
import { resolveSceneObjects } from "@sugarmagic/runtime-core";
import {
  createRenderView,
  createRenderableShaderApplicationState,
  ensureShaderSetAppliedToRenderable,
  type RenderView,
  type WebRenderEngine
} from "@sugarmagic/render-web";
import { createItemCameraController } from "@sugarmagic/workspaces";

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
}

export function SurfaceStudioViewport({
  engine,
  session,
  target
}: SurfaceStudioViewportProps) {
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

  // Lifecycle: scene, camera, lights, render view, orbit controls.
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
    if (element) {
      renderView.mount(element);
      renderView.startRenderLoop();
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      renderView.resize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      cameraController.attach(camera, element, renderView.subscribeFrame, 0.4);
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
        // Same asset: just re-apply the (possibly edited) surface.
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
      scene!.add(modelRoot);
      modelRootRef.current = modelRoot;
      loadedInstanceRef.current = target!.instanceId;

      // Frame the camera on the asset's bounds.
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

  return <Box ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
