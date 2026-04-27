/**
 * Built-in SurfaceDefinition starter content for fresh projects.
 *
 * These named reusable surfaces are the authored starter library promised by
 * Epic 036. They compose appearance, scatter, and emission layers using the
 * canonical surface domain types.
 */

import type {
  FlowerTypeDefinition,
  GrassTypeDefinition,
  SurfaceDefinition
} from "../../surface";
import {
  createAppearanceLayer,
  createColorAppearanceContent,
  createColorEmissionContent,
  createEmissionLayer,
  createScatterLayer,
  createSurface
} from "../../surface";

function getBuiltInGrassSurface4ShaderId(projectId: string): string {
  return `${projectId}:shader:grass-surface-4`;
}

export function createBuiltInSurfaceDefinitions(
  projectId: string,
  grassTypeDefinitions: GrassTypeDefinition[],
  flowerTypeDefinitions: FlowerTypeDefinition[]
): SurfaceDefinition[] {
  const grassByName = new Map(
    grassTypeDefinitions.map((definition) => [definition.displayName, definition.definitionId])
  );
  const flowerByName = new Map(
    flowerTypeDefinitions.map((definition) => [definition.displayName, definition.definitionId])
  );

  return [
    {
      definitionId: `${projectId}:surface:wildflower-meadow`,
      definitionKind: "surface",
      displayName: "Wildflower Meadow",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x5e8740), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: grassByName.get("Wild Tall")! },
          {
            displayName: "Tall Grass",
            shaderDefinitionId: getBuiltInGrassSurface4ShaderId(projectId)
          }
        ),
        createScatterLayer(
          { kind: "flowers", flowerTypeId: flowerByName.get("White Meadow")! },
          { displayName: "Flowers", opacity: 0.7 }
        ),
        createEmissionLayer(createColorEmissionContent(0xf6cd7c, 0.12), {
          displayName: "Warm Light",
          opacity: 0.5
        })
      ])
    },
    {
      definitionId: `${projectId}:surface:autumn-field`,
      definitionKind: "surface",
      displayName: "Autumn Field",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x7e5f31), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: grassByName.get("Autumn Golden")! },
          {
            displayName: "Grass",
            shaderDefinitionId: getBuiltInGrassSurface4ShaderId(projectId)
          }
        ),
        createScatterLayer(
          { kind: "flowers", flowerTypeId: flowerByName.get("Yellow Buttercup")! },
          { displayName: "Flowers", opacity: 0.45 }
        )
      ])
    },
    {
      definitionId: `${projectId}:surface:mossy-bark`,
      definitionKind: "surface",
      displayName: "Mossy Bark",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x6c4a33), {
          displayName: "Bark",
          blendMode: "base"
        }),
        createAppearanceLayer(createColorAppearanceContent(0x4d6f37), {
          displayName: "Moss Tint",
          blendMode: "overlay",
          opacity: 0.45
        })
      ])
    },
    {
      definitionId: `${projectId}:surface:manicured-lawn`,
      definitionKind: "surface",
      displayName: "Manicured Lawn",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x5f8c3d), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: grassByName.get("Short Lawn")! },
          {
            displayName: "Short Grass",
            shaderDefinitionId: getBuiltInGrassSurface4ShaderId(projectId)
          }
        )
      ])
    },
    {
      definitionId: `${projectId}:surface:clover-patch`,
      definitionKind: "surface",
      displayName: "Clover Patch",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x4f7b38), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: grassByName.get("Short Lawn")! },
          {
            displayName: "Clover Base",
            opacity: 0.85,
            shaderDefinitionId: getBuiltInGrassSurface4ShaderId(projectId)
          }
        ),
        createScatterLayer(
          { kind: "flowers", flowerTypeId: flowerByName.get("White Meadow")! },
          { displayName: "Tiny Blooms", opacity: 0.35 }
        )
      ])
    },
    {
      definitionId: `${projectId}:surface:painterly-grass`,
      definitionKind: "surface",
      displayName: "Painterly Grass",
      surface: createSurface([
        createAppearanceLayer(createColorAppearanceContent(0x6d8644), {
          displayName: "Ground",
          blendMode: "base"
        }),
        createScatterLayer(
          { kind: "grass", grassTypeId: grassByName.get("Painterly Tuft")! },
          {
            displayName: "Painterly Tufts",
            shaderDefinitionId: `${projectId}:shader:painterly-grass`,
            opacity: 0.95
          }
        ),
        createScatterLayer(
          { kind: "flowers", flowerTypeId: flowerByName.get("White Meadow")! },
          { displayName: "Tiny Blooms", opacity: 0.2 }
        ),
        createEmissionLayer(createColorEmissionContent(0xf4d37d, 0.08), {
          displayName: "Warm Lift",
          opacity: 0.35
        })
      ])
    }
  ];
}
