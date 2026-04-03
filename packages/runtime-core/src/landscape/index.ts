import * as THREE from "three";
import type {
  RegionDocument,
  RegionLandscapeState,
  RegionLandscapePaintPayload
} from "@sugarmagic/domain";
import {
  DEFAULT_REGION_LANDSCAPE_RESOLUTION
} from "@sugarmagic/domain";
import { RuntimeLandscapeMesh } from "./mesh";

export interface LandscapeRuntimeDescriptor {
  owner: "runtime-core";
  enabled: boolean;
  size: number;
  subdivisions: number;
  paintResolution: number;
  channelCount: number;
}

export interface LandscapeSceneWarning {
  code: "landscape-disabled" | "landscape-invalid";
  message: string;
}

export interface LandscapeSceneApplyResult {
  descriptor: LandscapeRuntimeDescriptor | null;
  warnings: LandscapeSceneWarning[];
}

export interface LandscapeBrushStroke {
  channelIndex: number;
  worldX: number;
  worldZ: number;
  radius: number;
  strength: number;
  falloff: number;
}

export interface LandscapeSceneController {
  readonly root: THREE.Group;
  readonly surfaceRoot: THREE.Group;
  apply: (region: RegionDocument | null) => LandscapeSceneApplyResult;
  applyLandscape: (landscape: RegionLandscapeState | null) => LandscapeSceneApplyResult;
  paintStroke: (stroke: LandscapeBrushStroke) => boolean;
  renderMaskToCanvas: (channelIndex: number, canvas: HTMLCanvasElement) => void;
  serializePaintPayload: () => RegionLandscapePaintPayload | null;
  dispose: () => void;
}

export function resolveLandscapeDescriptor(
  region: RegionDocument | null
): LandscapeRuntimeDescriptor | null {
  return resolveLandscapeDescriptorFromState(region?.landscape ?? null);
}

export function resolveLandscapeDescriptorFromState(
  landscape: RegionLandscapeState | null
): LandscapeRuntimeDescriptor | null {
  if (!landscape) return null;

  const size = Number.isFinite(landscape.size) ? landscape.size : 0;
  const subdivisions = Number.isFinite(landscape.subdivisions)
    ? landscape.subdivisions
    : 0;
  const paintResolution =
    landscape.paintPayload?.resolution ?? DEFAULT_REGION_LANDSCAPE_RESOLUTION;

  if (size <= 0 || subdivisions < 1 || paintResolution < 1) {
    return null;
  }

  return {
    owner: "runtime-core",
    enabled: landscape.enabled,
    size,
    subdivisions,
    paintResolution,
    channelCount: landscape.channels.length
  };
}

export function createLandscapeSceneController(
  scene: THREE.Scene
): LandscapeSceneController {
  const root = new THREE.Group();
  root.name = "runtime-landscape-root";
  scene.add(root);

  let currentDescriptor: LandscapeRuntimeDescriptor | null = null;
  let currentLandscapeState: RegionLandscapeState | null = null;
  let currentLandscapeMesh: RuntimeLandscapeMesh | null = null;

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
      descriptor.paintResolution
    );
    root.add(currentLandscapeMesh.mesh);
    currentDescriptor = descriptor;
  }

  function applyLandscape(landscape: RegionLandscapeState | null): LandscapeSceneApplyResult {
    const descriptor = resolveLandscapeDescriptorFromState(landscape);
    const warnings: LandscapeSceneWarning[] = [];

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

    currentLandscapeMesh?.applyLandscapeState(landscape);
    currentLandscapeState = landscape;
    currentDescriptor = descriptor;
    return { descriptor, warnings };
  }

  return {
    root,
    surfaceRoot: root,
    apply(region) {
      return applyLandscape(region?.landscape ?? null);
    },
    applyLandscape,
    paintStroke(stroke) {
      if (!currentLandscapeMesh || !currentLandscapeState?.enabled) {
        return false;
      }

      currentLandscapeMesh.paintAtWorldPoint(
        stroke.channelIndex,
        stroke.worldX,
        stroke.worldZ,
        stroke.radius,
        stroke.strength,
        stroke.falloff
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
    }
  };
}

export { RuntimeLandscapeMesh } from "./mesh";
export { LandscapeSplatmap } from "./splatmap";
