/**
 * Built-in PBR MaterialDefinition starter content for fresh projects.
 *
 * Materials are reusable physical appearance presets only: base color,
 * scalar PBR values, optional texture maps, and tiling. Executable shader
 * graphs live in the shader library and are referenced directly by surface
 * shader layers, scatter appearance, deform, effect, and post-process slots.
 */

import type { MaterialDefinition, MaterialPbrDefinition } from "../index";

function materialId(projectId: string, slug: string): string {
  return `${projectId}:material:${slug}`;
}

export function getBuiltInWoodMaterialId(projectId: string): string {
  return materialId(projectId, "wood");
}

export function getBuiltInMetalMaterialId(projectId: string): string {
  return materialId(projectId, "metal");
}

export function getBuiltInStoneMaterialId(projectId: string): string {
  return materialId(projectId, "stone");
}

export function getBuiltInPlasterMaterialId(projectId: string): string {
  return materialId(projectId, "plaster");
}

export function getBuiltInBarkMaterialId(projectId: string): string {
  return materialId(projectId, "bark");
}

export function getBuiltInPlainPaintedMaterialId(projectId: string): string {
  return materialId(projectId, "plain-painted");
}

function makeMaterial(
  definitionId: string,
  displayName: string,
  builtInKey: string,
  pbr: Partial<MaterialPbrDefinition>
): MaterialDefinition {
  const materialPbr: MaterialPbrDefinition = {
    baseColor: 0x808080,
    baseColorMap: null,
    normalMap: null,
    ormMap: null,
    roughnessMap: null,
    metallicMap: null,
    ambientOcclusionMap: null,
    roughness: 0.7,
    metallic: 0,
    ambientOcclusion: 1,
    emissiveColor: 0x000000,
    emissiveIntensity: 0,
    emissiveMap: null,
    tiling: [1, 1],
    ...pbr
  };
  return {
    definitionId,
    definitionKind: "material",
    displayName,
    pbr: materialPbr,
    metadata: { builtIn: true, builtInKey }
  };
}

export function createBuiltInMaterialDefinitions(
  projectId: string
): MaterialDefinition[] {
  return [
    makeMaterial(getBuiltInWoodMaterialId(projectId), "Wood", "wood", {
      baseColor: 0x8a5933,
      roughness: 0.58,
      metallic: 0
    }),
    makeMaterial(getBuiltInMetalMaterialId(projectId), "Metal", "metal", {
      baseColor: 0x9aa0a6,
      roughness: 0.32,
      metallic: 1
    }),
    makeMaterial(getBuiltInStoneMaterialId(projectId), "Stone", "stone", {
      baseColor: 0x8c8a80,
      roughness: 0.88,
      metallic: 0
    }),
    makeMaterial(getBuiltInPlasterMaterialId(projectId), "Plaster", "plaster", {
      baseColor: 0xcbbf9f,
      roughness: 0.92,
      metallic: 0
    }),
    makeMaterial(getBuiltInBarkMaterialId(projectId), "Bark", "bark", {
      baseColor: 0x6f4b34,
      roughness: 0.82,
      metallic: 0
    }),
    makeMaterial(
      getBuiltInPlainPaintedMaterialId(projectId),
      "Plain Painted",
      "plain-painted",
      {
        baseColor: 0xd8d0b0,
        roughness: 0.64,
        metallic: 0
      }
    )
  ];
}
