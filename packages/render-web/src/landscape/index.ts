/**
 * Web landscape scene controller.
 *
 * Composes the runtime-core landscape descriptor with the render-web
 * landscape mesh realization. Studio and Preview both consume this so
 * authored landscape semantics stay shared while editor overlays remain host-
 * owned.
 */

import * as THREE from "three";
import type {
  ContentLibrarySnapshot,
  RegionDocument,
  RegionLandscapePaintPayload,
  RegionLandscapeState
} from "@sugarmagic/domain";
import {
  resolveLandscapeDescriptorFromState,
  type LandscapeBrushStroke,
  type LandscapeRuntimeDescriptor,
  type LandscapeSceneApplyResult,
  type LandscapeSceneWarning
} from "@sugarmagic/runtime-core";
import {
  createAuthoredAssetResolver,
  type AuthoredAssetResolver
} from "../authoredAssetResolver";
import { RuntimeLandscapeMesh } from "./mesh";

export interface LandscapeSceneController {
  readonly root: THREE.Group;
  readonly surfaceRoot: THREE.Group;
  apply: (
    region: RegionDocument | null,
    contentLibrary?: ContentLibrarySnapshot | null,
    fileSources?: Record<string, string>
  ) => LandscapeSceneApplyResult;
  applyLandscape: (
    landscape: RegionLandscapeState | null,
    contentLibrary?: ContentLibrarySnapshot | null,
    fileSources?: Record<string, string>
  ) => LandscapeSceneApplyResult;
  paintStroke: (
    stroke: LandscapeBrushStroke,
    contentLibrary?: ContentLibrarySnapshot | null,
    fileSources?: Record<string, string>
  ) => boolean;
  renderMaskToCanvas: (channelIndex: number, canvas: HTMLCanvasElement) => void;
  serializePaintPayload: () => RegionLandscapePaintPayload | null;
  dispose: () => void;
}

export function createLandscapeSceneController(
  scene: THREE.Scene,
  assetResolver?: AuthoredAssetResolver
): LandscapeSceneController {
  const root = new THREE.Group();
  root.name = "runtime-landscape-root";
  scene.add(root);

  // When a host passes its shared resolver we use it directly so textures
  // stay coherent with the shader runtime. Standalone (tests, bespoke
  // contexts) we own a private one driven off fileSources passed through
  // apply / applyLandscape / paintStroke.
  const ownsResolver = !assetResolver;
  const resolver: AuthoredAssetResolver =
    assetResolver ?? createAuthoredAssetResolver();

  let currentDescriptor: LandscapeRuntimeDescriptor | null = null;
  let currentLandscapeState: RegionLandscapeState | null = null;
  let currentLandscapeMesh: RuntimeLandscapeMesh | null = null;
  let currentContentLibrary: ContentLibrarySnapshot | null = null;

  function rebuildMesh(descriptor: LandscapeRuntimeDescriptor | null) {
    if (currentLandscapeMesh) {
      root.remove(currentLandscapeMesh.mesh);
      currentLandscapeMesh.dispose();
      currentLandscapeMesh = null;
    }

    if (!descriptor) {
      currentDescriptor = descriptor;
      return;
    }

    currentLandscapeMesh = new RuntimeLandscapeMesh(
      descriptor.size,
      descriptor.subdivisions,
      descriptor.paintResolution,
      resolver
    );
    root.add(currentLandscapeMesh.mesh);
    currentDescriptor = descriptor;
  }

  function applyLandscape(
    landscape: RegionLandscapeState | null,
    contentLibrary: ContentLibrarySnapshot | null = null,
    fileSources: Record<string, string> = {}
  ): LandscapeSceneApplyResult {
    const descriptor = resolveLandscapeDescriptorFromState(landscape);
    const warnings: LandscapeSceneWarning[] = [];
    currentContentLibrary = contentLibrary;
    // When we own the resolver (standalone callers — tests, etc.), we
    // also own sync. When the host owns it, fileSources here is just a
    // legacy breadcrumb — the host will have synced already.
    if (ownsResolver) {
      resolver.sync(contentLibrary, fileSources);
    }

    if (!landscape) {
      rebuildMesh(null);
      currentLandscapeState = null;
      return { descriptor: null, warnings };
    }

    if (!descriptor) {
      warnings.push({
        code: "landscape-invalid",
        message: "Landscape settings were invalid; the runtime skipped landscape generation."
      });
      rebuildMesh(null);
      currentLandscapeState = landscape;
      return { descriptor: null, warnings };
    }

    if (!descriptor.enabled) {
      warnings.push({
        code: "landscape-disabled",
        message: "Landscape is disabled for this region."
      });
      rebuildMesh(null);
      currentLandscapeState = landscape;
      currentDescriptor = descriptor;
      return { descriptor, warnings };
    }

    const meshShapeChanged =
      !currentDescriptor ||
      currentDescriptor.enabled !== descriptor.enabled ||
      currentDescriptor.size !== descriptor.size ||
      currentDescriptor.subdivisions !== descriptor.subdivisions ||
      currentDescriptor.paintResolution !== descriptor.paintResolution;

    if (meshShapeChanged) {
      rebuildMesh(descriptor);
    }

    currentLandscapeMesh?.applyLandscapeState(
      landscape,
      currentContentLibrary
    );
    currentLandscapeState = landscape;
    currentDescriptor = descriptor;
    return { descriptor, warnings };
  }

  return {
    root,
    surfaceRoot: root,
    apply(region, contentLibrary, fileSources) {
      return applyLandscape(region?.landscape ?? null, contentLibrary ?? null, fileSources ?? {});
    },
    applyLandscape,
    paintStroke(stroke, contentLibrary, fileSources) {
      if (!currentLandscapeMesh || !currentLandscapeState?.enabled) {
        return false;
      }
      if (ownsResolver && fileSources) {
        resolver.sync(contentLibrary ?? currentContentLibrary, fileSources);
      }

      currentLandscapeMesh.paintAtWorldPoint(
        stroke.channelIndex,
        stroke.worldX,
        stroke.worldZ,
        stroke.radius,
        stroke.strength,
        stroke.falloff,
        currentLandscapeState,
        contentLibrary ?? currentContentLibrary
      );
      return true;
    },
    renderMaskToCanvas(channelIndex, canvas) {
      currentLandscapeMesh?.renderMaskToCanvas(channelIndex, canvas);
    },
    serializePaintPayload() {
      return currentLandscapeMesh?.serializePaintPayload() ?? null;
    },
    dispose() {
      rebuildMesh(null);
      scene.remove(root);
      if (ownsResolver) {
        resolver.dispose();
      }
    }
  };
}

export { RuntimeLandscapeMesh } from "./mesh";
