/**
 * WebRenderHost
 *
 * Single shared host for the WebGPU rendering pipeline. Studio and the
 * published web runtime both consume this instead of duplicating renderer
 * setup, pipeline lifecycle, ShaderRuntime lifecycle, environment/landscape
 * controller composition, and the render loop.
 *
 * Rationale: previously, apps/studio/src/viewport/authoringViewport.ts and
 * targets/web/src/runtimeHost.ts each hand-built the full rendering stack.
 * Every fix (shadow maps, tonemap, post-process timing, shader-runtime
 * lifecycle) had to land in both files and they kept drifting, producing
 * "works in one host, not the other" bugs like fog rendering in the game
 * preview but not the editor viewport. This host consolidates everything
 * rendering-pipeline-shaped into a single code path so the two callers
 * cannot diverge again.
 *
 * Scope. The host owns the rendering *pipeline*, not the scene. Callers
 * provide the scene (and compose their own roots, grids, overlays), decide
 * camera strategy, load assets, and run gameplay logic. The host handles
 * renderer config, pipeline construction, shader runtime, environment +
 * landscape scene controllers, post-process stack application, and the
 * render loop.
 */

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import type {
  ContentLibrarySnapshot,
  RegionDocument
} from "@sugarmagic/domain";
import type { RuntimeCompileProfile } from "@sugarmagic/runtime-core";
import {
  createLandscapeSceneController,
  resolveEnvironmentWithPostProcessChain,
  type LandscapeSceneController
} from "@sugarmagic/runtime-core";
import {
  createEnvironmentSceneController,
  type EnvironmentSceneController
} from "../environment/EnvironmentSceneController";
import { applyPostProcessStack } from "../environment/applyPostProcessStack";
import { createRuntimeRenderPipeline, type RuntimeRenderPipeline } from "../render/RuntimeRenderPipeline";
import { ShaderRuntime } from "../ShaderRuntime";

export interface WebRenderHostLogger {
  warn: (message: string, payload?: Record<string, unknown>) => void;
}

export interface WebRenderHostOptions {
  /**
   * Scene the host will render. The host does not add or remove objects from
   * this scene directly — the caller is responsible for composition. The host
   * does, however, add lights, sky mesh, and landscape geometry via its
   * owned controllers.
   */
  scene: THREE.Scene;
  /**
   * Initial camera. Can be swapped later via setCamera (e.g. Studio's
   * orthographic-top toggle).
   */
  camera: THREE.Camera;
  /**
   * Shader compile profile — "authoring-preview" for Studio, whatever the
   * runtime host configures for published builds.
   */
  compileProfile: RuntimeCompileProfile;
  /**
   * Optional logger for shader runtime warnings. Defaults to silent.
   */
  logger?: WebRenderHostLogger;
}

export interface WebRenderHost {
  readonly renderer: WebGPURenderer | null;
  readonly renderPipeline: RuntimeRenderPipeline | null;
  readonly shaderRuntime: ShaderRuntime | null;
  readonly environmentController: EnvironmentSceneController;
  readonly landscapeController: LandscapeSceneController;

  /**
   * Mount to a DOM element. Creates the renderer, kicks off async
   * initialization, and once init resolves creates the render pipeline and
   * runs any pending environment apply. Safe to call applyEnvironment before
   * mount or before init completes — the host queues the latest state and
   * applies it when ready.
   */
  mount(element: HTMLElement): void;

  /**
   * Unmount and dispose everything the host owns. The scene itself is NOT
   * disposed — the caller owns it.
   */
  unmount(): void;

  /**
   * Render one frame. Fires frame listeners then draws via the pipeline.
   * Callers are responsible for driving this — either by starting the
   * built-in render loop (startRenderLoop) or by calling render() directly
   * from their own loop. The host does NOT auto-start a loop, because hosts
   * like the published runtime already run their own loop for gameplay and
   * a second internal loop would produce double-renders.
   */
  render(): void;

  /**
   * Start a requestAnimationFrame-driven render loop. Useful for callers
   * that don't have their own loop (e.g. Studio's authoring viewport, which
   * has no gameplay to tick). Safe to call multiple times — subsequent
   * calls are no-ops while a loop is already running. Stops on unmount.
   */
  startRenderLoop(): void;

  /** Resize the renderer + pipeline. */
  resize(width: number, height: number): void;

  /** Replace the active camera (Studio uses this for ortho/perspective toggle). */
  setCamera(camera: THREE.Camera): void;

  /**
   * Apply an environment definition and its post-process stack to the
   * pipeline. Safe to call at any time — if the pipeline isn't ready yet,
   * the latest state is queued and applied on init. Subsequent calls
   * replace the queued state.
   */
  applyEnvironment(
    region: RegionDocument | null,
    contentLibrary: ContentLibrarySnapshot,
    environmentOverrideId?: string | null
  ): void;

  /** Subscribe to per-frame updates. Returns an unsubscribe function. */
  subscribeFrame(listener: () => void): () => void;

  /**
   * Opt a loaded object tree (typically a GLB scene clone) into the shadow
   * pipeline. Every Mesh in the tree gets castShadow=true and
   * receiveShadow=true. Without this, shadows from the directional sun do
   * not visibly affect the geometry even when shadowMap is enabled.
   */
  enableShadowsOnObject(root: THREE.Object3D): void;
}

