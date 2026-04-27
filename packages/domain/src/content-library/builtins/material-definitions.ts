/**
 * Built-in MaterialDefinition starter content for fresh projects.
 *
 * Owns the reusable material presets that pair the built-in stylized grass
 * shaders with stable material ids. Surface starter content binds scatter
 * layers to these materials so authors can swap and refine grass looks
 * through the normal Material apparatus instead of a parallel scatter-only
 * styling path.
 *
 * TODO(wind-presets): the wind preset materials below (Still Air, Gentle
 * Breeze, Meadow Breeze, Gusty) declare three parameters — windStrength,
 * windFrequency, windDirection — but only `windStrength` is currently
 * active in the rendered output. The wind-sway materializer's BAND layer
 * (which consumed windFrequency for gust speed) is commented out pending
 * more iteration, and `windDirection` was never wired into the ambient
 * wave layer (bend is hardcoded along -X). Result: changing Gentle Breeze
 * → Gusty changes only the bend magnitude, not the gust cadence or wind
 * direction. The frequency/direction values are kept on the presets as
 * placeholders for when the band layer is re-enabled and direction is
 * wired through. See packages/render-web/src/materialize/effect.ts
 * `effect.wind-sway` (BLOCK START / BLOCK END) for the disabled band
 * code that would consume windFrequency, and the ambient wave layer
 * below it for where windDirection would need to replace the hardcoded
 * `vec3(ambientBend, 0, 0)` axis.
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

// Wind presets — MaterialDefinitions wrapping the foliage-wind shader with
// named parameterValues. Authors bind these on ScatterLayer.deform to swap
// wind "mood" per placement without forking a new grass type.

export function getBuiltInStillAirMaterialId(projectId: string): string {
  return `${projectId}:material:still-air`;
}

export function getBuiltInGentleBreezeMaterialId(projectId: string): string {
  return `${projectId}:material:gentle-breeze`;
}

export function getBuiltInMeadowBreezeMaterialId(projectId: string): string {
  return `${projectId}:material:meadow-breeze`;
}

export function getBuiltInGustyMaterialId(projectId: string): string {
  return `${projectId}:material:gusty`;
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
    make(getBuiltInGrassSurface6MaterialId(projectId), "Grass Surface 6", `${projectId}:shader:grass-surface-6`, "grass-surface-6"),
    // Wind deform presets. Same shader (foliage-wind), different
    // authored parameter values for different moods. Bind any of these on
    // ScatterLayer.deform to swap wind per placement.
    {
      definitionId: getBuiltInStillAirMaterialId(projectId),
      definitionKind: "material",
      displayName: "Still Air",
      shaderDefinitionId: `${projectId}:shader:foliage-wind`,
      parameterValues: { windStrength: 0 },
      textureBindings: {},
      metadata: { builtIn: true, builtInKey: "still-air" }
    },
    {
      definitionId: getBuiltInGentleBreezeMaterialId(projectId),
      definitionKind: "material",
      displayName: "Gentle Breeze",
      shaderDefinitionId: `${projectId}:shader:foliage-wind`,
      parameterValues: { windStrength: 0.18, windFrequency: 1.1, windDirection: [1, 0] },
      textureBindings: {},
      metadata: { builtIn: true, builtInKey: "gentle-breeze" }
    },
    {
      definitionId: getBuiltInMeadowBreezeMaterialId(projectId),
      definitionKind: "material",
      displayName: "Meadow Breeze",
      shaderDefinitionId: `${projectId}:shader:foliage-wind`,
      parameterValues: { windStrength: 0.35, windFrequency: 1.6, windDirection: [1, 0.2] },
      textureBindings: {},
      metadata: { builtIn: true, builtInKey: "meadow-breeze" }
    },
    {
      definitionId: getBuiltInGustyMaterialId(projectId),
      definitionKind: "material",
      displayName: "Gusty",
      shaderDefinitionId: `${projectId}:shader:foliage-wind`,
      parameterValues: { windStrength: 0.65, windFrequency: 2.6, windDirection: [1, -0.15] },
      textureBindings: {},
      metadata: { builtIn: true, builtInKey: "gusty" }
    }
  ];
}
