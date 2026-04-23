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

  function renderOnce(): void {
    syncEnvironmentFromEngine();
    for (const listener of frameListeners) {
      listener();
    }
    renderPipeline?.render();
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
