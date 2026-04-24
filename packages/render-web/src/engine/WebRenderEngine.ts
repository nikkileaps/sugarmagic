/**
 * WebRenderEngine
 *
 * Shared render-web engine state for one Studio process or one published
 * runtime host. It owns the expensive, shared pieces of the web renderer:
 * GPU device acquisition, ShaderRuntime compilation/cache state, authored
 * asset resolution, and the resolved authored environment snapshot.
 *
 * The engine is intentionally store-agnostic. Studio and targets own the
 * subscription plumbing and push canonical state into it via explicit setter
 * calls. RenderViews attach to the engine and re-apply the current engine
 * state when notified.
 */

import * as THREE from "three";
import {
  createEmptyContentLibrarySnapshot,
  type ContentLibrarySnapshot,
  type RegionDocument
} from "@sugarmagic/domain";
import {
  resolveEnvironmentWithPostProcessChain,
  type ResolvedEnvironmentDefinition,
  type RuntimeCompileProfile
} from "@sugarmagic/runtime-core";
import { createAuthoredAssetResolver, type AuthoredAssetResolver } from "../authoredAssetResolver";
import { sunIncomingDirectionFromAngles } from "../environment/sunVectors";
import { ShaderRuntime } from "../ShaderRuntime";
import type { RenderView } from "../view/RenderView";

export interface WebRenderLogger {
  warn: (message: string, payload?: Record<string, unknown>) => void;
  debug?: (message: string, payload?: Record<string, unknown>) => void;
}

export interface WebRenderEngineOptions {
  compileProfile: RuntimeCompileProfile;
  logger?: WebRenderLogger;
}

export interface WebRenderEnvironmentState {
  version: number;
  region: RegionDocument | null;
  contentLibrary: ContentLibrarySnapshot;
  environmentOverrideId: string | null;
  resolved: ResolvedEnvironmentDefinition;
}

export interface WebRenderEngine {
  readonly device: GPUDevice;
  readonly shaderRuntime: ShaderRuntime;
  readonly assetResolver: AuthoredAssetResolver;
  readonly logger: WebRenderLogger;
  ensureDevice(): Promise<GPUDevice>;
  setContentLibrary(library: ContentLibrarySnapshot): void;
  setAssetSources(sources: Record<string, string>): void;
  setEnvironment(
    region: RegionDocument | null,
    environmentOverrideId: string | null
  ): void;
  resetForProjectSwitch(): void;
  attachView(view: RenderView): void;
  detachView(view: RenderView): void;
  getEnvironmentState(): WebRenderEnvironmentState;
  getAssetSources(): Record<string, string>;
  dispose(): void;
}

const PLACEHOLDER_CONTENT_LIBRARY = createEmptyContentLibrarySnapshot(
  "render-engine:placeholder"
);

const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0, 1, 0);

function createDefaultLogger(): WebRenderLogger {
  return {
    warn(message: string, payload?: Record<string, unknown>) {
      console.warn("[render-web]", { message, ...(payload ?? {}) });
    },
    debug(message: string, payload?: Record<string, unknown>) {
      console.debug("[render-web]", { message, ...(payload ?? {}) });
    }
  };
}

async function requestSharedDevice(): Promise<GPUDevice> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this environment.");
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
    featureLevel: "compatibility"
  });
  if (!adapter) {
    throw new Error("Unable to create a WebGPU adapter.");
  }

  const supportedFeatures = Array.from(
    adapter.features.values()
  ) as GPUFeatureName[];
  return adapter.requestDevice({
    requiredFeatures: supportedFeatures
  });
}

