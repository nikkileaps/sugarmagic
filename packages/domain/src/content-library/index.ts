/**
 * Content library domain types and selectors.
 *
 * Owns the canonical asset and environment definitions stored in the project
 * content library. This is the one authored source of truth for imported
 * reusable assets, render environments, and reusable shader graph documents.
 */

import type { DocumentIdentity } from "../shared/identity";
import { createScopedId } from "../shared/identity";
import {
  createBuiltInMaterialDefinitions,
  createBuiltInFlowerTypeDefinitions,
  createBuiltInGrassTypeDefinitions,
  createBuiltInRockTypeDefinitions,
  createBuiltInSurfaceDefinitions
} from "./builtins";
import type {
  AssetSurfaceSlot,
  RockTypeDefinition,
  ShaderOrMaterial,
  SurfaceBinding
} from "../surface";
import {
  assertReusableSurfaceHasNoPaintedMasks,
  cloneSurfaceBinding,
  createSurface,
  type FlowerTypeDefinition,
  type GrassTypeDefinition,
  type SurfaceContext
} from "../surface";
import type { SurfaceDefinition } from "../surface";
import type {
  PostProcessShaderBinding,
  ShaderGraphDocument
} from "../shader-graph";
import {
  createDefaultBloomPostProcessShaderGraph,
  createDefaultColorGradePostProcessShaderGraph,
  createDefaultFoliageSurfaceShaderGraph,
  createDefaultFoliageSurface2ShaderGraph,
  createDefaultFoliageSurface3ShaderGraph,
  createDefaultGrassSurface2ShaderGraph,
  createDefaultGrassSurface3ShaderGraph,
  createDefaultGrassSurface4ShaderGraph,
  createDefaultGrassSurface6ShaderGraph,
  createDefaultPainterlyGrassShaderGraph,
  createDefaultMeadowGrassShaderGraph,
  createDefaultSunlitLawnShaderGraph,
  createDefaultAutumnFieldGrassShaderGraph,
  createDefaultFogTintPostProcessShaderGraph,
  createDefaultFoliageTintShaderGraph,
  createDefaultFoliageWindShaderGraph,
  createSimpleAlphaTestShaderGraph,
  createDebugParameterColorShaderGraph,
  createDebugWarmIsolatedShaderGraph,
  createDebugSunMaskShaderGraph,
  createDebugVertexAlphaShaderGraph,
  createDebugSphereNormalShaderGraph,
  createDebugTreeHeightShaderGraph,
  createDebugFresnelShaderGraph,
  createDebugConstantRedShaderGraph,
  createDefaultStandardPbrShaderGraph,
  createDefaultStandardPbrSeparateShaderGraph,
  createDefaultTonemapAcesPostProcessShaderGraph,
  createDefaultTonemapReinhardPostProcessShaderGraph,
  createDefaultVignettePostProcessShaderGraph,
  createBuiltInFlatColorShaderGraph,
  createBuiltInFlatTextureShaderGraph,
  createBuiltInCloudShadowEffectShaderGraph
} from "../shader-graph";

export type ContentDefinitionKind =
  | "asset"
  | "material"
  | "texture"
  | "mask-texture"
  | "surface"
  | "grass-type"
  | "flower-type"
  | "rock-type"
  | "npc"
  | "dialogue"
  | "quest"
  | "item"
  | "inspection"
  | "resonance-point"
  | "vfx"
  | "environment"
  | "shader";

export interface ContentDefinitionReference {
  definitionId: string;
  definitionKind: ContentDefinitionKind;
}

export type AssetKind = "model" | "foliage";

export interface AssetDefinition {
  definitionId: string;
  definitionKind: "asset";
  displayName: string;
  assetKind: AssetKind;
  surfaceSlots: AssetSurfaceSlot[];
  deform: ShaderOrMaterial | null;
  effect: ShaderOrMaterial | null;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
}

export interface TextureDefinition {
  definitionId: string;
  definitionKind: "texture";
  displayName: string;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
  colorSpace: "linear" | "srgb";
  packing: "rgba" | "orm" | "normal" | "roughness" | "metallic" | "ao" | "height";
}

export interface MaskTextureDefinition {
  definitionId: string;
  definitionKind: "mask-texture";
  displayName: string;
  source: {
    relativeAssetPath: string;
    fileName: string;
    mimeType: string | null;
  };
  format: "r8" | "rgba8";
  resolution: [number, number];
}

export interface MaterialDefinition {
  definitionId: string;
  definitionKind: "material";
  displayName: string;
  shaderDefinitionId: string;
  parameterValues: Record<string, unknown>;
  textureBindings: Record<string, string>;
}

export type LightingPreset =
  | "default"
  | "noon"
  | "late_afternoon"
  | "golden_hour"
  | "night";

/**
 * Authored shadow quality preset. The actual GPU-facing values (cascade count,
 * shadow map size, PCF sampling) are derived from this preset by
 * expandShadowQuality() in runtime-core. Authors don't pick implementation
 * details; they pick a named tier and the engine maps it concretely.
 */
export type ShadowQuality = "low" | "medium" | "high" | "ultra";

export interface SunShadowSettings {
  enabled: boolean;
  quality: ShadowQuality;
  /** World-space distance the shadow cascades cover from the camera. */
  distance: number;
  /** 0..1 — multiplier on shadow darkness. */
  strength: number;
  /** 0..1 — PCF softness factor; drives sample radius within the quality preset. */
  softness: number;
  /** Shadow acne prevention. Small negative values (~-0.0001) are typical. */
  bias: number;
  /** Normal-offset bias; typical range 0.01..0.1. */
  normalBias: number;
}

