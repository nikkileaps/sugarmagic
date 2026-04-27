/**
 * Scatter LOD domain types.
 *
 * Owns the authored LOD configuration for scatter-content definitions.
 * These types stay in the domain layer because grass/flower/rock type
 * definitions are the single source of truth for authored scatter behavior;
 * render-web consumes the already-authored meaning and realizes it.
 */

export type LodMeshSpec =
  | { kind: "procedural-default" }
  | {
      kind: "procedural-reduced";
      /**
       * Fraction of the near mesh's procedural detail budget to keep.
       * `1` means full detail, `0.5` means roughly half-detail.
       */
      vertexBudget: number;
    }
  | { kind: "billboard" }
  | {
      kind: "asset-reference";
      assetDefinitionId: string;
    };

export interface ScatterLodMeshes {
  near: LodMeshSpec;
  far?: LodMeshSpec | null;
  billboard?: LodMeshSpec | null;
}

export interface ScatterLodDefinition {
  lodMeshes: ScatterLodMeshes;
  lod1Distance: number;
  lod2Distance: number;
  lodTransitionWidth: number;
  distantMeshThreshold: number;
  maxDrawDistance: number;
}

export function cloneLodMeshSpec(spec: LodMeshSpec): LodMeshSpec {
  if (spec.kind === "procedural-reduced") {
    return {
      kind: "procedural-reduced",
      vertexBudget: spec.vertexBudget
    };
  }
  if (spec.kind === "asset-reference") {
    return {
      kind: "asset-reference",
      assetDefinitionId: spec.assetDefinitionId
    };
  }
  return { kind: spec.kind };
}

export function cloneScatterLodMeshes(meshes: ScatterLodMeshes): ScatterLodMeshes {
  return {
    near: cloneLodMeshSpec(meshes.near),
    far: meshes.far ? cloneLodMeshSpec(meshes.far) : meshes.far ?? null,
    billboard: meshes.billboard
      ? cloneLodMeshSpec(meshes.billboard)
      : meshes.billboard ?? null
  };
}
