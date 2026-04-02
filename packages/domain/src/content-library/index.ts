import type { DocumentIdentity } from "../shared/identity";
import { createScopedId } from "../shared/identity";

export type ContentDefinitionKind =
  | "asset"
  | "material"
  | "npc"
  | "dialogue"
  | "quest"
  | "item"
  | "inspection"
  | "resonance-point"
  | "vfx"
  | "environment";

export interface ContentDefinitionReference {
  definitionId: string;
  definitionKind: ContentDefinitionKind;
}

export interface AssetDefinition {
  definitionId: string;
  definitionKind: "asset";
  displayName: string;
  assetKind: "model";
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
}

export type LightingPreset =
  | "default"
  | "noon"
  | "late_afternoon"
  | "golden_hour"
  | "night";

export interface LightingAdjustments {
  ambientIntensity: number;
  keyIntensity: number;
  shadowDarkness: number;
  warmth: number;
}

export interface FogSettings {
  enabled: boolean;
  density: number;
}

export interface BloomSettings {
  enabled: boolean;
  strength: number;
  radius: number;
  threshold: number;
}

export interface SSAOSettings {
  enabled: boolean;
  kernelRadius: number;
  minDistance: number;
  maxDistance: number;
}

export type SkyMode = "gradient" | "cosmic" | "cosmic-day";

export interface SkySettings {
  enabled: boolean;
  mode: SkyMode;
  topColor: number;
  bottomColor: number;
  horizonBlend: number;
  gradientExponent: number;
  saturation: number;
  nebulaDensity: number;
  nebulaSpeed: number;
  riftEnabled: boolean;
  riftIntensity: number;
  riftPulseSpeed: number;
  riftSwirlStrength: number;
  cloudsEnabled: boolean;
  cloudCoverage: number;
  cloudSoftness: number;
  cloudOpacity: number;
  cloudScale: number;
  cloudSpeed: number;
  cloudDirectionDegrees: number;
}

export interface EnvironmentDefinition {
  definitionId: string;
  definitionKind: "environment";
  displayName: string;
  lighting: {
    preset: LightingPreset;
    adjustments: LightingAdjustments;
  };
  atmosphere: {
    fog: FogSettings;
    bloom: BloomSettings;
    ssao: SSAOSettings;
    sky: SkySettings;
  };
  backdrop: {
    cityscapeEnabled: boolean;
    bufferZoneEnabled: boolean;
  };
}

export interface ContentLibrarySnapshot {
  identity: DocumentIdentity;
  assetDefinitions: AssetDefinition[];
  environmentDefinitions: EnvironmentDefinition[];
}

export const DEFAULT_LIGHTING_ADJUSTMENTS: LightingAdjustments = {
  ambientIntensity: 1.0,
  keyIntensity: 1.0,
  shadowDarkness: 1.0,
  warmth: 0.0
};

export const DEFAULT_BLOOM_SETTINGS: BloomSettings = {
  enabled: false,
  strength: 0.4,
  radius: 0.4,
  threshold: 0.9
};

export const DEFAULT_SSAO_SETTINGS: SSAOSettings = {
  enabled: false,
  kernelRadius: 8,
  minDistance: 0.005,
  maxDistance: 0.1
};

export const DEFAULT_SKY_SETTINGS: SkySettings = {
  enabled: true,
  mode: "gradient",
  topColor: 0x404040,
  bottomColor: 0x2a2a2a,
  horizonBlend: 0.5,
  gradientExponent: 1.5,
  saturation: 1.0,
  nebulaDensity: 0.7,
  nebulaSpeed: 1.0,
  riftEnabled: true,
  riftIntensity: 1.0,
  riftPulseSpeed: 1.0,
  riftSwirlStrength: 1.5,
  cloudsEnabled: false,
  cloudCoverage: 0.48,
  cloudSoftness: 0.12,
  cloudOpacity: 0.55,
  cloudScale: 2.2,
  cloudSpeed: 0.25,
  cloudDirectionDegrees: 18
};

