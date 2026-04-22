/**
 * Landscape runtime semantics.
 *
 * Owns the pure landscape descriptor and paint contracts that every runtime
 * target shares. GPU realization lives in `@sugarmagic/render-web`; this
 * module intentionally stays free of Three.js so runtime-core remains the
 * source of truth for meaning, not rendering details.
 */

import type { RegionDocument, RegionLandscapeState } from "@sugarmagic/domain";
import { DEFAULT_REGION_LANDSCAPE_RESOLUTION } from "@sugarmagic/domain";

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
    channelCount: landscape.surfaceSlots.length
  };
}

export { LandscapeSplatmap } from "./splatmap";
