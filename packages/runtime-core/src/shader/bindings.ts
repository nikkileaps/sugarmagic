/**
 * Shader binding resolution.
 *
 * Resolves canonical authored shader ownership into the effective binding data
 * that runtime targets consume. runtime-core is the single enforcer for slot
 * policy: defaults, overrides, and target-kind validation all land here so web
 * hosts only apply already-resolved meaning.
 */

import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  AssetSurfaceSlot,
  AppearanceContent,
  BlendMode,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  Mask,
  PlacedAssetInstance,
  PostProcessShaderBinding,
  RockTypeDefinition,
  RegionItemPresence,
  RegionNPCPresence,
  ScatterContent,
  ShaderOrMaterial,
  ShaderGraphDocument,
  ShaderParameterOverride,
  SurfaceBinding,
  SurfaceContext,
  ShaderSlotKind
} from "@sugarmagic/domain";
import {
  getAssetDefinition,
  getFlowerTypeDefinition,
  getGrassTypeDefinition,
  getMaterialDefinition,
  getRockTypeDefinition,
  getSurfaceDefinition,
  getShaderDefinition
} from "@sugarmagic/domain";

export interface EffectiveShaderBinding {
  shaderDefinitionId: string;
  targetKind: ShaderGraphDocument["targetKind"];
  documentRevision: number;
  parameterValues: Record<string, unknown>;
  textureBindings: Record<string, string>;
  parameterOverrides: ShaderParameterOverride[];
}

export interface EffectiveMaterialSlotBinding {
  slotName: string;
  slotIndex: number;
  materialDefinitionId: string | null;
  surface: ResolvedSurfaceStack | null;
}

interface ResolvedSurfaceLayerCommon {
  layerId: string;
  displayName: string;
  enabled: boolean;
  opacity: number;
  mask: Mask;
}

export interface ResolvedAppearanceLayer extends ResolvedSurfaceLayerCommon {
  kind: "appearance";
  blendMode: BlendMode;
  contentKind: AppearanceContent["kind"];
  binding: EffectiveShaderBinding;
}

export interface ResolvedEmissionLayer extends ResolvedSurfaceLayerCommon {
  kind: "emission";
  contentKind: "color" | "texture" | "material";
  intensity: number;
  binding: EffectiveShaderBinding;
}

export interface ResolvedScatterLayer extends ResolvedSurfaceLayerCommon {
  kind: "scatter";
  contentKind: ScatterContent["kind"];
  definitionId: string;
  definition: GrassTypeDefinition | FlowerTypeDefinition | RockTypeDefinition;
  shaderDefinitionId: string | null;
  materialDefinitionId: string | null;
  appearanceBinding: EffectiveShaderBinding | null;
  density: number;
  wind: EffectiveShaderBinding | null;
}

export type ResolvedSurfaceLayer =
  | ResolvedAppearanceLayer
  | ResolvedEmissionLayer
  | ResolvedScatterLayer;

export interface ResolvedSurfaceStack<
  C extends SurfaceContext = SurfaceContext
> {
  context: C;
  layers: ResolvedSurfaceLayer[];
  diagnostics: SurfaceResolverDiagnostic[];
  shaderDefinitionId?: string | null;
  targetKind?: ShaderGraphDocument["targetKind"] | null;
  parameterValues?: Record<string, unknown>;
  textureBindings?: Record<string, string>;
}

export interface ShaderBindingResolutionDiagnostic {
  severity: "error";
  slot: ShaderSlotKind;
  shaderDefinitionId: string | null;
  message: string;
}

export interface SurfaceResolverDiagnostic {
  severity: "error" | "warning";
  expectedTargetKind: ShaderGraphDocument["targetKind"];
  shaderDefinitionId: string | null;
  message: string;
}

export const SHADER_SLOT_TARGET_KINDS: Record<
  ShaderSlotKind,
  ShaderGraphDocument["targetKind"]
> = {
  surface: "mesh-surface",
  deform: "mesh-deform",
  effect: "mesh-effect"
};

export type EffectiveShaderBindingSet = {
  [K in ShaderSlotKind]: EffectiveShaderBinding | null;
};

export interface EffectiveShaderBindingResolution {
  bindings: EffectiveShaderBindingSet;
  materialSlots: EffectiveMaterialSlotBinding[];
  diagnostics: ShaderBindingResolutionDiagnostic[];
}

function createEmptyEffectiveShaderBindingSet(): EffectiveShaderBindingSet {
  return {
    surface: null,
    deform: null,
    effect: null
  };
}

