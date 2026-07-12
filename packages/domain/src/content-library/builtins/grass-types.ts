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
      density: 80,
      tipColor: 0xc7e08a,
      baseColor: 0x587b35,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:wild-tall`,
      displayName: "Wild Tall",
      density: 55,
      tipColor: 0xc2db74,
      baseColor: 0x496f31,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:autumn-golden`,
      displayName: "Autumn Golden",
      density: 50,
      tipColor: 0xd6b564,
      baseColor: 0x8a6130,
      wind
    }),
    createDefaultGrassTypeDefinition(projectId, {
      definitionId: `${projectId}:grass-type:dry-sparse`,
      displayName: "Dry Sparse",
      density: 28,
      tipColor: 0xc8b076,
      baseColor: 0x7e6337,
      wind
    }),
    {
      // Painterly Tuft is the Lemoine-style carpet: near-neutral
      // vertex colors (the ground-inheriting shader owns the hue),
      // wide soft short blades, high density. Retuned 2026-07-10.
      ...createDefaultGrassTypeDefinition(projectId, {
        definitionId: `${projectId}:grass-type:painterly-tuft`,
        displayName: "Painterly Tuft",
        density: 110,
        tipColor: 0xf5f7e8,
        baseColor: 0xdfe4d0,
        wind: wind
      }),
      tuft: {
        kind: "procedural" as const,
        bladeProfile: "tapered" as const,
        bladesPerTuft: 5,
        heightRange: [0.24, 0.5] as [number, number],
        widthBase: 0.3,
        bendAmount: 0.75
      },
      colorJitter: 0.08
    },
    {
      // Painterly Card is the painted-silhouette primitive: static
      // splayed card quads whose blade shapes come from a silhouette
      // texture (bind one to the layer shader's Silhouette input --
      // pair with the Card Foliage shader). Vertex colors stay
      // near-white; hue is inherited from the ground.
      ...createDefaultGrassTypeDefinition(projectId, {
        definitionId: `${projectId}:grass-type:painterly-card`,
        displayName: "Painterly Card",
        density: 26,
        tipColor: 0xffffff,
        baseColor: 0xf2f4ea,
        wind
      }),
      tuft: {
        kind: "card" as const,
        cardsPerClump: 3,
        width: 0.9,
        height: 0.55,
        splayDegrees: 14
      },
      colorJitter: 0.06,
      // No far bin: a card clump is 3 quads, so reduced-detail LOD
      // saves nothing. Near geometry carries to the billboard
      // distance instead.
      lodMeshes: {
        near: { kind: "procedural-default" as const },
        far: null,
        billboard: { kind: "billboard" as const }
      }
    },
  ];
}
