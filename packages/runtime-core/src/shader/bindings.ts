/**
 * Shader binding resolution.
 *
 * Resolves canonical authored shader ownership into the effective binding data
 * that runtime targets consume. This keeps override policy in runtime-core and
 * keeps target hosts focused on applying already-resolved meaning.
 */

import type {
  AssetDefinition,
  ContentLibrarySnapshot,
  PlacedAssetInstance,
  PostProcessShaderBinding,
  RegionItemPresence,
  RegionNPCPresence,
  ShaderGraphDocument,
  ShaderParameterOverride
} from "@sugarmagic/domain";
import { getAssetDefinition, getShaderDefinition } from "@sugarmagic/domain";

export interface EffectiveShaderBinding {
  shaderDefinitionId: string;
  targetKind: ShaderGraphDocument["targetKind"];
  documentRevision: number;
  parameterValues: Record<string, unknown>;
  parameterOverrides: ShaderParameterOverride[];
}

function mergeParameters(
  definition: ShaderGraphDocument,
  overrides: ShaderParameterOverride[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const parameter of definition.parameters) {
    values[parameter.parameterId] = parameter.defaultValue;
  }
  for (const override of overrides) {
    values[override.parameterId] = override.value;
  }
  return values;
}

function resolveBindingForOwner(
  contentLibrary: ContentLibrarySnapshot,
  ownerAssetKind: AssetDefinition["assetKind"] | null,
  defaultShaderDefinitionId: string | null,
  overrideShaderDefinitionId: string | null,
  parameterOverrides: ShaderParameterOverride[]
): EffectiveShaderBinding | null {
  const shaderDefinitionId =
    overrideShaderDefinitionId ??
    defaultShaderDefinitionId ??
    (ownerAssetKind === "foliage"
      ? contentLibrary.shaderDefinitions.find(
          (definition) => definition.metadata.builtInKey === "foliage-wind"
        )?.shaderDefinitionId ?? null
      : null);
  if (!shaderDefinitionId) {
    return null;
  }

  const shaderDefinition = getShaderDefinition(contentLibrary, shaderDefinitionId);
  if (!shaderDefinition) {
    return null;
  }

  return {
    shaderDefinitionId,
    targetKind: shaderDefinition.targetKind,
    documentRevision: shaderDefinition.revision,
    parameterOverrides,
    parameterValues: mergeParameters(shaderDefinition, parameterOverrides)
  };
}

export function resolveEffectiveAssetShaderBinding(
  asset: PlacedAssetInstance,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding | null {
  const definition = getAssetDefinition(contentLibrary, asset.assetDefinitionId);
  return resolveBindingForOwner(
    contentLibrary,
    definition?.assetKind ?? null,
    definition?.defaultShaderDefinitionId ?? null,
    asset.shaderOverride?.shaderDefinitionId ?? null,
    asset.shaderParameterOverrides
  );
}

export function resolveEffectivePresenceShaderBinding(
  presence: Pick<
    RegionNPCPresence | RegionItemPresence,
    "shaderOverride" | "shaderParameterOverrides"
  >,
  assetDefinition: AssetDefinition | null,
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding | null {
  return resolveBindingForOwner(
    contentLibrary,
    assetDefinition?.assetKind ?? null,
    assetDefinition?.defaultShaderDefinitionId ?? null,
    presence.shaderOverride?.shaderDefinitionId ?? null,
    presence.shaderParameterOverrides
  );
}

export function resolveEffectivePostProcessShaderBindings(
  bindings: PostProcessShaderBinding[],
  contentLibrary: ContentLibrarySnapshot
): EffectiveShaderBinding[] {
  return bindings
    .map((binding) =>
      resolveBindingForOwner(
        contentLibrary,
        null,
        null,
        binding.shaderDefinitionId,
        binding.parameterOverrides
      )
    )
    .filter((binding): binding is EffectiveShaderBinding => binding !== null);
}