export const SKY_PRESET_COLORS: Record<
  LightingPreset,
  { topColor: number; bottomColor: number }
> = {
  default: { topColor: 0x404040, bottomColor: 0x2a2a2a },
  noon: { topColor: 0x4a90d9, bottomColor: 0x87ceeb },
  late_afternoon: { topColor: 0x53b5ec, bottomColor: 0xbfe1ee },
  golden_hour: { topColor: 0xe67e22, bottomColor: 0xffd4a3 },
  night: { topColor: 0x0a0a1a, bottomColor: 0x1a1428 }
};

export function getDefaultFogDensityForPreset(preset: LightingPreset): number {
  if (preset === "night") return 0.02;
  if (preset === "late_afternoon") return 0.0055;
  return 0.008;
}

export function createEnvironmentDefinitionId(projectId: string): string {
  return `${projectId}:environment:${createScopedId("env")}`;
}

export function createDefaultEnvironmentDefinition(
  projectId: string,
  options: {
    definitionId?: string;
    displayName?: string;
    preset?: LightingPreset;
  } = {}
): EnvironmentDefinition {
  const preset = options.preset ?? "default";
  const skyColors = SKY_PRESET_COLORS[preset];

  return {
    definitionId: options.definitionId ?? createEnvironmentDefinitionId(projectId),
    definitionKind: "environment",
    displayName: options.displayName ?? "Default Environment",
    lighting: {
      preset,
      adjustments: { ...DEFAULT_LIGHTING_ADJUSTMENTS }
    },
    atmosphere: {
      fog: {
        enabled: true,
        density: getDefaultFogDensityForPreset(preset)
      },
      bloom: { ...DEFAULT_BLOOM_SETTINGS },
      ssao: { ...DEFAULT_SSAO_SETTINGS },
      sky: {
        ...DEFAULT_SKY_SETTINGS,
        topColor: skyColors.topColor,
        bottomColor: skyColors.bottomColor
      }
    },
    backdrop: {
      cityscapeEnabled: false,
      bufferZoneEnabled: false
    }
  };
}

export function createEmptyContentLibrarySnapshot(
  projectId: string
): ContentLibrarySnapshot {
  return {
    identity: {
      id: `${projectId}:content-library`,
      schema: "ContentLibrary",
      version: 1
    },
    assetDefinitions: [],
    environmentDefinitions: [
      createDefaultEnvironmentDefinition(projectId, {
        definitionId: `${projectId}:environment:default`,
        displayName: "Default Environment",
        preset: "default"
      })
    ]
  };
}

export function normalizeContentLibrarySnapshot(
  contentLibrary: ContentLibrarySnapshot,
  projectId: string
): ContentLibrarySnapshot {
  const nextEnvironmentDefinitions = contentLibrary.environmentDefinitions?.length
    ? [...contentLibrary.environmentDefinitions]
    : [
        createDefaultEnvironmentDefinition(projectId, {
          definitionId: `${projectId}:environment:default`,
          displayName: "Default Environment",
          preset: "default"
        })
      ];

  return {
    identity: contentLibrary.identity,
    assetDefinitions: [...contentLibrary.assetDefinitions],
    environmentDefinitions: nextEnvironmentDefinitions
  };
}

export function getAssetDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): AssetDefinition | null {
  return (
    contentLibrary.assetDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listAssetDefinitions(
  contentLibrary: ContentLibrarySnapshot
): AssetDefinition[] {
  return [...contentLibrary.assetDefinitions];
}

export function getEnvironmentDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): EnvironmentDefinition | null {
  return (
    contentLibrary.environmentDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listEnvironmentDefinitions(
  contentLibrary: ContentLibrarySnapshot
): EnvironmentDefinition[] {
  return [...contentLibrary.environmentDefinitions];
}
