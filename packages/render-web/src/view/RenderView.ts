/**
 * RenderView
 *
 * Per-render-surface WebGPU view bound to a shared WebRenderEngine. It owns
 * scene-local resources (scene, camera, DOM/canvas, render pipeline,
 * environment/landscape controllers, render loop), while all expensive shared
 * caches and authored-state setters live on the engine.
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core";
import { applyPostProcessStack } from "../environment/applyPostProcessStack";
import { createEnvironmentSceneController, type EnvironmentSceneController } from "../environment/EnvironmentSceneController";
import { createLandscapeSceneController, type LandscapeSceneController } from "../landscape";
import { createRuntimeRenderPipeline, type RuntimeRenderPipeline } from "../render/RuntimeRenderPipeline";
import type { AuthoredAssetResolver } from "../authoredAssetResolver";
import type { ShaderRuntime } from "../ShaderRuntime";
import type { WebRenderEngine, WebRenderEnvironmentState, WebRenderLogger } from "../engine/WebRenderEngine";

export interface RenderViewOptions {
  engine: WebRenderEngine;
  scene: THREE.Scene;
  camera: THREE.Camera;
  compileProfile: RuntimeCompileProfile;
  logger?: WebRenderLogger;
}

export interface RenderView {
  readonly renderer: WebGPURenderer | null;
  readonly renderPipeline: RuntimeRenderPipeline | null;
  readonly shaderRuntime: ShaderRuntime;
  readonly assetResolver: AuthoredAssetResolver;
  readonly environmentController: EnvironmentSceneController;
  readonly landscapeController: LandscapeSceneController;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  mount(element: HTMLElement): void;
  unmount(): void;
  render(): void;
  startRenderLoop(): void;
  resize(width: number, height: number): void;
  setCamera(camera: THREE.Camera): void;
  subscribeFrame(listener: () => void): () => void;
  enableShadowsOnObject(root: THREE.Object3D): void;
  requestEngineStateSync(): void;
  markSceneMaterialsDirty(): void;
}

function configureRenderer(next: WebGPURenderer): void {
  next.shadowMap.enabled = true;
  next.shadowMap.type = THREE.PCFSoftShadowMap;
  next.toneMapping = THREE.ACESFilmicToneMapping;
  next.toneMappingExposure = 1;
  next.outputColorSpace = THREE.SRGBColorSpace;
  // TEMP DEBUG: enable WebGPU timestamp queries so renderer.info.render.timestamp
  // and renderer.info.compute.timestamp report real GPU time per frame.
  const backend = (next as unknown as { backend?: { trackTimestamp?: boolean } }).backend;
  if (backend) {
    backend.trackTimestamp = true;
  }
}

export function createRenderView(options: RenderViewOptions): RenderView {
  const { engine, scene, compileProfile } = options;
  const logger = options.logger ?? engine.logger;
  const environmentController = createEnvironmentSceneController(scene);
  const landscapeController = createLandscapeSceneController(
    scene,
    engine.assetResolver,
    () => engine.shaderRuntime
  );

  const frameListeners = new Set<() => void>();
  let activeCamera = options.camera;
  let renderer: WebGPURenderer | null = null;
  let renderPipeline: RuntimeRenderPipeline | null = null;
  let container: HTMLElement | null = null;
  let mountGeneration = 0;
  let animationId: number | null = null;
  let loopRunning = false;
  let attachedToEngine = false;
  let appliedEnvironmentVersion = -1;

  function markSceneMaterialsDirty(): void {
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          material.needsUpdate = true;
        }
        return;
      }
      if (child.material) {
        child.material.needsUpdate = true;
      }
    });
  }

  function applyEnvironmentState(state: WebRenderEnvironmentState): void {
    if (!renderPipeline) {
      return;
    }

    environmentController.applyResolved(state.resolved.definition);
    renderPipeline.applyEnvironment(state.resolved.definition);
    applyPostProcessStack({
      shaderRuntime: engine.shaderRuntime,
      renderPipeline,
      contentLibrary: state.contentLibrary,
      chain: state.resolved.effectivePostProcessChain
    });
    markSceneMaterialsDirty();
    appliedEnvironmentVersion = state.version;
  }

  function syncEnvironmentFromEngine(): void {
    const state = engine.getEnvironmentState();
    if (!renderPipeline || appliedEnvironmentVersion === state.version) {
      return;
    }
    applyEnvironmentState(state);
  }

  // TEMP DEBUG: per-frame timing breakdown.
  // CPU: performance.now() around sync / listeners / render call.
  // GPU: WebGPU timestamp queries — drained each frame via
  // renderer.resolveTimestampsAsync; renderer.info.render.timestamp /
  // .compute.timestamp expose the resolved per-frame GPU ms.
  // info.render.calls is cumulative across the renderer's lifetime, so we
  // sample by delta between frames; info.render.triangles is per-frame.
  const frameTimings = {
    cpuSync: 0,
    cpuListeners: 0,
    cpuRenderCall: 0,
    gpuRender: 0,
    gpuCompute: 0,
    total: 0,
    drawCalls: 0,
    triangles: 0,
    samples: 0,
    lastCallsCumulative: 0
  };
  let timestampResolveInFlight = false;

  function renderOnce(): void {
    const t0 = performance.now();
    syncEnvironmentFromEngine();
    const t1 = performance.now();
    for (const listener of frameListeners) {
      listener();
    }
    const t2 = performance.now();
    renderPipeline?.render();
    const t3 = performance.now();

    frameTimings.cpuSync += t1 - t0;
    frameTimings.cpuListeners += t2 - t1;
    frameTimings.cpuRenderCall += t3 - t2;
    frameTimings.total += t3 - t0;

    if (renderer) {
      const rendererAny = renderer as unknown as {
        info: {
          render: { timestamp?: number; calls?: number; triangles?: number };
          compute: { timestamp?: number };
        };
        resolveTimestampsAsync?: (type?: unknown) => Promise<unknown>;
      };
      const info = rendererAny.info;
      frameTimings.gpuRender += info.render.timestamp ?? 0;
      frameTimings.gpuCompute += info.compute.timestamp ?? 0;
      const callsNow = info.render.calls ?? 0;
      const callsDelta = Math.max(0, callsNow - frameTimings.lastCallsCumulative);
      frameTimings.lastCallsCumulative = callsNow;
      frameTimings.drawCalls += callsDelta;
      frameTimings.triangles += info.render.triangles ?? 0;

      // Drain BOTH timestamp queues — render and compute have separate
      // pools in three's WebGPU backend. resolveTimestampsAsync defaults
      // to 'render' only; compute scatter dispatches multiple compute
      // passes per frame and saturates the compute pool quickly if not
      // drained too. Fire-and-forget; flight flag avoids stacking.
      if (rendererAny.resolveTimestampsAsync && !timestampResolveInFlight) {
        timestampResolveInFlight = true;
        Promise.all([
          rendererAny.resolveTimestampsAsync("render").catch(() => undefined),
          rendererAny.resolveTimestampsAsync("compute").catch(() => undefined)
        ]).finally(() => {
          timestampResolveInFlight = false;
        });
      }
    }
    frameTimings.samples += 1;

    if (frameTimings.samples >= 60) {
      const n = frameTimings.samples;
      // TEMP DEBUG: scene census so we can correlate cpuRender cost with
      // how many objects three has to walk through render lists each frame.
      let sceneObjectCount = 0;
      let sceneMeshCount = 0;
      let sceneVisibleMeshCount = 0;
      let sceneLightCount = 0;
      scene.traverse((obj) => {
        sceneObjectCount += 1;
        if ((obj as THREE.Mesh).isMesh) {
          sceneMeshCount += 1;
          if (obj.visible) sceneVisibleMeshCount += 1;
        }
        if ((obj as THREE.Light).isLight) sceneLightCount += 1;
      });
      // eslint-disable-next-line no-console
      console.log(
        "[scene-census]",
        `objects=${sceneObjectCount}`,
        `meshes=${sceneMeshCount}`,
        `visibleMeshes=${sceneVisibleMeshCount}`,
        `lights=${sceneLightCount}`,
        `topLevelChildren=${scene.children.length}`
      );
      // eslint-disable-next-line no-console
      console.log(
        "[render-timing] 60-frame avg:",
        `total=${(frameTimings.total / n).toFixed(2)}ms`,
        `cpuRender=${(frameTimings.cpuRenderCall / n).toFixed(2)}ms`,
        `gpuRender=${(frameTimings.gpuRender / n).toFixed(2)}ms`,
        `gpuCompute=${(frameTimings.gpuCompute / n).toFixed(2)}ms`,
        `cpuSync=${(frameTimings.cpuSync / n).toFixed(2)}ms`,
        `cpuListeners=${(frameTimings.cpuListeners / n).toFixed(2)}ms`,
        `calls/frame=${(frameTimings.drawCalls / n).toFixed(0)}`,
        `tris/frame=${(frameTimings.triangles / n).toFixed(0)}`
      );
      frameTimings.cpuSync = 0;
      frameTimings.cpuListeners = 0;
      frameTimings.cpuRenderCall = 0;
      frameTimings.gpuRender = 0;
      frameTimings.gpuCompute = 0;
      frameTimings.total = 0;
      frameTimings.drawCalls = 0;
      frameTimings.triangles = 0;
      frameTimings.samples = 0;
    }
  }

  function renderLoopTick(): void {
    renderOnce();
    if (loopRunning) {
      animationId = requestAnimationFrame(renderLoopTick);
    }
  }

  function attachToEngine(): void {
    if (attachedToEngine) {
      return;
    }
    engine.attachView(view);
    attachedToEngine = true;
  }

  function detachFromEngine(): void {
    if (!attachedToEngine) {
      return;
    }
    engine.detachView(view);
    attachedToEngine = false;
  }

  const view: RenderView = {
    get renderer() {
      return renderer;
    },
    get renderPipeline() {
      return renderPipeline;
    },
    get shaderRuntime() {
      return engine.shaderRuntime;
    },
    get assetResolver() {
      return engine.assetResolver;
    },
    environmentController,
    landscapeController,
    scene,
    get camera() {
      return activeCamera;
    },
    mount(element: HTMLElement) {
      container = element;
      const generation = ++mountGeneration;
      attachToEngine();

      void engine.ensureDevice()
        .then(async (device) => {
          if (mountGeneration !== generation || container !== element) {
            return;
          }

          const nextRenderer = new WebGPURenderer({
            antialias: true,
            device
          });
          configureRenderer(nextRenderer);
          nextRenderer.domElement.style.display = "block";
          nextRenderer.domElement.style.width = "100%";
          nextRenderer.domElement.style.height = "100%";
          element.appendChild(nextRenderer.domElement);
          renderer = nextRenderer;

          await nextRenderer.init();
          if (mountGeneration !== generation || container !== element || renderer !== nextRenderer) {
            nextRenderer.dispose();
            if (nextRenderer.domElement.parentElement === element) {
              element.removeChild(nextRenderer.domElement);
            }
            return;
          }

          nextRenderer.setPixelRatio(window.devicePixelRatio);
          const width = element.clientWidth || 1;
          const height = element.clientHeight || 1;
          nextRenderer.setSize(width, height, false);

          renderPipeline = createRuntimeRenderPipeline({
            renderer: nextRenderer,
            scene,
            camera: activeCamera,
            width,
            height
          });
          appliedEnvironmentVersion = -1;
          syncEnvironmentFromEngine();
        })
        .catch((error) => {
          logger.warn("RenderView renderer init failed.", {
            compileProfile,
            error: String(error)
          });
        });
    },
    unmount() {
      mountGeneration += 1;
      loopRunning = false;

      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      detachFromEngine();
      landscapeController.dispose();
      environmentController.dispose();
      renderPipeline?.dispose();
      renderPipeline = null;
      appliedEnvironmentVersion = -1;
      frameListeners.clear();

      if (renderer && container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
      container = null;
    },
    render() {
      renderOnce();
    },
    startRenderLoop() {
      if (loopRunning) {
        return;
      }
      loopRunning = true;
      animationId = requestAnimationFrame(renderLoopTick);
    },
    resize(width, height) {
      renderer?.setSize(width, height, false);
      renderPipeline?.resize(width, height);
    },
    setCamera(camera) {
      // Identity check: runtime hosts call setCamera every frame with the same
      // camera reference (its transform changes, not the object). Re-running
      // requestEngineStateSync here forces applyEnvironmentState every frame,
      // which rebuilds the post-process TSL graph and dirties every material —
      // ~19ms of CPU per frame on an otherwise empty scene.
      if (camera === activeCamera) return;
      activeCamera = camera;
      renderPipeline?.setCamera(camera);
      view.requestEngineStateSync();
    },
    subscribeFrame(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    enableShadowsOnObject(root) {
      root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    },
    requestEngineStateSync() {
      appliedEnvironmentVersion = -1;
    },
    markSceneMaterialsDirty
  };

  return view;
}