function mergeParameters(
  definition: ShaderGraphDocument,
  overrides: ShaderParameterOverride[],
  slot: ShaderSlotKind,
  baseValues: Record<string, unknown> = {}
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const knownParameterIds = new Set(definition.parameters.map((parameter) => parameter.parameterId));
  for (const parameter of definition.parameters) {
    values[parameter.parameterId] = parameter.defaultValue;
  }
  for (const [parameterId, value] of Object.entries(baseValues)) {
    if (!knownParameterIds.has(parameterId)) {
      continue;
    }
    values[parameterId] = value;
  }
  for (const override of overrides) {
    if (override.slot && override.slot !== slot) {
      continue;
    }
    if (!knownParameterIds.has(override.parameterId)) {
      continue;
    }
    values[override.parameterId] = override.value;
  }
  return values;
}

function mergeTextureBindings(
  definition: ShaderGraphDocument,
  baseBindings: Record<string, string> = {}
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const parameter of definition.parameters) {
    if (parameter.dataType !== "texture2d") {
      continue;
    }

    const boundTextureId = baseBindings[parameter.parameterId];
    if (typeof boundTextureId === "string" && boundTextureId.trim().length > 0) {
      merged[parameter.parameterId] = boundTextureId;
      continue;
    }

    if (
      typeof parameter.defaultValue === "string" &&
      parameter.defaultValue.trim().length > 0
    ) {
      merged[parameter.parameterId] = parameter.defaultValue;
    }
  }

  return merged;
}

function selectParameterOverrides(
  definition: ShaderGraphDocument,
  overrides: ShaderParameterOverride[],
  slot: ShaderSlotKind
): ShaderParameterOverride[] {
  const knownParameterIds = new Set(definition.parameters.map((parameter) => parameter.parameterId));
  return overrides.filter((override) => {
    if (override.slot && override.slot !== slot) {
      return false;
    }
    return knownParameterIds.has(override.parameterId);
  });
}

function builtInShaderIdForKey(
  contentLibrary: ContentLibrarySnapshot,
  builtInKey: string
): string | null {
  return (
    contentLibrary.shaderDefinitions.find(
      (definition) => definition.metadata.builtInKey === builtInKey
    )?.shaderDefinitionId ?? null
  );
}

function resolveSlotBinding(
  contentLibrary: ContentLibrarySnapshot,
  slot: ShaderSlotKind,
  shaderDefinitionId: string | null,
  parameterOverrides: ShaderParameterOverride[],
  diagnostics: ShaderBindingResolutionDiagnostic[],
  options: {
    baseParameterValues?: Record<string, unknown>;
    textureBindings?: Record<string, string>;
  } = {}
): EffectiveShaderBinding | null {
  if (!shaderDefinitionId) {
    return null;
  }

  const shaderDefinition = getShaderDefinition(contentLibrary, shaderDefinitionId);
  if (!shaderDefinition) {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot,
      shaderDefinitionId,
      message: `Shader slot "${slot}" references missing shader "${shaderDefinitionId}".`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }
  if (shaderDefinition.targetKind !== SHADER_SLOT_TARGET_KINDS[slot]) {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot,
      shaderDefinitionId,
      message: `Shader "${shaderDefinitionId}" targets "${shaderDefinition.targetKind}" but slot "${slot}" requires "${SHADER_SLOT_TARGET_KINDS[slot]}".`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }

  const slotOverrides = selectParameterOverrides(shaderDefinition, parameterOverrides, slot);

  return {
    shaderDefinitionId,
    targetKind: shaderDefinition.targetKind,
    documentRevision: shaderDefinition.revision,
    parameterOverrides: slotOverrides,
    parameterValues: mergeParameters(
      shaderDefinition,
      parameterOverrides,
      slot,
      options.baseParameterValues
    ),
    textureBindings: mergeTextureBindings(shaderDefinition, options.textureBindings)
  };
}

/**
 * Public wrapper around the material-surface resolver. Returns the
 * EffectiveShaderBinding for a landscape-channel- or future-slot-level
 * material reference. Exposed (vs. the private in-context variant) so
 * consumers that don't own an asset or placement (landscape, material-
 * preview, etc.) can resolve a material directly. Diagnostics are
 * accumulated into the caller-provided array; callers not interested
 * in them can pass a fresh `[]`.
 */
export function resolveMaterialEffectiveShaderBinding(
  contentLibrary: ContentLibrarySnapshot,
  materialDefinitionId: string,
  parameterOverrides: ShaderParameterOverride[] = [],
  diagnostics: ShaderBindingResolutionDiagnostic[] = [],
  textureBindingOverrides: Record<string, string> = {},
  slot: ShaderSlotKind = "surface"
): EffectiveShaderBinding | null {
  return resolveMaterialSurfaceBinding(
    contentLibrary,
    materialDefinitionId,
    parameterOverrides,
    diagnostics,
    textureBindingOverrides,
    slot
  );
}

export type ResolveAppearanceLayerResult =
  | { ok: true; binding: EffectiveShaderBinding }
  | { ok: false; diagnostic: SurfaceResolverDiagnostic };

function surfaceDiagnostic(
  expectedTargetKind: ShaderGraphDocument["targetKind"],
  shaderDefinitionId: string | null,
  message: string
): ResolveAppearanceLayerResult {
  return {
    ok: false,
    diagnostic: {
      severity: "error",
      expectedTargetKind,
      shaderDefinitionId,
      message
    }
  };
}