export interface SunLight {
  azimuthDeg: number;
  elevationDeg: number;
  color: number;
  intensity: number;
  /**
   * @deprecated Use `shadows.enabled` instead. Retained for v1 doc migration
   * only — normalization moves this into `shadows.enabled` and drops the field.
   * New code should read and write `shadows.enabled`.
   */
  castShadows?: boolean;
  shadows: SunShadowSettings;
}

export interface RimLight {
  azimuthDeg: number;
  elevationDeg: number;
  color: number;
  intensity: number;
}

export type AmbientMode = "sky-driven" | "flat";

export interface AmbientConfig {
  mode: AmbientMode;
  color: number;
  intensity: number;
}

export interface EnvironmentLighting {
  preset: LightingPreset;
  sun: SunLight;
  rim: RimLight | null;
  ambient: AmbientConfig;
}

export interface FogSettings {
  enabled: boolean;
  density: number;
  color: number;
  heightFalloff: number;
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
  postProcessShaders: PostProcessShaderBinding[];
  lighting: EnvironmentLighting;
  atmosphere: {
    fog: FogSettings;
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
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions?: MaskTextureDefinition[];
  surfaceDefinitions?: SurfaceDefinition[];
  grassTypeDefinitions?: GrassTypeDefinition[];
  flowerTypeDefinitions?: FlowerTypeDefinition[];
  rockTypeDefinitions?: RockTypeDefinition[];
  environmentDefinitions: EnvironmentDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
}

export const DEFAULT_SUN_SHADOWS: SunShadowSettings = {
  enabled: true,
  quality: "high",
  distance: 80,
  strength: 1,
  softness: 0.5,
  bias: -0.0001,
  normalBias: 0.05
};

export const DEFAULT_SUN_LIGHT: SunLight = {
  azimuthDeg: 225,
  elevationDeg: 35,
  color: 0xffffff,
  intensity: 0.9,
  shadows: { ...DEFAULT_SUN_SHADOWS }
};

export const DEFAULT_AMBIENT_CONFIG: AmbientConfig = {
  mode: "sky-driven",
  color: 0x8ea2c2,
  intensity: 0.55
};

export const DEFAULT_ENVIRONMENT_LIGHTING: EnvironmentLighting = {
  preset: "default",
  sun: { ...DEFAULT_SUN_LIGHT, shadows: { ...DEFAULT_SUN_SHADOWS } },
  rim: null,
  ambient: { ...DEFAULT_AMBIENT_CONFIG }
};

function normalizeSurfaceBinding<C extends SurfaceContext = SurfaceContext>(
  binding: SurfaceBinding<C> | null | undefined
): SurfaceBinding<C> | null {
  return cloneSurfaceBinding(binding);
}

function normalizeAssetSurfaceSlots(
  surfaceSlots: AssetSurfaceSlot[] | null | undefined
): AssetSurfaceSlot[] {
  if (!surfaceSlots?.length) {
    return [];
  }

  return surfaceSlots
    .map((slot, index) => ({
      slotName: String(slot.slotName ?? "").trim(),
      slotIndex:
        typeof slot.slotIndex === "number" && Number.isFinite(slot.slotIndex)
          ? slot.slotIndex
          : index,
      surface: normalizeSurfaceBinding(slot.surface)
    }))
    .filter((slot) => slot.slotName.length > 0);
}

function normalizeSurfaceDefinitions(
  definitions: SurfaceDefinition[] | null | undefined
): SurfaceDefinition[] {
  return (definitions ?? []).map((definition) => ({
    ...definition,
    surface: (() => {
      const surface = createSurface(definition.surface.layers, definition.surface.context);
      assertReusableSurfaceHasNoPaintedMasks(
        surface,
        `SurfaceDefinition "${definition.definitionId}"`
      );
      return surface;
    })()
  }));
}

function normalizeMaskTextureDefinitions(
  definitions: MaskTextureDefinition[] | null | undefined
): MaskTextureDefinition[] {
  return (definitions ?? []).map((definition) => ({
    ...definition,
    source: {
      relativeAssetPath: definition.source.relativeAssetPath,
      fileName: definition.source.fileName,
      mimeType: definition.source.mimeType
    },
    resolution: [...definition.resolution] as [number, number]
  }));
}

function normalizeGrassTypeDefinitions(
  definitions: GrassTypeDefinition[] | null | undefined
): GrassTypeDefinition[] {
  return (definitions ?? []).map((definition) => ({
    ...definition,
    wind: normalizeShaderOrMaterial(definition.wind)
  }));
}

function normalizeFlowerTypeDefinitions(
  definitions: FlowerTypeDefinition[] | null | undefined
): FlowerTypeDefinition[] {
  return (definitions ?? []).map((definition) => ({
    ...definition,
    wind: normalizeShaderOrMaterial(definition.wind)
  }));
}

function normalizeRockTypeDefinitions(
  definitions: RockTypeDefinition[] | null | undefined
): RockTypeDefinition[] {
  return [...(definitions ?? [])];
}

function normalizeShaderOrMaterial(
  value: ShaderOrMaterial | null | undefined
): ShaderOrMaterial | null {
  if (!value) {
    return null;
  }
  if (value.kind === "material") {
    return {
      kind: "material",
      materialDefinitionId: value.materialDefinitionId
    };
  }
  if (value.kind === "shader") {
    return {
      kind: "shader",
      shaderDefinitionId: value.shaderDefinitionId,
      parameterValues: { ...(value.parameterValues ?? {}) },
      textureBindings: { ...(value.textureBindings ?? {}) }
    };
  }
  return null;
}

export const DEFAULT_FOG_SETTINGS: FogSettings = {
  enabled: false,
  density: 0.008,
  color: 0x879bb4,
  heightFalloff: 1
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

export const LIGHTING_PRESET_TEMPLATES: Record<LightingPreset, EnvironmentLighting> = {
  default: {
    preset: "default",
    // Default is the neutral placeholder preset — meant to look "Blender
    // default" out of the box: a key sun, a soft fill from the opposite
    // direction, and bright flat ambient so vertical surfaces never read as
    // pitch black. The old hardcoded rig was 1 ambient + 1 directional with
    // no fill, which produced the dark-walls problem this template avoids.
    sun: {
      azimuthDeg: 225,
      elevationDeg: 45,
      color: 0xffffff,
      intensity: 1,
      shadows: { ...DEFAULT_SUN_SHADOWS }
    },
    rim: {
      // Opposite hemisphere from the sun, slightly lower elevation. Acts as
      // a fill light that softens the shadow side of vertical geometry.
      azimuthDeg: 45,
      elevationDeg: 25,
      color: 0xffffff,
      intensity: 0.4
    },
    // Sky for "default" is intentionally dark gray (placeholder), so
    // sky-driven ambient is meaningless here. Use flat white ambient at a
    // strong intensity so the scene reads as neutral and well-lit by default.
    ambient: {
      mode: "flat",
      color: 0xffffff,
      intensity: 0.75
    }
  },
  noon: {
    preset: "noon",
    sun: {
      azimuthDeg: 155,
      elevationDeg: 68,
      color: 0xfff5e0,
      intensity: 1,
      shadows: { ...DEFAULT_SUN_SHADOWS }
    },
    // Fill from the opposite hemisphere — a slightly cool tint that reads as
    // "sky bounce" filling the sun's shadow side. Real noon outdoor scenes
    // get most of their shadow fill from the sky dome above (IBL-shaped),
    // which we don't have yet; this fill is the cheap approximation.
    rim: {
      azimuthDeg: 335,
      elevationDeg: 30,
      color: 0xbcd4ee,
      intensity: 0.45
    },
    ambient: {
      mode: "sky-driven",
      color: 0x92b8df,
      intensity: 0.6
    }
  },
  late_afternoon: {
    preset: "late_afternoon",
    sun: {
      azimuthDeg: 250,
      elevationDeg: 36,
      color: 0xffe2bc,
      intensity: 1.02,
      shadows: { ...DEFAULT_SUN_SHADOWS }
    },
    rim: {
      azimuthDeg: 55,
      elevationDeg: 20,
      color: 0xaebcff,
      intensity: 0.16
    },
    ambient: {
      mode: "sky-driven",
      color: 0xa9d0ee,
      intensity: 0.62
    }
  },
  golden_hour: {
    preset: "golden_hour",
    sun: {
      azimuthDeg: 235,
      elevationDeg: 25,
      color: 0xffe0b5,
      intensity: 0.9,
      shadows: { ...DEFAULT_SUN_SHADOWS }
    },
    rim: {
      azimuthDeg: 55,
      elevationDeg: 18,
      color: 0x8888cc,
      intensity: 0.15
    },
    ambient: {
      mode: "sky-driven",
      color: 0xffb88c,
      intensity: 0.5
    }
  },
  night: {
    preset: "night",
    sun: {
      azimuthDeg: 330,
      elevationDeg: 55,
      color: 0x7788aa,
      intensity: 0.3,
      shadows: { ...DEFAULT_SUN_SHADOWS }
    },
    rim: null,
    ambient: {
      mode: "sky-driven",
      color: 0x3a2a4a,
      intensity: 0.4
    }
  }
};

export function getDefaultFogDensityForPreset(preset: LightingPreset): number {
  if (preset === "night") return 0.02;
  if (preset === "late_afternoon") return 0.0055;
  if (preset === "golden_hour") return 0.0065;
  return 0.008;
}

export function getDefaultFogColorForPreset(preset: LightingPreset): number {
  return SKY_PRESET_COLORS[preset].bottomColor;
}

export function createEnvironmentDefinitionId(projectId: string): string {
  return `${projectId}:environment:${createScopedId("env")}`;
}

export function createBuiltInFogTintShaderId(projectId: string): string {
  return `${projectId}:shader:fog-tint`;
}

export function createBuiltInBloomShaderId(projectId: string): string {
  return `${projectId}:shader:bloom`;
}

export function createBuiltInTonemapAcesShaderId(projectId: string): string {
  return `${projectId}:shader:tonemap-aces`;
}

function cloneLighting(lighting: EnvironmentLighting): EnvironmentLighting {
  // Tolerate v2 documents authored before Story 3 that don't have a shadows
  // block on the sun — normalizeSunShadows runs after cloneLighting and
  // fills it in from DEFAULT_SUN_SHADOWS + any legacy castShadows.
  const sunShadows = lighting.sun.shadows
    ? { ...lighting.sun.shadows }
    : undefined;
  return {
    preset: lighting.preset,
    sun: {
      ...lighting.sun,
      ...(sunShadows ? { shadows: sunShadows } : {})
    } as EnvironmentLighting["sun"],
    rim: lighting.rim ? { ...lighting.rim } : null,
    ambient: { ...lighting.ambient }
  };
}

function normalizePostProcessShaderBindings(
  bindings: PostProcessShaderBinding[]
): PostProcessShaderBinding[] {
  return bindings
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((binding, index) => ({
      ...binding,
      order: index,
      parameterOverrides: [...binding.parameterOverrides]
    }));
}

function synchronizeFogBinding(
  definition: EnvironmentDefinition,
  projectId: string
): PostProcessShaderBinding[] {
  const fogShaderDefinitionId = createBuiltInFogTintShaderId(projectId);
  const sortedBindings = normalizePostProcessShaderBindings(definition.postProcessShaders);
  const fogBindingIndex = sortedBindings.findIndex(
    (binding) => binding.shaderDefinitionId === fogShaderDefinitionId
  );
  const nextBinding: PostProcessShaderBinding = {
    shaderDefinitionId: fogShaderDefinitionId,
    order: fogBindingIndex >= 0 ? sortedBindings[fogBindingIndex]!.order : 0,
    enabled: definition.atmosphere.fog.enabled,
    parameterOverrides: [
      { parameterId: "color", value: colorToVector3(definition.atmosphere.fog.color) },
      { parameterId: "density", value: definition.atmosphere.fog.density },
      { parameterId: "heightFalloff", value: definition.atmosphere.fog.heightFalloff }
    ]
  };

  if (fogBindingIndex >= 0) {
    const nextBindings = [...sortedBindings];
    nextBindings[fogBindingIndex] = nextBinding;
    return normalizePostProcessShaderBindings(nextBindings);
  }

  return normalizePostProcessShaderBindings([nextBinding, ...sortedBindings]);
}

function ensureBuiltInEffectBinding(
  bindings: PostProcessShaderBinding[],
  shaderDefinitionId: string,
  enabled: boolean,
  overrides: PostProcessShaderBinding["parameterOverrides"]
): PostProcessShaderBinding[] {
  if (!enabled) {
    return bindings;
  }

  if (bindings.some((binding) => binding.shaderDefinitionId === shaderDefinitionId)) {
    return bindings;
  }

  return normalizePostProcessShaderBindings([
    ...bindings,
    {
      shaderDefinitionId,
      order: bindings.length,
      enabled: true,
      parameterOverrides: overrides
    }
  ]);
}

function colorToVector3(color: number): [number, number, number] {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255
  ];
}

type LegacyEnvironmentDefinition = EnvironmentDefinition & {
  lighting?: {
    preset?: LightingPreset;
    adjustments?: {
      ambientIntensity?: number;
      keyIntensity?: number;
      shadowDarkness?: number;
      warmth?: number;
    };
  };
  atmosphere?: {
    fog?: Partial<FogSettings>;
    bloom?: {
      enabled?: boolean;
      strength?: number;
      radius?: number;
      threshold?: number;
    };
    ssao?: Partial<SSAOSettings>;
    sky?: Partial<SkySettings>;
  };
};

function migrateLightingFromLegacy(
  definition: LegacyEnvironmentDefinition,
  preset: LightingPreset
): EnvironmentLighting {
  const template = cloneLighting(LIGHTING_PRESET_TEMPLATES[preset]);
  const legacyAdjustments = definition.lighting?.adjustments;
  if (!legacyAdjustments) {
    // Not a legacy v1 document. If the existing lighting already has the
    // reworked shape (authored sun/ambient fields), preserve it verbatim —
    // the template is only a fallback for *truly missing* lighting. Before
    // this guard, every v2 normalization pass silently reset the author's
    // sun direction / color / intensity back to the preset template.
    const candidate = definition.lighting as unknown as Partial<EnvironmentLighting> | undefined;
    if (
      candidate &&
      typeof candidate === "object" &&
      candidate.sun &&
      candidate.ambient
    ) {
      return cloneLighting(candidate as EnvironmentLighting);
    }
    return template;
  }

  const ambientIntensity =
    typeof legacyAdjustments.ambientIntensity === "number"
      ? legacyAdjustments.ambientIntensity
      : 1;
  const keyIntensity =
    typeof legacyAdjustments.keyIntensity === "number"
      ? legacyAdjustments.keyIntensity
      : 1;
  const warmth =
    typeof legacyAdjustments.warmth === "number" ? legacyAdjustments.warmth : 0;

  const warmShift = Math.max(0, warmth) * 28;
  const coolShift = Math.max(0, -warmth) * 28;
  const tintColor = (color: number): number => {
    const r = Math.min(255, ((color >> 16) & 0xff) + warmShift);
    const g = Math.min(255, ((color >> 8) & 0xff) + warmShift * 0.5);
    const b = Math.max(0, (color & 0xff) - coolShift);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  };

  template.sun.intensity *= keyIntensity;
  template.sun.color = tintColor(template.sun.color);
  template.ambient.intensity *= ambientIntensity;
  if (template.rim) {
    template.rim.intensity *= ambientIntensity;
  }
  return template;
}

export function synchronizeEnvironmentDefinition(
  definition: EnvironmentDefinition,
  projectId: string
): EnvironmentDefinition {
  const preset = definition.lighting.preset;
  const skyColors = SKY_PRESET_COLORS[preset];
  const nextDefinition: EnvironmentDefinition = {
    ...definition,
    postProcessShaders: normalizePostProcessShaderBindings(
      definition.postProcessShaders ?? []
    ),
    lighting: cloneLighting(definition.lighting),
    atmosphere: {
      ...definition.atmosphere,
      fog: {
        enabled: Boolean(definition.atmosphere.fog.enabled),
        density:
          typeof definition.atmosphere.fog.density === "number"
            ? definition.atmosphere.fog.density
            : getDefaultFogDensityForPreset(preset),
        color:
          typeof definition.atmosphere.fog.color === "number"
            ? definition.atmosphere.fog.color
            : getDefaultFogColorForPreset(preset),
        heightFalloff:
          typeof definition.atmosphere.fog.heightFalloff === "number"
            ? definition.atmosphere.fog.heightFalloff
            : DEFAULT_FOG_SETTINGS.heightFalloff
      },
      ssao: {
        ...DEFAULT_SSAO_SETTINGS,
        ...definition.atmosphere.ssao
      },
      sky: {
        ...DEFAULT_SKY_SETTINGS,
        ...definition.atmosphere.sky,
        topColor:
          typeof definition.atmosphere.sky.topColor === "number"
            ? definition.atmosphere.sky.topColor
            : skyColors.topColor,
        bottomColor:
          typeof definition.atmosphere.sky.bottomColor === "number"
            ? definition.atmosphere.sky.bottomColor
            : skyColors.bottomColor
      }
    }
  };

  nextDefinition.postProcessShaders = synchronizeFogBinding(nextDefinition, projectId);
  nextDefinition.lighting = normalizeSunShadows(nextDefinition.lighting);
  return nextDefinition;
}

/**
 * Fill in `sun.shadows` if missing on an upgraded document, and migrate the
 * deprecated `sun.castShadows` boolean into `sun.shadows.enabled`. Idempotent —
 * documents that already have a well-formed `shadows` block are returned with
 * only the `castShadows` field stripped. Older v1 documents (before lighting
 * rework) have already been through migrateLightingFromLegacy before they
 * reach this function, so their sun comes from a preset template; we just
 * need to make sure templates without shadows get defaults.
 */
function normalizeSunShadows(lighting: EnvironmentLighting): EnvironmentLighting {
  const existing = lighting.sun.shadows;
  const legacyCastShadows = lighting.sun.castShadows;
  const resolved: SunShadowSettings = existing
    ? {
        enabled:
          typeof existing.enabled === "boolean"
            ? existing.enabled
            : legacyCastShadows ?? DEFAULT_SUN_SHADOWS.enabled,
        quality: existing.quality ?? DEFAULT_SUN_SHADOWS.quality,
        distance:
          typeof existing.distance === "number"
            ? existing.distance
            : DEFAULT_SUN_SHADOWS.distance,
        strength:
          typeof existing.strength === "number"
            ? existing.strength
            : DEFAULT_SUN_SHADOWS.strength,
        softness:
          typeof existing.softness === "number"
            ? existing.softness
            : DEFAULT_SUN_SHADOWS.softness,
        bias:
          typeof existing.bias === "number"
            ? existing.bias
            : DEFAULT_SUN_SHADOWS.bias,
        normalBias:
          typeof existing.normalBias === "number"
            ? existing.normalBias
            : DEFAULT_SUN_SHADOWS.normalBias
      }
    : {
        ...DEFAULT_SUN_SHADOWS,
        enabled:
          typeof legacyCastShadows === "boolean"
            ? legacyCastShadows
            : DEFAULT_SUN_SHADOWS.enabled
      };

  const cleanSun = { ...lighting.sun };
  delete (cleanSun as Partial<SunLight>).castShadows;
  return {
    ...lighting,
    sun: {
      ...cleanSun,
      shadows: resolved
    }
  };
}

export function applyLightingPresetTemplate(
  definition: EnvironmentDefinition,
  preset: LightingPreset,
  projectId: string
): EnvironmentDefinition {
  const skyColors = SKY_PRESET_COLORS[preset];
  return synchronizeEnvironmentDefinition(
    {
      ...definition,
      lighting: cloneLighting(LIGHTING_PRESET_TEMPLATES[preset]),
      atmosphere: {
        ...definition.atmosphere,
        fog: {
          ...definition.atmosphere.fog,
          density: getDefaultFogDensityForPreset(preset),
          color: getDefaultFogColorForPreset(preset)
        },
        sky: {
          ...definition.atmosphere.sky,
          topColor: skyColors.topColor,
          bottomColor: skyColors.bottomColor
        }
      }
    },
    projectId
  );
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
  const definition: EnvironmentDefinition = {
    definitionId: options.definitionId ?? createEnvironmentDefinitionId(projectId),
    definitionKind: "environment",
    displayName: options.displayName ?? "Default Environment",
    postProcessShaders: [],
    lighting: cloneLighting(LIGHTING_PRESET_TEMPLATES[preset]),
    atmosphere: {
      fog: {
        enabled: DEFAULT_FOG_SETTINGS.enabled,
        density: getDefaultFogDensityForPreset(preset),
        color: getDefaultFogColorForPreset(preset),
        heightFalloff: DEFAULT_FOG_SETTINGS.heightFalloff
      },
      ssao: { ...DEFAULT_SSAO_SETTINGS },
      sky: {
        ...DEFAULT_SKY_SETTINGS,
        topColor: SKY_PRESET_COLORS[preset].topColor,
        bottomColor: SKY_PRESET_COLORS[preset].bottomColor
      }
    },
    backdrop: {
      cityscapeEnabled: false,
      bufferZoneEnabled: false
    }
  };

  return synchronizeEnvironmentDefinition(definition, projectId);
}

export function createEmptyContentLibrarySnapshot(
  projectId: string
): ContentLibrarySnapshot {
  const builtInShaderDefinitions = createBuiltInShaderDefinitions(projectId);
  const builtInMaterialDefinitions = createBuiltInMaterialDefinitions(projectId);
  const grassTypeDefinitions = createBuiltInGrassTypeDefinitions(projectId);
  const flowerTypeDefinitions = createBuiltInFlowerTypeDefinitions(projectId);
  const rockTypeDefinitions = createBuiltInRockTypeDefinitions(projectId);
  return {
    identity: {
      id: `${projectId}:content-library`,
      schema: "ContentLibrary",
      version: 5
    },
    assetDefinitions: [],
    materialDefinitions: builtInMaterialDefinitions,
    textureDefinitions: [],
    maskTextureDefinitions: [],
    surfaceDefinitions: createBuiltInSurfaceDefinitions(
      projectId,
      grassTypeDefinitions,
      flowerTypeDefinitions
    ),
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    environmentDefinitions: [
      createDefaultEnvironmentDefinition(projectId, {
        definitionId: `${projectId}:environment:default`,
        displayName: "Default Environment",
        preset: "default"
      })
    ],
    shaderDefinitions: builtInShaderDefinitions
  };
}

export function normalizeContentLibrarySnapshot(
  contentLibrary: ContentLibrarySnapshot,
  projectId: string
): ContentLibrarySnapshot {
  const builtInShaderDefinitions = createBuiltInShaderDefinitions(projectId);
  const builtInMaterialDefinitions = createBuiltInMaterialDefinitions(projectId);
  const builtInGrassTypeDefinitions = createBuiltInGrassTypeDefinitions(projectId);
  const builtInFlowerTypeDefinitions = createBuiltInFlowerTypeDefinitions(projectId);
  const builtInRockTypeDefinitions = createBuiltInRockTypeDefinitions(projectId);
  const mergedMaterialDefinitions = mergeBuiltInDefinitions(
    (contentLibrary.materialDefinitions ?? []).map((definition) => ({
      ...definition,
      parameterValues: { ...(definition.parameterValues ?? {}) },
      textureBindings: { ...(definition.textureBindings ?? {}) }
    })),
    builtInMaterialDefinitions,
    (definition) => definition.definitionId
  );
  const mergedGrassTypeDefinitions = mergeBuiltInDefinitions(
    normalizeGrassTypeDefinitions(contentLibrary.grassTypeDefinitions),
    builtInGrassTypeDefinitions,
    (definition) => definition.definitionId
  );
  const mergedFlowerTypeDefinitions = mergeBuiltInDefinitions(
    normalizeFlowerTypeDefinitions(contentLibrary.flowerTypeDefinitions),
    builtInFlowerTypeDefinitions,
    (definition) => definition.definitionId
  );
  const mergedRockTypeDefinitions = mergeBuiltInDefinitions(
    normalizeRockTypeDefinitions(contentLibrary.rockTypeDefinitions),
    builtInRockTypeDefinitions,
    (definition) => definition.definitionId
  );
  const mergedSurfaceDefinitions = mergeBuiltInDefinitions(
    normalizeSurfaceDefinitions(contentLibrary.surfaceDefinitions),
    createBuiltInSurfaceDefinitions(
      projectId,
      mergedGrassTypeDefinitions,
      mergedFlowerTypeDefinitions
    ),
    (definition) => definition.definitionId
  );
  const authoredShaderDefinitions =
    contentLibrary.shaderDefinitions?.length && contentLibrary.shaderDefinitions.length > 0
      ? contentLibrary.shaderDefinitions.map((definition) => ({
          ...definition,
          nodes: definition.nodes.map((node) => ({
            ...node,
            settings: { ...node.settings }
          })),
          edges: [...definition.edges],
          parameters: [...definition.parameters],
          metadata: { ...definition.metadata }
        }))
      : [];
  const mergedShaderDefinitions =
    authoredShaderDefinitions.length > 0
      ? mergeBuiltInShaderDefinitions(authoredShaderDefinitions, builtInShaderDefinitions)
      : builtInShaderDefinitions;
  const nextEnvironmentDefinitions = contentLibrary.environmentDefinitions?.length
    ? [...contentLibrary.environmentDefinitions]
    : [
        createDefaultEnvironmentDefinition(projectId, {
          definitionId: `${projectId}:environment:default`,
          displayName: "Default Environment",
          preset: "default"
      })
    ];
  const bloomShaderDefinitionId = createBuiltInBloomShaderId(projectId);

  const normalizedContentLibrary: ContentLibrarySnapshot = {
    identity: {
      ...contentLibrary.identity,
      version: Math.max(contentLibrary.identity.version ?? 1, 5)
    },
    assetDefinitions: contentLibrary.assetDefinitions.map((definition) => ({
      ...definition,
      surfaceSlots: normalizeAssetSurfaceSlots(definition.surfaceSlots),
      deform: normalizeShaderOrMaterial(definition.deform),
      effect: normalizeShaderOrMaterial(definition.effect)
    })),
    materialDefinitions: mergedMaterialDefinitions,
    textureDefinitions: (contentLibrary.textureDefinitions ?? []).map((definition) => ({
      ...definition,
      source: {
        relativeAssetPath: definition.source.relativeAssetPath,
        fileName: definition.source.fileName,
        mimeType: definition.source.mimeType
      }
    })),
    maskTextureDefinitions: normalizeMaskTextureDefinitions(
      contentLibrary.maskTextureDefinitions
    ),
    surfaceDefinitions: mergedSurfaceDefinitions,
    grassTypeDefinitions: mergedGrassTypeDefinitions,
    flowerTypeDefinitions: mergedFlowerTypeDefinitions,
    rockTypeDefinitions: mergedRockTypeDefinitions,
    environmentDefinitions: nextEnvironmentDefinitions.map((definition) => {
      const legacyDefinition = definition as LegacyEnvironmentDefinition;
      const preset = legacyDefinition.lighting?.preset ?? "default";
      const baseDefinition: EnvironmentDefinition = {
        definitionId: definition.definitionId,
        definitionKind: "environment",
        displayName: definition.displayName,
        postProcessShaders: [...(legacyDefinition.postProcessShaders ?? [])],
        lighting: migrateLightingFromLegacy(legacyDefinition, preset),
        atmosphere: {
          fog: {
            enabled:
              legacyDefinition.atmosphere?.fog?.enabled ?? DEFAULT_FOG_SETTINGS.enabled,
            density:
              legacyDefinition.atmosphere?.fog?.density ??
              getDefaultFogDensityForPreset(preset),
            color:
              legacyDefinition.atmosphere?.fog &&
              typeof legacyDefinition.atmosphere.fog.color === "number"
                ? legacyDefinition.atmosphere.fog.color
                : getDefaultFogColorForPreset(preset),
            heightFalloff:
              legacyDefinition.atmosphere?.fog &&
              typeof legacyDefinition.atmosphere.fog.heightFalloff === "number"
                ? legacyDefinition.atmosphere.fog.heightFalloff
                : DEFAULT_FOG_SETTINGS.heightFalloff
          },
          ssao: {
            ...DEFAULT_SSAO_SETTINGS,
            ...(legacyDefinition.atmosphere?.ssao ?? {})
          },
          sky: {
            ...DEFAULT_SKY_SETTINGS,
            ...(legacyDefinition.atmosphere?.sky ?? {}),
            topColor:
              legacyDefinition.atmosphere?.sky &&
              typeof legacyDefinition.atmosphere.sky.topColor === "number"
                ? legacyDefinition.atmosphere.sky.topColor
                : SKY_PRESET_COLORS[preset].topColor,
            bottomColor:
              legacyDefinition.atmosphere?.sky &&
              typeof legacyDefinition.atmosphere.sky.bottomColor === "number"
                ? legacyDefinition.atmosphere.sky.bottomColor
                : SKY_PRESET_COLORS[preset].bottomColor
          }
        },
        backdrop: {
          cityscapeEnabled: Boolean(definition.backdrop?.cityscapeEnabled),
          bufferZoneEnabled: Boolean(definition.backdrop?.bufferZoneEnabled)
        }
      };

      const bloomSettings = legacyDefinition.atmosphere?.bloom;
      const withMigratedBloom = ensureBuiltInEffectBinding(
        baseDefinition.postProcessShaders,
        bloomShaderDefinitionId,
        Boolean(bloomSettings?.enabled),
        [
          {
            parameterId: "strength",
            value:
              typeof bloomSettings?.strength === "number"
                ? bloomSettings.strength
                : 0.4
          },
          {
            parameterId: "radius",
            value:
              typeof bloomSettings?.radius === "number"
                ? bloomSettings.radius
                : 0.4
          },
          {
            parameterId: "threshold",
            value:
              typeof bloomSettings?.threshold === "number"
                ? bloomSettings.threshold
                : 0.9
          }
        ]
      );

      return synchronizeEnvironmentDefinition(
        {
          ...baseDefinition,
          postProcessShaders: withMigratedBloom
        },
        projectId
      );
    }),
    shaderDefinitions: mergedShaderDefinitions
  };

  for (const assetDefinition of normalizedContentLibrary.assetDefinitions) {
    for (const slot of assetDefinition.surfaceSlots) {
      if (!slot.surface) {
        continue;
      }
      if (slot.surface.kind === "inline") {
        if (slot.surface.surface.context !== "universal") {
          throw new Error(
            `Asset "${assetDefinition.definitionId}" slot "${slot.slotName}" cannot bind a landscape-only surface.`
          );
        }
        continue;
      }
      const referencedSurface = (normalizedContentLibrary.surfaceDefinitions ?? []).find(
        (definition) =>
          slot.surface?.kind === "reference" &&
          definition.definitionId === slot.surface.surfaceDefinitionId
      );
      if (referencedSurface && referencedSurface.surface.context !== "universal") {
        throw new Error(
          `Asset "${assetDefinition.definitionId}" slot "${slot.slotName}" references landscape-only SurfaceDefinition "${referencedSurface.definitionId}".`
        );
      }
    }
  }

  return normalizedContentLibrary;
}

function createBuiltInShaderDefinitions(projectId: string): ShaderGraphDocument[] {
  return [
    createBuiltInFlatColorShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:flat-color`,
      displayName: "Flat Color"
    }),
    createBuiltInFlatTextureShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:flat-texture`,
      displayName: "Flat Texture"
    }),
    createDefaultFoliageSurfaceShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:foliage-surface`,
      displayName: "Foliage Surface"
    }),
    createDefaultFoliageSurface2ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:foliage-surface-2`,
      displayName: "Foliage Surface 2"
    }),
    createDefaultFoliageSurface3ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:foliage-surface-3`,
      displayName: "Foliage Surface 3"
    }),
    createDefaultGrassSurface2ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:grass-surface-2`,
      displayName: "Grass Surface 2"
    }),
    createDefaultGrassSurface3ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:grass-surface-3`,
      displayName: "Grass Surface 3"
    }),
    createDefaultGrassSurface4ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:grass-surface-4`,
      displayName: "Grass Surface 4"
    }),
    createDefaultGrassSurface6ShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:grass-surface-6`,
      displayName: "Grass Surface 6"
    }),
    createDefaultMeadowGrassShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:meadow-grass`,
      displayName: "Meadow Grass"
    }),
    createDefaultSunlitLawnShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:sunlit-lawn`,
      displayName: "Sunlit Lawn"
    }),
    createDefaultAutumnFieldGrassShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:autumn-field-grass`,
      displayName: "Autumn Field Grass"
    }),
    createDefaultPainterlyGrassShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:painterly-grass`,
      displayName: "Painterly Grass"
    }),
    createDefaultFoliageWindShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:foliage-wind`,
      displayName: "Foliage Wind"
    }),
    createDefaultFoliageTintShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:foliage-tint`,
      displayName: "Foliage Tint"
    }),
    createSimpleAlphaTestShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:simple-alpha-test`,
      displayName: "Simple Alpha Test"
    }),
    createBuiltInCloudShadowEffectShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:cloud-shadow-demo`,
      displayName: "Cloud Shadow Demo"
    }),
    createDefaultStandardPbrShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:standard-pbr`,
      displayName: "Standard PBR (ORM)"
    }),
    createDefaultStandardPbrSeparateShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:standard-pbr-separate`,
      displayName: "Standard PBR (Separate)"
    }),
    createDebugParameterColorShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-parameter-color`,
      displayName: "Debug Parameter Color"
    }),
    createDebugWarmIsolatedShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-warm-isolated`,
      displayName: "Debug Warm Isolated"
    }),
    createDebugSunMaskShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-sun-mask`,
      displayName: "Debug Sun Mask"
    }),
    createDebugVertexAlphaShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-vertex-alpha`,
      displayName: "Debug Vertex Alpha"
    }),
    createDebugSphereNormalShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-sphere-normal`,
      displayName: "Debug Sphere Normal"
    }),
    createDebugTreeHeightShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-tree-height`,
      displayName: "Debug Tree Height"
    }),
    createDebugFresnelShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-fresnel`,
      displayName: "Debug Fresnel"
    }),
    createDebugConstantRedShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:debug-constant-red`,
      displayName: "Debug Constant Red"
    }),
    createDefaultColorGradePostProcessShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:color-grade`,
      displayName: "Color Grade"
    }),
    createDefaultTonemapAcesPostProcessShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:tonemap-aces`,
      displayName: "Tonemap ACES"
    }),
    createDefaultTonemapReinhardPostProcessShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:tonemap-reinhard`,
      displayName: "Tonemap Reinhard"
    }),
    createDefaultVignettePostProcessShaderGraph(projectId, {
      shaderDefinitionId: `${projectId}:shader:vignette`,
      displayName: "Vignette"
    }),
    createDefaultFogTintPostProcessShaderGraph(projectId, {
      shaderDefinitionId: createBuiltInFogTintShaderId(projectId),
      displayName: "Fog Tint"
    }),
    createDefaultBloomPostProcessShaderGraph(projectId, {
      shaderDefinitionId: createBuiltInBloomShaderId(projectId),
      displayName: "Bloom"
    })
  ];
}

