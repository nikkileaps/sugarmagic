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
  PlacedAssetInstance,
  PostProcessShaderBinding,
  RegionItemPresence,
  RegionNPCPresence,
  ShaderOrMaterial,
  ShaderGraphDocument,
  ShaderParameterOverride,
  Surface,
  ShaderSlotKind
} from "@sugarmagic/domain";
import {
  getAssetDefinition,
  getMaterialDefinition,
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
  surface: EffectiveShaderBinding | null;
}

export interface ShaderBindingResolutionDiagnostic {
  severity: "error";
  slot: ShaderSlotKind;
  shaderDefinitionId: string | null;
  message: string;
}

export interface SurfaceResolverDiagnostic {
  severity: "error";
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
  diagnostics: ShaderBindingResolutionDiagnostic[] = []
): EffectiveShaderBinding | null {
  return resolveMaterialSurfaceBinding(
    contentLibrary,
    materialDefinitionId,
    [],
    diagnostics
  );
}

export type ResolveSurfaceResult =
  | { ok: true; binding: EffectiveShaderBinding }
  | { ok: false; diagnostic: SurfaceResolverDiagnostic };

function surfaceDiagnostic(
  expectedTargetKind: ShaderGraphDocument["targetKind"],
  shaderDefinitionId: string | null,
  message: string
): ResolveSurfaceResult {
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
): ResolveSurfaceResult {
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

export function resolveSurface(
  surface: Surface,
  contentLibrary: ContentLibrarySnapshot,
  expectedTargetKind: ShaderGraphDocument["targetKind"]
): ResolveSurfaceResult {
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
        [],
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
        [],
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
    return validateResolvedSurfaceTarget(
      resolveMaterialEffectiveShaderBinding(contentLibrary, surface.materialDefinitionId, []),
      expectedTargetKind
    );
  }

  const definition = getShaderDefinition(contentLibrary, surface.shaderDefinitionId);
  if (!definition) {
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
      [],
      [],
      {
        baseParameterValues: surface.parameterValues,
        textureBindings: surface.textureBindings
      }
    ),
    expectedTargetKind
  );
}

function resolveMaterialSurfaceBinding(
  contentLibrary: ContentLibrarySnapshot,
  materialDefinitionId: string,
  parameterOverrides: ShaderParameterOverride[],
  diagnostics: ShaderBindingResolutionDiagnostic[]
): EffectiveShaderBinding | null {
  const materialDefinition = getMaterialDefinition(contentLibrary, materialDefinitionId);
  if (!materialDefinition) {
    const diagnostic: ShaderBindingResolutionDiagnostic = {
      severity: "error",
      slot: "surface",
      shaderDefinitionId: null,
      message: `Material slot references missing material "${materialDefinitionId}".`
    };
    diagnostics.push(diagnostic);
    console.error(`[ShaderBindings] ${diagnostic.message}`);
    return null;
  }

  return resolveSlotBinding(
    contentLibrary,
    "surface",
    materialDefinition.shaderDefinitionId,
    parameterOverrides,
    diagnostics,
    {
      baseParameterValues: materialDefinition.parameterValues,
      textureBindings: materialDefinition.textureBindings
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

    const hostSurface: Surface | ShaderOrMaterial | null =
      slot === "deform"
        ? ownerAssetDefinition?.deform ?? null
        : slot === "effect"
          ? ownerAssetDefinition?.effect ?? null
          : null;
    if (!hostSurface) {
      bindingSet[slot] = null;
      continue;
    }
    const result = resolveSurface(
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
        surface: fallbackSurface
      };
    }

    if (slotBinding.surface.kind !== "material") {
      const result = resolveSurface(slotBinding.surface, contentLibrary, "mesh-surface");
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
        materialDefinitionId: null,
        surface: result.ok ? result.binding : fallbackSurface
      };
    }

    return {
      slotName: slotBinding.slotName,
      slotIndex: slotBinding.slotIndex,
      materialDefinitionId: slotBinding.surface.materialDefinitionId,
      surface: resolveMaterialSurfaceBinding(
        contentLibrary,
        slotBinding.surface.materialDefinitionId,
        parameterOverrides,
        diagnostics
      )
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