function validateResolvedSurfaceTarget(
  binding: EffectiveShaderBinding | null,
  expectedTargetKind: ShaderGraphDocument["targetKind"]
): ResolveAppearanceLayerResult {
  if (!binding) {
    return surfaceDiagnostic(expectedTargetKind, null, "Surface slot could not be resolved.");
  }
  if (binding.targetKind !== expectedTargetKind) {
    return surfaceDiagnostic(
      expectedTargetKind,
      binding.shaderDefinitionId,
      `Shader "${binding.shaderDefinitionId}" targets "${binding.targetKind}" but this slot requires "${expectedTargetKind}".`
    );
  }
  return { ok: true, binding };
}

export function resolveAppearanceLayer(
  surface: AppearanceContent,
  contentLibrary: ContentLibrarySnapshot,
  expectedTargetKind: ShaderGraphDocument["targetKind"],
  parameterOverrides: ShaderParameterOverride[] = [],
  textureBindingOverrides: Record<string, string> = {}
): ResolveAppearanceLayerResult {
  if (surface.kind === "color") {
    const shaderDefinitionId = builtInShaderIdForKey(contentLibrary, "flat-color");
    if (!shaderDefinitionId) {
      return surfaceDiagnostic(expectedTargetKind, null, 'Missing built-in "flat-color" shader.');
    }
    return validateResolvedSurfaceTarget(
      resolveSlotBinding(
        contentLibrary,
        "surface",
        shaderDefinitionId,
        parameterOverrides,
        [],
        { baseParameterValues: { color: [(surface.color >> 16 & 0xff) / 255, (surface.color >> 8 & 0xff) / 255, (surface.color & 0xff) / 255] } }
      ),
      expectedTargetKind
    );
  }

  if (surface.kind === "texture") {
    const shaderDefinitionId = builtInShaderIdForKey(contentLibrary, "flat-texture");
    if (!shaderDefinitionId) {
      return surfaceDiagnostic(expectedTargetKind, null, 'Missing built-in "flat-texture" shader.');
    }
    return validateResolvedSurfaceTarget(
      resolveSlotBinding(
        contentLibrary,
        "surface",
        shaderDefinitionId,
        parameterOverrides,
        [],
        {
          baseParameterValues: { tiling: surface.tiling },
          textureBindings: { texture: surface.textureDefinitionId }
        }
      ),
      expectedTargetKind
    );
  }

  if (surface.kind === "material") {
    // Route the material resolution to the correct slot so the
    // shader's target-kind check doesn't falsely reject a mesh-deform
    // material bound as a wind deform (or a mesh-effect material).
    // Defaulting to "surface" would emit the misleading "shader X
    // targets mesh-deform but slot surface requires mesh-surface"
    // error that used to break Gentle Breeze et al.
    const materialSlot: ShaderSlotKind =
      expectedTargetKind === "mesh-deform"
        ? "deform"
        : expectedTargetKind === "mesh-effect"
          ? "effect"
          : "surface";
    return validateResolvedSurfaceTarget(
      resolveMaterialEffectiveShaderBinding(
        contentLibrary,
        surface.materialDefinitionId,
        parameterOverrides,
        [],
        textureBindingOverrides,
        materialSlot
      ),
      expectedTargetKind
    );
  }

  if (!getShaderDefinition(contentLibrary, surface.shaderDefinitionId)) {
    return surfaceDiagnostic(
      expectedTargetKind,
      surface.shaderDefinitionId,
      `Surface references missing shader "${surface.shaderDefinitionId}".`
    );
  }

  const slot =
    expectedTargetKind === "mesh-deform"
      ? "deform"
      : expectedTargetKind === "mesh-effect"
        ? "effect"
        : "surface";

  return validateResolvedSurfaceTarget(
    resolveSlotBinding(
      contentLibrary,
      slot,
      surface.shaderDefinitionId,
      parameterOverrides,
      [],
      {
        baseParameterValues: surface.parameterValues,
        textureBindings: surface.textureBindings
      }
    ),
    expectedTargetKind
  );
}

export type ResolveSurfaceBindingResult =
  | { ok: true; binding: ResolvedSurfaceStack }
  | { ok: false; diagnostic: SurfaceResolverDiagnostic };

function resolvedSurfaceDiagnostic(
  message: string,
  expectedTargetKind: ShaderGraphDocument["targetKind"] = "mesh-surface",
  shaderDefinitionId: string | null = null
): ResolveSurfaceBindingResult {
  return {
    ok: false,
    diagnostic: {
      severity: "error",
      expectedTargetKind,
      shaderDefinitionId,
      message
    }
  };
}

