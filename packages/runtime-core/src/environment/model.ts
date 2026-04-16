/**
 * Environment semantics and resolution.
 *
 * Owns the pure runtime-core environment helpers: preset application,
 * environment binding resolution, post-process chain ordering, and sky-derived
 * ambient calculations. This module intentionally contains no Three.js code;
 * render hosts consume these descriptors through @sugarmagic/render-web.
 */

import type {
  AmbientConfig,
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  LightingPreset,
  PostProcessShaderBinding,
  RegionDocument,
  ShadowQuality,
  SkySettings
} from "@sugarmagic/domain";
import {
  applyLightingPresetTemplate as applyLightingPresetTemplateInDomain,
  getEnvironmentDefinition
} from "@sugarmagic/domain";

export interface EnvironmentRuntimeDescriptor {
  owner: "runtime-core";
}

export interface EnvironmentSceneWarning {
  code:
    | "environment-missing"
    | "render-pipeline-fallback"
    | "webgpu-unavailable";
  message: string;
}

export interface EnvironmentApplyResult {
  definitionId: string | null;
  preset: LightingPreset | null;
  warnings: EnvironmentSceneWarning[];
}

export interface ResolvedEnvironmentDefinition {
  definition: EnvironmentDefinition | null;
  effectivePostProcessChain: PostProcessShaderBinding[];
}

const LIGHTING_PRESET_LABELS: Record<LightingPreset, string> = {
  default: "Default",
  noon: "Noon",
  late_afternoon: "Late Afternoon",
  golden_hour: "Golden Hour",
  night: "Night"
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function channel(hex: number, shift: number): number {
  return ((hex >> shift) & 0xff) / 255;
}

function rgbToHsl(color: number): { h: number; s: number; l: number } {
  const r = channel(color, 16);
  const g = channel(color, 8);
  const b = channel(color, 0);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
      break;
  }
  return { h: h / 6, s, l };
}

function hexToVector(color: number): [number, number, number] {
  return [channel(color, 16), channel(color, 8), channel(color, 0)];
}

export function computeSkyDrivenAmbient(
  sky: SkySettings
): { color: number; intensity: number } {
  const [topR, topG, topB] = hexToVector(sky.topColor);
  const [bottomR, bottomG, bottomB] = hexToVector(sky.bottomColor);
  const mixed = [
    topR * 0.62 + bottomR * 0.38,
    topG * 0.62 + bottomG * 0.38,
    topB * 0.62 + bottomB * 0.38
  ] as const;
  const avgLuma =
    mixed[0] * 0.2126 + mixed[1] * 0.7152 + mixed[2] * 0.0722;
  const saturation = rgbToHsl(
    (Math.round(mixed[0] * 255) << 16) |
      (Math.round(mixed[1] * 255) << 8) |
      Math.round(mixed[2] * 255)
  ).s;
  return {
    color:
      (Math.round(clamp01(mixed[0]) * 255) << 16) |
      (Math.round(clamp01(mixed[1]) * 255) << 8) |
      Math.round(clamp01(mixed[2]) * 255),
    intensity: clamp01(0.25 + avgLuma * 0.45 + saturation * 0.2)
  };
}

export function resolveAmbientLighting(
  definition: EnvironmentDefinition
): AmbientConfig & { resolvedColor: number; resolvedIntensity: number } {
  if (definition.lighting.ambient.mode === "flat") {
    return {
      ...definition.lighting.ambient,
      resolvedColor: definition.lighting.ambient.color,
      resolvedIntensity: definition.lighting.ambient.intensity
    };
  }

  // Sky-driven ambient: the sky gradient drives COLOR; the template's
  // ambient.intensity is the desired final intensity, used as-is. The
  // sky-derived intensity from computeSkyDrivenAmbient is informational —
  // multiplying it in here would double-dim every preset (the templates
  // already pick intensities calibrated to their sky), which is exactly
  // what produced the near-black scenes pre-fix.
  const computed = computeSkyDrivenAmbient(definition.atmosphere.sky);
  return {
    ...definition.lighting.ambient,
    resolvedColor: computed.color,
    resolvedIntensity: definition.lighting.ambient.intensity
  };
}

export function getLightingPresetOptions(): Array<{
  value: LightingPreset;
  label: string;
}> {
  return Object.entries(LIGHTING_PRESET_LABELS).map(([value, label]) => ({
    value: value as LightingPreset,
    label
  }));
}

/**
 * Concrete GPU-facing shadow parameters for each authored quality preset.
 *
 * Authors pick a preset ("low" / "medium" / "high" / "ultra"); this table
 * maps to the specific cascade count, shadow map size, and PCF sample count
 * used by the WebGPU CSM setup. Centralized here so the mapping can be
 * unit-tested without Three.js imports and so adding a new preset is a
 * single-file change.
 *
 * Cost column is the approximate GPU-time multiplier vs. "no shadows at all"
 * on typical mid-range hardware. Numbers are ballpark guidance for authors,
 * not a perf SLA.
 *
 * | Quality | Cascades | Map size | PCF samples | Typical cost |
 * |---------|----------|----------|-------------|--------------|
 * | low     | 1        | 1024     | 1           | ~1.3x        |
 * | medium  | 2        | 2048     | 4           | ~2x          |
 * | high    | 3        | 2048     | 9           | ~3.5x        |
 * | ultra   | 4        | 4096     | 16          | ~6-8x        |
 */
export interface ExpandedShadowQuality {
  cascadeCount: number;
  mapSize: number;
  pcfSamples: number;
}

const SHADOW_QUALITY_TABLE: Record<ShadowQuality, ExpandedShadowQuality> = {
  low: { cascadeCount: 1, mapSize: 1024, pcfSamples: 1 },
  medium: { cascadeCount: 2, mapSize: 2048, pcfSamples: 4 },
  high: { cascadeCount: 3, mapSize: 2048, pcfSamples: 9 },
  ultra: { cascadeCount: 4, mapSize: 4096, pcfSamples: 16 }
};

export function expandShadowQuality(quality: ShadowQuality): ExpandedShadowQuality {
  return { ...SHADOW_QUALITY_TABLE[quality] };
}

export function applyLightingPresetTemplate(
  definition: EnvironmentDefinition,
  preset: LightingPreset,
  projectId: string
): EnvironmentDefinition {
  return applyLightingPresetTemplateInDomain(definition, preset, projectId);
}

export function resolveEnvironmentDefinition(
  region: RegionDocument | null,
  contentLibrary: ContentLibrarySnapshot,
  overrideEnvironmentId: string | null = null
): EnvironmentDefinition | null {
  const requestedId =
    overrideEnvironmentId ?? region?.environmentBinding.defaultEnvironmentId ?? null;

  if (requestedId) {
    const requested = getEnvironmentDefinition(contentLibrary, requestedId);
    if (requested) return requested;
  }

  return contentLibrary.environmentDefinitions[0] ?? null;
}

export function resolveEnvironmentWithPostProcessChain(
  region: RegionDocument | null,
  contentLibrary: ContentLibrarySnapshot,
  overrideEnvironmentId: string | null = null
): ResolvedEnvironmentDefinition {
  const definition = resolveEnvironmentDefinition(
    region,
    contentLibrary,
    overrideEnvironmentId
  );
  return {
    definition,
    effectivePostProcessChain: [...(definition?.postProcessShaders ?? [])]
      .filter((binding) => binding.enabled)
      .sort((a, b) => a.order - b.order)
  };
}