export function createWebRenderEngine(
  options: WebRenderEngineOptions
): WebRenderEngine {
  const logger = options.logger ?? createDefaultLogger();
  const attachedViews = new Set<RenderView>();
  let disposed = false;
  let currentContentLibrary: ContentLibrarySnapshot = PLACEHOLDER_CONTENT_LIBRARY;
  let currentAssetSources: Record<string, string> = {};
  let currentRegion: RegionDocument | null = null;
  let currentEnvironmentOverrideId: string | null = null;
  let environmentVersion = 0;
  let device: GPUDevice | null = null;
  let devicePromise: Promise<GPUDevice> | null = null;

  const assetResolver = createAuthoredAssetResolver({
    logger,
    onTextureUpdated() {
      for (const view of attachedViews) {
        view.markSceneMaterialsDirty();
        view.landscapeController.applyLandscape(
          currentRegion?.landscape ?? null,
          currentContentLibrary,
          currentAssetSources
        );
      }
    }
  });

  const shaderRuntime = new ShaderRuntime({
    contentLibrary: currentContentLibrary,
    compileProfile: options.compileProfile,
    logger,
    assetResolver
  });

  let environmentState: WebRenderEnvironmentState = {
    version: environmentVersion,
    region: null,
    contentLibrary: currentContentLibrary,
    environmentOverrideId: null,
    resolved: resolveEnvironmentWithPostProcessChain(
      null,
      currentContentLibrary,
      null
    )
  };

  function ensureNotDisposed(): void {
    if (disposed) {
      throw new Error("WebRenderEngine was used after disposal.");
    }
  }

  function notifyViews(): void {
    for (const view of attachedViews) {
      view.requestEngineStateSync();
    }
  }

  function recomputeEnvironmentState(): void {
    const resolved = resolveEnvironmentWithPostProcessChain(
      currentRegion,
      currentContentLibrary,
      currentEnvironmentOverrideId
    );

    if (resolved.definition) {
      shaderRuntime.setSunDirection(
        sunIncomingDirectionFromAngles(
          resolved.definition.lighting.sun.azimuthDeg,
          resolved.definition.lighting.sun.elevationDeg
        )
      );
    } else {
      shaderRuntime.setSunDirection(DEFAULT_SUN_DIRECTION);
    }

    environmentVersion += 1;
    environmentState = {
      version: environmentVersion,
      region: currentRegion,
      contentLibrary: currentContentLibrary,
      environmentOverrideId: currentEnvironmentOverrideId,
      resolved
    };
  }

  async function ensureDevice(): Promise<GPUDevice> {
    ensureNotDisposed();
    if (device) {
      return device;
    }
    if (!devicePromise) {
      devicePromise = requestSharedDevice()
        .then((nextDevice) => {
          device = nextDevice;
          return nextDevice;
        })
        .catch((error) => {
          devicePromise = null;
          throw error;
        });
    }
    return devicePromise;
  }

  const engine: WebRenderEngine = {
    get device() {
      if (!device) {
        throw new Error(
          "WebRenderEngine device was accessed before the engine initialized WebGPU."
        );
      }
      return device;
    },
    shaderRuntime,
    assetResolver,
    logger,
    setContentLibrary(library) {
      ensureNotDisposed();
      currentContentLibrary = library;
      shaderRuntime.setContentLibrary(library);
      assetResolver.sync(library, currentAssetSources);
      recomputeEnvironmentState();
      notifyViews();
    },
    setAssetSources(sources) {
      ensureNotDisposed();
      currentAssetSources = sources;
      assetResolver.sync(currentContentLibrary, currentAssetSources);
      recomputeEnvironmentState();
      notifyViews();
    },
    setEnvironment(region, environmentOverrideId) {
      ensureNotDisposed();
      currentRegion = region;
      currentEnvironmentOverrideId = environmentOverrideId ?? null;
      recomputeEnvironmentState();
      notifyViews();
    },
    resetForProjectSwitch() {
      ensureNotDisposed();
      currentContentLibrary = PLACEHOLDER_CONTENT_LIBRARY;
      currentAssetSources = {};
      currentRegion = null;
      currentEnvironmentOverrideId = null;
      assetResolver.resetForProjectSwitch();
      shaderRuntime.setContentLibrary(PLACEHOLDER_CONTENT_LIBRARY);
      shaderRuntime.setSunDirection(DEFAULT_SUN_DIRECTION);
      recomputeEnvironmentState();
      notifyViews();
    },
    attachView(view) {
      ensureNotDisposed();
      attachedViews.add(view);
      view.requestEngineStateSync();
    },
    detachView(view) {
      attachedViews.delete(view);
    },
    getEnvironmentState() {
      return environmentState;
    },
    getAssetSources() {
      return currentAssetSources;
    },
    ensureDevice() {
      return ensureDevice();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      attachedViews.clear();
      assetResolver.dispose();
      shaderRuntime.dispose();
      if (device) {
        device.destroy();
        device = null;
      }
      devicePromise = null;
    }
  };

  return engine;
}
