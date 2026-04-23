/**
 * Built-in FlowerType definitions for fresh projects.
 *
 * These starter flower shapes give the Surface Library an immediately useful
 * authored palette for meadow and lawn style starter surfaces.
 */

import {
  createDefaultFlowerTypeDefinition,
  type FlowerTypeDefinition
} from "../../surface";

export function createBuiltInFlowerTypeDefinitions(
  projectId: string
): FlowerTypeDefinition[] {
  const wind = {
    kind: "shader" as const,
    shaderDefinitionId: `${projectId}:shader:foliage-wind`,
    parameterValues: { swayAmount: 0.4 },
    textureBindings: {}
  };
  return [
    createDefaultFlowerTypeDefinition(projectId, {
      definitionId: `${projectId}:flower-type:white-meadow`,
      displayName: "White Meadow",
      petalColor: 0xf4f3e8,
      centerColor: 0xe7c95e,
      density: 3,
      wind
    }),
    createDefaultFlowerTypeDefinition(projectId, {
      definitionId: `${projectId}:flower-type:yellow-buttercup`,
      displayName: "Yellow Buttercup",
      petalColor: 0xf2d14b,
      centerColor: 0xb66f1d,
      density: 2.5,
      wind
    }),
    createDefaultFlowerTypeDefinition(projectId, {
      definitionId: `${projectId}:flower-type:purple-wildflower`,
      displayName: "Purple Wildflower",
      petalColor: 0xc39bf3,
      centerColor: 0xf6d783,
      density: 2,
      wind
    })
  ];
}