export function createWebRenderHost(options: WebRenderHostOptions): WebRenderHost {
  const { scene, compileProfile } = options;
  const logger = options.logger ?? { warn() {} };

  let activeCamera: THREE.Camera = options.camera;
  let renderer: WebGPURenderer | null = null;
  let renderPipeline: RuntimeRenderPipeline | null = null;
  let shaderRuntime: ShaderRuntime | null = null;
  let container: HTMLElement | null = null;
  let mountGeneration = 0;
  let animationId: number | null = null;
  const frameListeners = new Set<() => void>();

  // Queued environment apply for when the pipeline isn't ready yet. Only the
  // most recent state matters — if applyEnvironment is called repeatedly
  // before init resolves, the last call wins.
  let pendingEnvironmentState: {
    region: RegionDocument | null;
    contentLibrary: ContentLibrarySnapshot;
    environmentOverrideId: string | null;
  } | null = null;

  const environmentController = createEnvironmentSceneController(scene);
  const landscapeController = createLandscapeSceneController(scene);

  function directionFromAngles(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
    const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
    const elevation = THREE.MathUtils.degToRad(elevationDeg);
    return new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    ).normalize();
  }

  function configureRenderer(next: WebGPURenderer): void {
    // Single canonical renderer configuration — consumed by both Studio and
    // the published web runtime so they cannot drift.
    next.shadowMap.enabled = true;
    next.shadowMap.type = THREE.PCFSoftShadowMap;
    next.toneMapping = THREE.ACESFilmicToneMapping;
    next.toneMappingExposure = 1;
    next.outputColorSpace = THREE.SRGBColorSpace;
  }

  function runPendingEnvironment(): void {
    if (!pendingEnvironmentState || !renderPipeline || !shaderRuntime) {
      return;
    }
    const { region, contentLibrary, environmentOverrideId } = pendingEnvironmentState;

    // Keep the shader runtime's content library in sync without disposing
    // and recreating the runtime (which would destroy the post-process node
    // currently installed on pipeline.outputNode and cause material-dispose
    // errors on in-flight caches).
    shaderRuntime.setContentLibrary(contentLibrary);

    environmentController.apply(region, contentLibrary, environmentOverrideId);
    landscapeController.apply(region);

    const resolved = resolveEnvironmentWithPostProcessChain(
      region,
      contentLibrary,
      environmentOverrideId
    );
    if (resolved.definition) {
      shaderRuntime.setSunDirection(
        directionFromAngles(
          resolved.definition.lighting.sun.azimuthDeg,
          resolved.definition.lighting.sun.elevationDeg
        )
      );
    }
    renderPipeline.applyEnvironment(resolved.definition);
    applyPostProcessStack({
      shaderRuntime,
      renderPipeline,
      contentLibrary,
      chain: resolved.effectivePostProcessChain
    });
  }

  let loopRunning = false;

  function renderOnce(): void {
    for (const listener of frameListeners) {
      listener();
    }
    if (renderPipeline) {
      renderPipeline.render();
    }
  }

  function renderLoopTick(): void {
    renderOnce();
    if (loopRunning) {
      animationId = requestAnimationFrame(renderLoopTick);
    }
  }

  return {
    get renderer() {
      return renderer;
    },
    get renderPipeline() {
      return renderPipeline;
    },
    get shaderRuntime() {
      return shaderRuntime;
    },
    environmentController,
    landscapeController,

    mount(element) {
      container = element;
      const generation = ++mountGeneration;

      const next = new WebGPURenderer({ antialias: true });
      configureRenderer(next);
      next.domElement.style.display = "block";
      next.domElement.style.width = "100%";
      next.domElement.style.height = "100%";
      element.appendChild(next.domElement);
      renderer = next;

      void next
        .init()
        .then(() => {
          if (mountGeneration !== generation || container !== element) {
            next.dispose();
            if (next.domElement.parentElement === element) {
              element.removeChild(next.domElement);
            }
            return;
          }

          next.setPixelRatio(window.devicePixelRatio);
          const width = element.clientWidth || 1;
          const height = element.clientHeight || 1;
          next.setSize(width, height, false);

          renderPipeline = createRuntimeRenderPipeline({
            renderer: next,
            scene,
            camera: activeCamera,
            width,
            height
          });

          // ShaderRuntime is created once per mount, not per state update.
          // Content library updates flow through setContentLibrary in
          // runPendingEnvironment below. This replaces the previous
          // dispose-and-recreate pattern that was destroying cached post-
          // process nodes and causing material-disposal errors.
          shaderRuntime = new ShaderRuntime({
            contentLibrary:
              pendingEnvironmentState?.contentLibrary ??
              createEmptyPlaceholderContentLibrary(),
            compileProfile,
            logger
          });

          runPendingEnvironment();
        })
        .catch((error) => {
          logger.warn("WebRenderHost renderer init failed.", {
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

      environmentController.dispose();
      landscapeController.dispose();

      renderPipeline?.dispose();
      renderPipeline = null;

      shaderRuntime?.dispose();
      shaderRuntime = null;

      if (renderer && container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      renderer?.dispose();
      renderer = null;
      container = null;
      pendingEnvironmentState = null;
      frameListeners.clear();
    },

    render() {
      renderOnce();
    },

    startRenderLoop() {
      if (loopRunning) return;
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
    },

    applyEnvironment(region, contentLibrary, environmentOverrideId = null) {
      pendingEnvironmentState = {
        region,
        contentLibrary,
        environmentOverrideId: environmentOverrideId ?? null
      };
      runPendingEnvironment();
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
    }
  };
}

/**
 * Placeholder content library used when the host mounts before any state has
 * been pushed. Real content libraries replace this on the first
 * applyEnvironment call via setContentLibrary.
 */
function createEmptyPlaceholderContentLibrary(): ContentLibrarySnapshot {
  return {
    identity: {
      id: "render-host:placeholder",
      schema: "ContentLibrary",
      version: 2
    },
    assetDefinitions: [],
    environmentDefinitions: [],
    shaderDefinitions: []
  };
}