function mergeBuiltInShaderDefinitions(
  authoredDefinitions: ShaderGraphDocument[],
  builtInDefinitions: ShaderGraphDocument[]
): ShaderGraphDocument[] {
  const nextDefinitions = [...authoredDefinitions];
  for (const builtInDefinition of builtInDefinitions) {
    const builtInKey = builtInDefinition.metadata?.builtInKey;
    const existingIndex = nextDefinitions.findIndex((definition) => {
      if (definition.shaderDefinitionId === builtInDefinition.shaderDefinitionId) {
        return true;
      }

      if (!builtInKey) {
        return false;
      }

      return (
        definition.metadata?.builtIn === true &&
        definition.metadata?.builtInKey === builtInKey
      );
    });

    if (existingIndex >= 0) {
      nextDefinitions[existingIndex] = builtInDefinition;
      continue;
    }
    nextDefinitions.push(builtInDefinition);
  }
  return nextDefinitions;
}

function mergeBuiltInDefinitions<T>(
  authoredDefinitions: T[],
  builtInDefinitions: T[],
  getId: (definition: T) => string,
  preserveAuthored?: (authored: T, builtIn: T) => T
): T[] {
  const nextDefinitions = [...authoredDefinitions];
  for (const builtInDefinition of builtInDefinitions) {
    const existingIndex = nextDefinitions.findIndex(
      (definition) => getId(definition) === getId(builtInDefinition)
    );
    if (existingIndex >= 0) {
      // When the user has the same-id authored definition on disk, default
      // behaviour is to replace it with the current built-in shape so
      // engine-side improvements (new fields, renamed defaults) propagate.
      // Callers that have user-editable fields on the built-in must opt in
      // via `preserveAuthored` to keep those fields when the merge happens.
      nextDefinitions[existingIndex] = preserveAuthored
        ? preserveAuthored(nextDefinitions[existingIndex]!, builtInDefinition)
        : builtInDefinition;
      continue;
    }
    nextDefinitions.push(builtInDefinition);
  }
  return nextDefinitions;
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

export function getMaterialDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): MaterialDefinition | null {
  return (
    contentLibrary.materialDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listMaterialDefinitions(
  contentLibrary: ContentLibrarySnapshot
): MaterialDefinition[] {
  return [...contentLibrary.materialDefinitions];
}

export function getSurfaceDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): SurfaceDefinition | null {
  return (
    (contentLibrary.surfaceDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listSurfaceDefinitions(
  contentLibrary: ContentLibrarySnapshot
): SurfaceDefinition[] {
  return [...(contentLibrary.surfaceDefinitions ?? [])];
}

export function getGrassTypeDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): GrassTypeDefinition | null {
  return (
    (contentLibrary.grassTypeDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listGrassTypeDefinitions(
  contentLibrary: ContentLibrarySnapshot
): GrassTypeDefinition[] {
  return [...(contentLibrary.grassTypeDefinitions ?? [])];
}

export function getFlowerTypeDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): FlowerTypeDefinition | null {
  return (
    (contentLibrary.flowerTypeDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listFlowerTypeDefinitions(
  contentLibrary: ContentLibrarySnapshot
): FlowerTypeDefinition[] {
  return [...(contentLibrary.flowerTypeDefinitions ?? [])];
}

export function getRockTypeDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): RockTypeDefinition | null {
  return (
    (contentLibrary.rockTypeDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listRockTypeDefinitions(
  contentLibrary: ContentLibrarySnapshot
): RockTypeDefinition[] {
  return [...(contentLibrary.rockTypeDefinitions ?? [])];
}

export function getTextureDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): TextureDefinition | null {
  return (
    contentLibrary.textureDefinitions.find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listTextureDefinitions(
  contentLibrary: ContentLibrarySnapshot
): TextureDefinition[] {
  return [...contentLibrary.textureDefinitions];
}

export function getMaskTextureDefinition(
  contentLibrary: ContentLibrarySnapshot,
  definitionId: string
): MaskTextureDefinition | null {
  return (
    (contentLibrary.maskTextureDefinitions ?? []).find(
      (definition) => definition.definitionId === definitionId
    ) ?? null
  );
}

export function listMaskTextureDefinitions(
  contentLibrary: ContentLibrarySnapshot
): MaskTextureDefinition[] {
  return [...(contentLibrary.maskTextureDefinitions ?? [])];
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

export function getShaderDefinition(
  contentLibrary: ContentLibrarySnapshot,
  shaderDefinitionId: string
): ShaderGraphDocument | null {
  return (
    contentLibrary.shaderDefinitions.find(
      (definition) => definition.shaderDefinitionId === shaderDefinitionId
    ) ?? null
  );
}

export function listShaderDefinitions(
  contentLibrary: ContentLibrarySnapshot
): ShaderGraphDocument[] {
  return [...contentLibrary.shaderDefinitions];
}