function resolveEmissionLayer(
  content: Extract<Layer, { kind: "emission" }>["content"],
  contentLibrary: ContentLibrarySnapshot
): ResolveAppearanceLayerResult {
  if (content.kind === "color") {
    const shaderDefinitionId = builtInShaderIdForKey(contentLibrary, "flat-color");
    if (!shaderDefinitionId) {
      return surfaceDiagnostic("mesh-surface", null, 'Missing built-in "flat-color" shader.');
    }
    return validateResolvedSurfaceTarget(
      resolveSlotBinding(contentLibrary, "surface", shaderDefinitionId, [], [], {
        baseParameterValues: {
          color: [
            ((content.color >> 16) & 0xff) / 255,
            ((content.color >> 8) & 0xff) / 255,
            (content.color & 0xff) / 255
          ]
        }
      }),
      "mesh-surface"
    );
  }
  if (content.kind === "texture") {
    const shaderDefinitionId = builtInShaderIdForKey(contentLibrary, "flat-texture");
    if (!shaderDefinitionId) {
      return surfaceDiagnostic("mesh-surface", null, 'Missing built-in "flat-texture" shader.');
    }
    return validateResolvedSurfaceTarget(
      resolveSlotBinding(contentLibrary, "surface", shaderDefinitionId, [], [], {
        baseParameterValues: { tiling: content.tiling },
        textureBindings: { texture: content.textureDefinitionId }
      }),
      "mesh-surface"
    );
  }
  return validateResolvedSurfaceTarget(
    resolveMaterialEffectiveShaderBinding(contentLibrary, content.materialDefinitionId, []),
    "mesh-surface"
  );
}

export function resolveScatterLayer(
  content: ScatterContent,
  contentLibrary: ContentLibrarySnapshot
): ResolvedScatterLayer["definition"] | null {
  if (content.kind === "grass") {
    return getGrassTypeDefinition(contentLibrary, content.grassTypeId);
  }
  if (content.kind === "flowers") {
    return getFlowerTypeDefinition(contentLibrary, content.flowerTypeId);
  }
  return getRockTypeDefinition(contentLibrary, content.rockTypeId);
}

function resolveScatterWind(
  definition: GrassTypeDefinition | FlowerTypeDefinition | RockTypeDefinition,
  layerDeform: ShaderOrMaterial | null | undefined,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding | null {
  // Scatter-layer-level `deform` binding wins when present — that's the
  // per-placement wind override ("Gentle Breeze" on this patch, "Gusty" on
  // that one). When it's absent, fall back to the type-level wind baked
  // into the grass / flower / rock definition so legacy surfaces continue
  // to sway unchanged.
  const source =
    layerDeform ?? ("wind" in definition ? definition.wind : null);
  if (!source) {
    return null;
  }
  const result = resolveAppearanceLayer(source, contentLibrary, "mesh-deform");
  return result.ok ? result.binding : null;
}

function resolveScatterAppearance(
  shaderDefinitionId: string | null,
  materialDefinitionId: string | null,
  contentLibrary: ContentLibrarySnapshot
): ResolveAppearanceLayerResult | null {
  const migratedShaderDefinitionId =
    shaderDefinitionId ??
    migrateLegacyScatterMaterialToShader(materialDefinitionId, contentLibrary);
  if (migratedShaderDefinitionId) {
    return resolveAppearanceLayer(
      {
        kind: "shader",
        shaderDefinitionId: migratedShaderDefinitionId,
        parameterValues: {},
        textureBindings: {}
      },
      contentLibrary,
      "mesh-surface"
    );
  }
  if (!materialDefinitionId) {
    return null;
  }
  return resolveAppearanceLayer(
    { kind: "material", materialDefinitionId },
    contentLibrary,
    "mesh-surface"
  );
}

function migrateLegacyScatterMaterialToShader(
  materialDefinitionId: string | null,
  contentLibrary: ContentLibrarySnapshot
): string | null {
  if (!materialDefinitionId) {
    return null;
  }
  const shaderDefinitionId = materialDefinitionId.replace(":material:", ":shader:");
  return getShaderDefinition(contentLibrary, shaderDefinitionId)
    ? shaderDefinitionId
    : null;
}

/**
 * Pick the canonical "ground color" of a Surface for inheritance purposes:
 * the first appearance layer in author order whose blend is "base" and whose
 * content is color-kind. Texture/material/shader bases return null — those
 * don't resolve to one flat color at authoring time, so the scatter shader's
 * own default wins instead of guessing.
 */
function pickSurfaceBaseColor(layers: readonly Layer[]): [number, number, number] | null {
  for (const layer of layers) {
    if (layer.kind !== "appearance") continue;
    if (layer.blendMode !== "base") continue;
    if (layer.content.kind !== "color") return null;
    return hexToRgbTuple(layer.content.color);
  }
  return null;
}

function hexToRgbTuple(color: number): [number, number, number] {
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255
  ];
}

