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
  MaterialSlotBinding,
  PlacedAssetInstance,
  PostProcessShaderBinding,
  RegionItemPresence,
  RegionNPCPresence,
  ShaderGraphDocument,
  ShaderParameterOverride,
  ShaderSlotBindingMap,
  ShaderSlotKind
} from "@sugarmagic/domain";
import {
  createEmptyShaderSlotBindingMap,
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

export const SHADER_SLOT_TARGET_KINDS: Record<
  ShaderSlotKind,
  ShaderGraphDocument["targetKind"]
> = {
  surface: "mesh-surface",
  deform: "mesh-deform"
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
    deform: null
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

function selectDefaultSlotBindings(
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): ShaderSlotBindingMap {
  const defaults = {
    ...createEmptyShaderSlotBindingMap(),
    ...(assetDefinition?.defaultShaderBindings ?? {})
  };

  if (assetDefinition?.assetKind === "foliage") {
    defaults.surface =
      defaults.surface ??
      contentLibrary.shaderDefinitions.find(
        (definition) => definition.metadata.builtInKey === "foliage-surface"
      )?.shaderDefinitionId ??
      null;
    defaults.deform =
      defaults.deform ??
      contentLibrary.shaderDefinitions.find(
        (definition) => definition.metadata.builtInKey === "foliage-wind"
      )?.shaderDefinitionId ??
      null;
  }

  return defaults;
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
  const defaultBindings = selectDefaultSlotBindings(ownerAssetDefinition, contentLibrary);
  const overrideBySlot = new Map(
    overrides.shaderOverrides.map((override) => [override.slot, override.shaderDefinitionId])
  );

  const combinedParameterOverrides = [
    ...(ownerAssetDefinition?.defaultShaderParameterOverrides ?? []),
    ...overrides.shaderParameterOverrides
  ];

  for (const slot of Object.keys(SHADER_SLOT_TARGET_KINDS) as ShaderSlotKind[]) {
    const shaderDefinitionId =
      overrideBySlot.get(slot) ?? defaultBindings[slot] ?? null;
    bindingSet[slot] = resolveSlotBinding(
      contentLibrary,
      slot,
      shaderDefinitionId,
      combinedParameterOverrides,
      diagnostics
    );
  }

  const materialSlots = resolveMaterialSlotBindings(
    contentLibrary,
    ownerAssetDefinition?.materialSlotBindings ?? [],
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

function resolveMaterialSlotBindings(
  contentLibrary: ContentLibrarySnapshot,
  slotBindings: MaterialSlotBinding[],
  fallbackSurface: EffectiveShaderBinding | null,
  parameterOverrides: ShaderParameterOverride[],
  diagnostics: ShaderBindingResolutionDiagnostic[]
): EffectiveMaterialSlotBinding[] {
  return slotBindings.map((slotBinding) => {
    if (!slotBinding.materialDefinitionId) {
      return {
        slotName: slotBinding.slotName,
        slotIndex: slotBinding.slotIndex,
        materialDefinitionId: null,
        surface: fallbackSurface
      };
    }

    return {
      slotName: slotBinding.slotName,
      slotIndex: slotBinding.slotIndex,
      materialDefinitionId: slotBinding.materialDefinitionId,
      surface: resolveMaterialSurfaceBinding(
        contentLibrary,
        slotBinding.materialDefinitionId,
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
