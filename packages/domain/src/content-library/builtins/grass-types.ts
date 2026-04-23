/**
 * Built-in GrassType definitions for fresh projects.
 *
 * Owns the starter scatter content shipped in every default content library so
 * authors can preview and use surface stacks immediately without importing
 * custom grass assets first.
 */

import {
  createDefaultGrassTypeDefinition,
  type GrassTypeDefinition
} from "../../surface";

export function createBuiltInGrassTypeDefinitions(
  projectId: string
): GrassTypeDefinition[] {
  const wind = {
    kind: "shader" as const,
    shaderDefinitionId: `${projectId}:shader:foliage-wind`,
    parameterValues: {},
    textureBindings: {}
  };
  return [
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:short-lawn`,
      displayName: "Short Lawn",
      density: 22,
      tipColor: 0xc7e08a,
      baseColor: 0x587b35,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:wild-tall`,
      displayName: "Wild Tall",
      density: 16,
      tipColor: 0xc2db74,
      baseColor: 0x496f31,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:autumn-golden`,
      displayName: "Autumn Golden",
      density: 14,
      tipColor: 0xd6b564,
      baseColor: 0x8a6130,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:dry-sparse`,
      displayName: "Dry Sparse",
      density: 8,
      tipColor: 0xc8b076,
      baseColor: 0x7e6337,
      wind
    })
  ];
}
