import type {
  ContentLibrarySnapshot,
  EnvironmentDefinition,
  LightingPreset,
  RegionDocument
} from "@sugarmagic/domain";
import {
  getDefaultFogDensityForPreset,
  getEnvironmentDefinition,
  SKY_PRESET_COLORS
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

const LIGHTING_PRESET_LABELS: Record<LightingPreset, string> = {
  default: "Default",
  noon: "Noon",
  late_afternoon: "Late Afternoon",
  golden_hour: "Golden Hour",
  night: "Night"
};

export function getLightingPresetOptions(): Array<{
  value: LightingPreset;
  label: string;
}> {
  return Object.entries(LIGHTING_PRESET_LABELS).map(([value, label]) => ({
    value: value as LightingPreset,
    label
  }));
}

export function applyLightingPresetToEnvironmentDefinition(
  definition: EnvironmentDefinition,
  preset: LightingPreset
): EnvironmentDefinition {
  const skyColors = SKY_PRESET_COLORS[preset];

  return {
    ...definition,
    lighting: {
      ...definition.lighting,
      preset
    },
    atmosphere: {
      ...definition.atmosphere,
      fog: {
        ...definition.atmosphere.fog,
        density: getDefaultFogDensityForPreset(preset)
      },
      sky: {
        ...definition.atmosphere.sky,
        topColor: skyColors.topColor,
        bottomColor: skyColors.bottomColor
      }
    }
  };
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