function materialScalarBindingValues(
  materialDefinition: NonNullable<ReturnType<typeof getMaterialDefinition>>
): Record<string, unknown> {
  const pbr = materialDefinition.pbr;
  return {
    color: hexToRgbTuple(pbr.baseColor),
    roughness: pbr.roughness,
    metallic: pbr.metallic
  };
}

function materialTextureBindingValues(
  materialDefinition: NonNullable<ReturnType<typeof getMaterialDefinition>>
): {
  shaderKey: string;
  parameterValues: Record<string, unknown>;
  textureBindings: Record<string, string>;
} {
  const pbr = materialDefinition.pbr;
  const tiling = pbr.tiling;
  if (pbr.baseColorMap && pbr.normalMap && pbr.ormMap) {
    return {
      shaderKey: "standard-pbr",
      parameterValues: {
        tiling,
        roughness_scale: pbr.roughness,
        metallic_scale: pbr.metallic
      },
      textureBindings: {
        basecolor_texture: pbr.baseColorMap,
        normal_texture: pbr.normalMap,
        orm_texture: pbr.ormMap
      }
    };
  }
  if (
    pbr.baseColorMap &&
    pbr.normalMap &&
    pbr.roughnessMap &&
    pbr.metallicMap &&
    pbr.ambientOcclusionMap
  ) {
    return {
      shaderKey: "standard-pbr-separate",
      parameterValues: {
        tiling,
        roughness_scale: pbr.roughness,
        metallic_scale: pbr.metallic
      },
      textureBindings: {
        basecolor_texture: pbr.baseColorMap,
        normal_texture: pbr.normalMap,
        roughness_texture: pbr.roughnessMap,
        metallic_texture: pbr.metallicMap,
        ao_texture: pbr.ambientOcclusionMap
      }
    };
  }
  // Partial-map fallback: material has a baseColorMap but not the
  // full standard-pbr / standard-pbr-separate map set. Route to
  // flat-texture so the basecolor texture (including its alpha,
  // load-bearing for foliage cutout) actually reaches the renderer.
  // Without this case, foliage import materials (which only set
  // baseColorMap) fall through to material-pbr (scalar-only,
  // textureBindings: {}) and the leaf texture is silently dropped
  // from the rendered model.
  if (pbr.baseColorMap) {
    return {
      shaderKey: "flat-texture",
      parameterValues: {
        tiling
      },
      textureBindings: {
        texture: pbr.baseColorMap
      }
    };
  }
  return {
    shaderKey: "material-pbr",
    parameterValues: materialScalarBindingValues(materialDefinition),
    textureBindings: {}
  };
}

/**
 * Inject the containing Surface's base color into scatter-shader parameters
 * that opted in with `inheritSource: "baseLayerColor"`, but only if the
 * author hasn't already set that parameter explicitly in the material's
 * parameterValues. Explicit author intent always beats inheritance.
 */
