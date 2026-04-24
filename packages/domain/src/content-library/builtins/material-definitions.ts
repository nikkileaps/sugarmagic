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
  const make = (
    definitionId: string,
    displayName: string,
    shaderDefinitionId: string,
    builtInKey: string
  ): MaterialDefinition => ({
    definitionId,
    definitionKind: "material",
    displayName,
    shaderDefinitionId,
    parameterValues: {},
    textureBindings: {},
    metadata: { builtIn: true, builtInKey }
  });
  return [
    make(getBuiltInMeadowGrassMaterialId(projectId), "Meadow Grass", `${projectId}:shader:meadow-grass`, "meadow-grass"),
    make(getBuiltInSunlitLawnMaterialId(projectId), "Sunlit Lawn", `${projectId}:shader:sunlit-lawn`, "sunlit-lawn"),
    make(getBuiltInAutumnFieldGrassMaterialId(projectId), "Autumn Field Grass", `${projectId}:shader:autumn-field-grass`, "autumn-field-grass"),
    make(getBuiltInPainterlyGrassMaterialId(projectId), "Painterly Grass", `${projectId}:shader:painterly-grass`, "painterly-grass"),
    make(getBuiltInGrassSurface2MaterialId(projectId), "Grass Surface 2", `${projectId}:shader:grass-surface-2`, "grass-surface-2"),
    make(getBuiltInGrassSurface3MaterialId(projectId), "Grass Surface 3", `${projectId}:shader:grass-surface-3`, "grass-surface-3"),
    make(getBuiltInGrassSurface4MaterialId(projectId), "Grass Surface 4", `${projectId}:shader:grass-surface-4`, "grass-surface-4"),
    make(getBuiltInGrassSurface6MaterialId(projectId), "Grass Surface 6", `${projectId}:shader:grass-surface-6`, "grass-surface-6")
  ];
}
