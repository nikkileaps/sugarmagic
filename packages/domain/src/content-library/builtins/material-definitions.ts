/**
 * Built-in MaterialDefinition starter content for fresh projects.
 *
 * Owns the reusable material presets that pair the built-in stylized grass
 * shaders with stable material ids. Surface starter content binds scatter
 * layers to these materials so authors can swap and refine grass looks
 * through the normal Material apparatus instead of a parallel scatter-only
 * styling path.
 */

import type { MaterialDefinition } from "../index";

export function getBuiltInMeadowGrassMaterialId(projectId: string): string {
  return `${projectId}:material:meadow-grass`;
}

export function getBuiltInSunlitLawnMaterialId(projectId: string): string {
  return `${projectId}:material:sunlit-lawn`;
}

export function getBuiltInAutumnFieldGrassMaterialId(projectId: string): string {
  return `${projectId}:material:autumn-field-grass`;
}

export function getBuiltInPainterlyGrassMaterialId(projectId: string): string {
  return `${projectId}:material:painterly-grass`;
}

export function getBuiltInGrassSurface2MaterialId(projectId: string): string {
  return `${projectId}:material:grass-surface-2`;
}

export function getBuiltInGrassSurface3MaterialId(projectId: string): string {
  return `${projectId}:material:grass-surface-3`;
}

export function getBuiltInGrassSurface4MaterialId(projectId: string): string {
  return `${projectId}:material:grass-surface-4`;
}

export function getBuiltInGrassSurface6MaterialId(projectId: string): string {
  return `${projectId}:material:grass-surface-6`;
}

export function createBuiltInMaterialDefinitions(
  projectId: string
): MaterialDefinition[] {
  return [
    {
      definitionId: getBuiltInMeadowGrassMaterialId(projectId),
      definitionKind: "material",
      displayName: "Meadow Grass",
      shaderDefinitionId: `${projectId}:shader:meadow-grass`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInSunlitLawnMaterialId(projectId),
      definitionKind: "material",
      displayName: "Sunlit Lawn",
      shaderDefinitionId: `${projectId}:shader:sunlit-lawn`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInAutumnFieldGrassMaterialId(projectId),
      definitionKind: "material",
      displayName: "Autumn Field Grass",
      shaderDefinitionId: `${projectId}:shader:autumn-field-grass`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInPainterlyGrassMaterialId(projectId),
      definitionKind: "material",
      displayName: "Painterly Grass",
      shaderDefinitionId: `${projectId}:shader:painterly-grass`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInGrassSurface2MaterialId(projectId),
      definitionKind: "material",
      displayName: "Grass Surface 2",
      shaderDefinitionId: `${projectId}:shader:grass-surface-2`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInGrassSurface3MaterialId(projectId),
      definitionKind: "material",
      displayName: "Grass Surface 3",
      shaderDefinitionId: `${projectId}:shader:grass-surface-3`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInGrassSurface4MaterialId(projectId),
      definitionKind: "material",
      displayName: "Grass Surface 4",
      shaderDefinitionId: `${projectId}:shader:grass-surface-4`,
      parameterValues: {},
      textureBindings: {}
    },
    {
      definitionId: getBuiltInGrassSurface6MaterialId(projectId),
      definitionKind: "material",
      displayName: "Grass Surface 6",
      shaderDefinitionId: `${projectId}:shader:grass-surface-6`,
      parameterValues: {},
      textureBindings: {}
    }
  ];
}