function applyBaseLayerColorInheritance(
  binding: EffectiveShaderBinding,
  baseColor: [number, number, number] | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding {
  if (!baseColor) return binding;
  const shader = getShaderDefinition(contentLibrary, binding.shaderDefinitionId);
  if (!shader) return binding;
  let nextParameterValues: Record<string, unknown> | null = null;
  for (const parameter of shader.parameters) {
    if (parameter.inheritSource !== "baseLayerColor") continue;
    if (parameter.dataType !== "color") continue;
    if (parameter.parameterId in binding.parameterValues) continue;
    if (!nextParameterValues) {
      nextParameterValues = { ...binding.parameterValues };
    }
    nextParameterValues[parameter.parameterId] = baseColor;
  }
  if (!nextParameterValues) return binding;
  return { ...binding, parameterValues: nextParameterValues };
}

function surfaceStackFromBinding(
  binding: EffectiveShaderBinding
): ResolvedSurfaceStack<"universal"> {
  return {
    context: "universal",
    diagnostics: [],
    shaderDefinitionId: binding.shaderDefinitionId,
    targetKind: binding.targetKind,
    parameterValues: binding.parameterValues,
    textureBindings: binding.textureBindings,
    layers: [
      {
        kind: "appearance",
        layerId: "fallback-surface",
        displayName: "Surface",
        enabled: true,
        opacity: 1,
        mask: { kind: "always" },
        blendMode: "base",
        contentKind: "shader",
        binding
      }
    ]
  };
}

export function resolveSurfaceBinding(
  binding: SurfaceBinding,
  contentLibrary: ContentLibrarySnapshot,
  callerContext: SurfaceContext,
  parameterOverrides: ShaderParameterOverride[] = []
): ResolveSurfaceBindingResult {
  const surface =
    binding.kind === "reference"
      ? getSurfaceDefinition(contentLibrary, binding.surfaceDefinitionId)?.surface ?? null
      : binding.surface;

  if (!surface) {
    return resolvedSurfaceDiagnostic(
      binding.kind === "reference"
        ? `Surface binding references missing SurfaceDefinition "${binding.surfaceDefinitionId}".`
        : "Inline surface binding is missing its surface."
    );
  }

  if (callerContext === "universal" && surface.context !== "universal") {
    return resolvedSurfaceDiagnostic(
      "Landscape-only surfaces cannot bind to universal slots."
    );
  }

  const resolvedLayers: ResolvedSurfaceLayer[] = [];
  const diagnostics: SurfaceResolverDiagnostic[] = [];

  // Ground-color inheritance for scatter shaders: resolve the containing
  // Surface's canonical base color once so scatter layers whose appearance
  // shader declares a `baseLayerColor`-inheriting parameter can auto-bind
  // their root tint without per-scene authoring. A color-kind base appearance
  // layer is the only source that resolves; textures/materials/shaders stay
  // null and leave the shader parameter's own default in effect.
  const surfaceBaseColor = pickSurfaceBaseColor(surface.layers);

  for (const layer of surface.layers) {
    const effectiveLayer = layer;

    if (effectiveLayer.kind === "appearance") {
      const result = resolveAppearanceLayer(
        effectiveLayer.content,
        contentLibrary,
        "mesh-surface",
        parameterOverrides,
        {}
      );
      if (!result.ok) {
        return resolvedSurfaceDiagnostic(
          result.diagnostic.message,
          result.diagnostic.expectedTargetKind,
          result.diagnostic.shaderDefinitionId
        );
      }
      resolvedLayers.push({
        kind: "appearance",
        layerId: effectiveLayer.layerId,
        displayName: effectiveLayer.displayName,
        enabled: effectiveLayer.enabled,
        opacity: effectiveLayer.opacity,
        mask: effectiveLayer.mask,
        blendMode: effectiveLayer.blendMode,
        contentKind: effectiveLayer.content.kind,
        binding: result.binding
      });
      continue;
    }

    if (effectiveLayer.kind === "emission") {
      const result = resolveEmissionLayer(effectiveLayer.content, contentLibrary);
      if (!result.ok) {
        return resolvedSurfaceDiagnostic(
          result.diagnostic.message,
          result.diagnostic.expectedTargetKind,
          result.diagnostic.shaderDefinitionId
        );
      }
      resolvedLayers.push({
        kind: "emission",
        layerId: effectiveLayer.layerId,
        displayName: effectiveLayer.displayName,
        enabled: effectiveLayer.enabled,
        opacity: effectiveLayer.opacity,
        mask: effectiveLayer.mask,
        contentKind: effectiveLayer.content.kind,
        intensity:
          effectiveLayer.content.kind === "material"
            ? 1
            : effectiveLayer.content.intensity,
        binding: result.binding
      });
      continue;
    }

    const definition = resolveScatterLayer(effectiveLayer.content, contentLibrary);
    if (!definition) {
      return resolvedSurfaceDiagnostic(
        effectiveLayer.content.kind === "grass"
          ? `Scatter layer references missing GrassTypeDefinition "${effectiveLayer.content.grassTypeId}".`
          : effectiveLayer.content.kind === "flowers"
            ? `Scatter layer references missing FlowerTypeDefinition "${effectiveLayer.content.flowerTypeId}".`
            : `Scatter layer references missing RockTypeDefinition "${effectiveLayer.content.rockTypeId}".`
      );
    }
    const resolvedAppearance = resolveScatterAppearance(
      effectiveLayer.shaderDefinitionId ?? null,
      effectiveLayer.materialDefinitionId,
      contentLibrary
    );
    if (resolvedAppearance && !resolvedAppearance.ok) {
      return resolvedSurfaceDiagnostic(
        resolvedAppearance.diagnostic.message,
        resolvedAppearance.diagnostic.expectedTargetKind,
        resolvedAppearance.diagnostic.shaderDefinitionId
      );
    }
    const scatterAppearanceBinding = resolvedAppearance?.ok
      ? applyBaseLayerColorInheritance(
          resolvedAppearance.binding,
          surfaceBaseColor,
          contentLibrary
        )
      : null;
    resolvedLayers.push({
      kind: "scatter",
      layerId: effectiveLayer.layerId,
      displayName: effectiveLayer.displayName,
      enabled: effectiveLayer.enabled,
      opacity: effectiveLayer.opacity,
      mask: effectiveLayer.mask,
      contentKind: effectiveLayer.content.kind,
      definitionId: definition.definitionId,
      definition,
      shaderDefinitionId: scatterAppearanceBinding?.shaderDefinitionId ?? null,
      materialDefinitionId: effectiveLayer.materialDefinitionId,
      appearanceBinding: scatterAppearanceBinding,
      density: Math.max(
        0,
        "density" in definition ? definition.density : 0
      ),
      wind: resolveScatterWind(definition, effectiveLayer.deform ?? null, contentLibrary)
    });
  }

  return {
    ok: true,
    binding: {
      context: surface.context,
      layers: resolvedLayers,
      diagnostics,
      shaderDefinitionId:
        resolvedLayers.find((layer): layer is ResolvedAppearanceLayer => layer.kind === "appearance")
          ?.binding.shaderDefinitionId ?? null,
      targetKind:
        resolvedLayers.find((layer): layer is ResolvedAppearanceLayer => layer.kind === "appearance")
          ?.binding.targetKind ?? null,
      parameterValues:
        resolvedLayers.find((layer): layer is ResolvedAppearanceLayer => layer.kind === "appearance")
          ?.binding.parameterValues ?? {},
      textureBindings:
        resolvedLayers.find((layer): layer is ResolvedAppearanceLayer => layer.kind === "appearance")
          ?.binding.textureBindings ?? {}
    }
  };
}

function resolveMaterialSurfaceBinding(
  contentLibrary: ContentLibrarySnapshot,
  materialDefinitionId: string,
  parameterOverrides: ShaderParameterOverride[],
  diagnostics: ShaderBindingResolutionDiagnostic[],
  textureBindingOverrides: Record<string, string> = {},
  slot: ShaderSlotKind = "surface"
): EffectiveShaderBinding | null {
  const materialDefinition = getMaterialDefinition(contentLibrary, materialDefinitionId);
  if (!materialDefinition) {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot,
      shaderDefinitionId: null,
      message: `Material slot references missing material "${materialDefinitionId}".`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }
  if (slot !== "surface") {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot,
      shaderDefinitionId: null,
      message: `Material "${materialDefinitionId}" is a PBR surface material and cannot be bound to the "${slot}" shader slot.`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }

  const materialBinding = materialTextureBindingValues(materialDefinition);
  const shaderDefinitionId = builtInShaderIdForKey(
    contentLibrary,
    materialBinding.shaderKey
  );
  if (!shaderDefinitionId) {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot,
      shaderDefinitionId: null,
      message: `Material "${materialDefinitionId}" requires built-in shader "${materialBinding.shaderKey}", but it is missing.`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }

  return resolveSlotBinding(
    contentLibrary,
    slot,
    shaderDefinitionId,
    parameterOverrides,
    diagnostics,
    {
      baseParameterValues: materialBinding.parameterValues,
      textureBindings: {
        ...materialBinding.textureBindings,
        ...textureBindingOverrides
      }
    }
  );
}

function resolveBindingSetForOwner(
  contentLibrary: ContentLibrarySnapshot,
  ownerAssetDefinition: AssetDefinition | null,
  overrides: {
    shaderOverrides: { shaderDefinitionId: string; slot: ShaderSlotKind }[];
    shaderParameterOverrides: ShaderParameterOverride[];
  }
): EffectiveShaderBindingResolution {
  const bindingSet = createEmptyEffectiveShaderBindingSet();
  const diagnostics: ShaderBindingResolutionDiagnostic[] = [];
  const overrideBySlot = new Map(
    overrides.shaderOverrides.map((override) => [override.slot, override.shaderDefinitionId])
  );

  for (const slot of Object.keys(SHADER_SLOT_TARGET_KINDS) as ShaderSlotKind[]) {
    const overrideShaderDefinitionId = overrideBySlot.get(slot) ?? null;
    if (overrideShaderDefinitionId) {
      bindingSet[slot] = resolveSlotBinding(
        contentLibrary,
        slot,
        overrideShaderDefinitionId,
        overrides.shaderParameterOverrides,
        diagnostics
      );
      continue;
    }

    const hostSurface: ShaderOrMaterial | null =
      slot === "deform"
        ? ownerAssetDefinition?.deform ?? null
        : slot === "effect"
          ? ownerAssetDefinition?.effect ?? null
          : null;
    if (!hostSurface) {
      bindingSet[slot] = null;
      continue;
    }
    const result = resolveAppearanceLayer(
      hostSurface,
      contentLibrary,
      SHADER_SLOT_TARGET_KINDS[slot]
    );
    bindingSet[slot] = result.ok ? result.binding : null;
    if (!result.ok) {
      diagnostics.push({
        severity: "error",
        slot,
        shaderDefinitionId: result.diagnostic.shaderDefinitionId,
        message: result.diagnostic.message
      });
    }
  }

  const materialSlots = resolveSurfaceSlotBindings(
    contentLibrary,
    ownerAssetDefinition?.surfaceSlots ?? [],
    bindingSet.surface,
    overrides.shaderParameterOverrides,
    diagnostics
  );

  return {
    bindings: bindingSet,
    materialSlots,
    diagnostics
  };
}

function resolveSurfaceSlotBindings(
  contentLibrary: ContentLibrarySnapshot,
  slotBindings: AssetSurfaceSlot[],
  fallbackSurface: EffectiveShaderBinding | null,
  parameterOverrides: ShaderParameterOverride[],
  diagnostics: ShaderBindingResolutionDiagnostic[]
): EffectiveMaterialSlotBinding[] {
  return slotBindings.map((slotBinding) => {
    if (!slotBinding.surface) {
      return {
        slotName: slotBinding.slotName,
        slotIndex: slotBinding.slotIndex,
        materialDefinitionId: null,
        surface: fallbackSurface ? surfaceStackFromBinding(fallbackSurface) : null
      };
    }
    const result = resolveSurfaceBinding(
      slotBinding.surface,
      contentLibrary,
      "universal",
      parameterOverrides
    );
    if (!result.ok) {
      diagnostics.push({
        severity: "error",
        slot: "surface",
        shaderDefinitionId: result.diagnostic.shaderDefinitionId,
        message: result.diagnostic.message
      });
    }
    return {
      slotName: slotBinding.slotName,
      slotIndex: slotBinding.slotIndex,
      materialDefinitionId:
        slotBinding.surface.kind === "reference"
          ? null
          : (
              slotBinding.surface.surface.layers.find(
                (
                  layer
                ): layer is Extract<Layer, { kind: "appearance" }> & {
                  content: Extract<AppearanceContent, { kind: "material" }>;
                } => layer.kind === "appearance" && layer.content.kind === "material"
              )?.content.materialDefinitionId ?? null
            ),
      surface:
        result.ok
          ? result.binding
          : fallbackSurface
            ? surfaceStackFromBinding(fallbackSurface)
            : null
    };
  });
}

export function resolveAssetDefinitionShaderBindings(
  assetDefinition: AssetDefinition,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBindingResolution {
  return resolveBindingSetForOwner(contentLibrary, assetDefinition, {
    shaderOverrides: [],
    shaderParameterOverrides: []
  });
}

export function resolveEffectiveAssetShaderBindings(
  asset: PlacedAssetInstance,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBindingSet {
  const definition = getAssetDefinition(contentLibrary, asset.assetDefinitionId);
  return resolveBindingSetForOwner(contentLibrary, definition, {
    shaderOverrides: asset.shaderOverrides ?? [],
    shaderParameterOverrides: asset.shaderParameterOverrides
  }).bindings;
}

export function resolveEffectiveAssetMaterialSlotBindings(
  asset: PlacedAssetInstance,
  contentLibrary: ContentLibrarySnapshot
): EffectiveMaterialSlotBinding[] {
  const definition = getAssetDefinition(contentLibrary, asset.assetDefinitionId);
  return resolveBindingSetForOwner(contentLibrary, definition, {
    shaderOverrides: asset.shaderOverrides ?? [],
    shaderParameterOverrides: asset.shaderParameterOverrides
  }).materialSlots;
}

export function resolveEffectivePresenceShaderBindings(
  presence: Pick<
    RegionNPCPresence | RegionItemPresence,
    "shaderOverrides" | "shaderParameterOverrides"
  >,
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBindingSet {
  return resolveBindingSetForOwner(contentLibrary, assetDefinition, {
    shaderOverrides: presence.shaderOverrides ?? [],
    shaderParameterOverrides: presence.shaderParameterOverrides
  }).bindings;
}

export function resolveEffectivePresenceMaterialSlotBindings(
  presence: Pick<
    RegionNPCPresence | RegionItemPresence,
    "shaderOverrides" | "shaderParameterOverrides"
  >,
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveMaterialSlotBinding[] {
  return resolveBindingSetForOwner(contentLibrary, assetDefinition, {
    shaderOverrides: presence.shaderOverrides ?? [],
    shaderParameterOverrides: presence.shaderParameterOverrides
  }).materialSlots;
}

export function resolveEffectiveAssetShaderBinding(
  asset: PlacedAssetInstance,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding | null {
  const bindings = resolveEffectiveAssetShaderBindings(asset, contentLibrary);
  return bindings.surface ?? bindings.deform;
}

export function resolveEffectivePresenceShaderBinding(
  presence: Pick<
    RegionNPCPresence | RegionItemPresence,
    "shaderOverrides" | "shaderParameterOverrides"
  >,
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding | null {
  const bindings = resolveEffectivePresenceShaderBindings(
    presence,
    assetDefinition,
    contentLibrary
  );
  return bindings.surface ?? bindings.deform;
}

export function resolveEffectivePostProcessShaderBindings(
  bindings: PostProcessShaderBinding[],
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding[] {
  return bindings
    .map((binding) => {
      const shaderDefinition = getShaderDefinition(
        contentLibrary,
        binding.shaderDefinitionId
      );
      if (!shaderDefinition) {
        return null;
      }
      return {
        shaderDefinitionId: binding.shaderDefinitionId,
        targetKind: shaderDefinition.targetKind,
        documentRevision: shaderDefinition.revision,
        parameterOverrides: binding.parameterOverrides,
        textureBindings: {},
        parameterValues: mergeParameters(
          shaderDefinition,
          binding.parameterOverrides,
          "surface"
        )
      } satisfies EffectiveShaderBinding;
    })
    .filter((binding): binding is EffectiveShaderBinding => binding !== null);
}
