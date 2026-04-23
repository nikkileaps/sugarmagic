/**
 * Reference-layer override editor.
 *
 * Renders the bounded Stage 2 override controls for one referenced layer.
 * This editor only exposes legal tuning knobs for the layer's existing kind
 * and content; it never swaps the referenced layer's identity or reference ids.
 */

import { ActionIcon, NumberInput, Select, Stack, Switch } from "@mantine/core";
import type {
  AppearanceLayer,
  AppearanceLayerOverride,
  EmissionLayer,
  EmissionLayerOverride,
  Layer,
  LayerOverride,
  MaterialDefinition,
  MaskTextureDefinition,
  ScatterLayer,
  ScatterLayerOverride,
  ShaderGraphDocument,
  ShaderParameterValue,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import { LabeledSlider } from "@sugarmagic/ui";
import { MaterialParameterEditor } from "../MaterialParameterEditor";
import { MaskEditor } from "./MaskEditor";
import { cloneLayerOverride } from "./utils";

export interface ReferenceLayerOverridePanelProps {
  layer: Layer;
  override: LayerOverride;
  allowedContext: SurfaceContext;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  shaderDefinitions: ShaderGraphDocument[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  onChange: (next: LayerOverride) => void;
  onClear: () => void;
}

function shaderForMaterial(
  materialDefinition: MaterialDefinition,
  shaderDefinitions: ShaderGraphDocument[]
): ShaderGraphDocument | null {
  return (
    shaderDefinitions.find(
      (shader) => shader.shaderDefinitionId === materialDefinition.shaderDefinitionId
    ) ?? null
  );
}

function buildEffectiveMaterial(
  materialDefinition: MaterialDefinition,
  parameterOverrides: Record<string, unknown> | undefined,
  textureBindingOverrides: Record<string, string> | undefined
): MaterialDefinition {
  return {
    ...materialDefinition,
    parameterValues: {
      ...materialDefinition.parameterValues,
      ...(parameterOverrides ?? {})
    },
    textureBindings: Object.fromEntries(
      Object.entries({
        ...materialDefinition.textureBindings,
        ...(textureBindingOverrides ?? {})
      }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    )
  };
}

function buildInlineShaderMaterial(
  layer: AppearanceLayer,
  override: AppearanceLayerOverride
): MaterialDefinition | null {
  if (layer.content.kind !== "shader") {
    return null;
  }
  const tuning =
    override.contentTuning?.for === "shader" ? override.contentTuning : null;
  return {
    definitionId: `${layer.layerId}:reference-override-shader`,
    definitionKind: "material",
    displayName: `${layer.displayName} Override`,
    shaderDefinitionId: layer.content.shaderDefinitionId,
    parameterValues: {
      ...layer.content.parameterValues,
      ...(tuning?.parameterValues ?? {})
    },
    textureBindings: Object.fromEntries(
      Object.entries({
        ...layer.content.textureBindings,
        ...(tuning?.textureBindings ?? {})
      }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    )
  };
}

export function ReferenceLayerOverridePanel({
  layer,
  override,
  allowedContext,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  shaderDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  onChange,
  onClear
}: ReferenceLayerOverridePanelProps) {
  const baseOverride = cloneLayerOverride(override);
  const appearanceLayer = layer.kind === "appearance" ? layer : null;
  const appearanceOverride =
    override.targetKind === "appearance" ? (override as AppearanceLayerOverride) : null;
  const appearanceTextureLayer =
    appearanceLayer?.content.kind === "texture"
      ? (appearanceLayer as AppearanceLayer & {
          content: Extract<AppearanceLayer["content"], { kind: "texture" }>;
        })
      : null;
  const appearanceMaterialLayer =
    appearanceLayer?.content.kind === "material"
      ? (appearanceLayer as AppearanceLayer & {
          content: Extract<AppearanceLayer["content"], { kind: "material" }>;
        })
      : null;
  const appearanceShaderLayer =
    appearanceLayer?.content.kind === "shader"
      ? (appearanceLayer as AppearanceLayer & {
          content: Extract<AppearanceLayer["content"], { kind: "shader" }>;
        })
      : null;
  const scatterLayer = layer.kind === "scatter" ? layer : null;
  const scatterOverride =
    override.targetKind === "scatter" ? (override as ScatterLayerOverride) : null;
  const emissionLayer = layer.kind === "emission" ? layer : null;
  const emissionOverride =
    override.targetKind === "emission" ? (override as EmissionLayerOverride) : null;
  const emissionTextureLayer =
    emissionLayer?.content.kind === "texture"
      ? (emissionLayer as EmissionLayer & {
          content: Extract<EmissionLayer["content"], { kind: "texture" }>;
        })
      : null;
  const emissionMaterialLayer =
    emissionLayer?.content.kind === "material"
      ? (emissionLayer as EmissionLayer & {
          content: Extract<EmissionLayer["content"], { kind: "material" }>;
        })
      : null;

  return (
    <Stack gap="xs">
      <ActionIcon
        variant="subtle"
        color="red"
        aria-label={`Clear override for ${layer.displayName}`}
        onClick={onClear}
      >
        Clear Override
      </ActionIcon>
      <Switch
        size="xs"
        label="Enabled"
        checked={override.enabled ?? layer.enabled}
        onChange={(event) =>
          onChange({
            ...baseOverride,
            enabled: event.currentTarget.checked
          })
        }
      />
      <LabeledSlider
        label="Opacity"
        min={0}
        max={1}
        value={override.opacity ?? layer.opacity}
        onChange={(value) =>
          onChange({
            ...baseOverride,
            opacity: value
          })
        }
      />
      <MaskEditor
        value={override.mask ?? layer.mask}
        allowedContext={allowedContext}
        textureDefinitions={textureDefinitions}
        maskTextureDefinitions={maskTextureDefinitions}
        onCreateMaskTextureDefinition={onCreateMaskTextureDefinition}
        onImportMaskTextureDefinition={onImportMaskTextureDefinition}
        onChange={(mask) =>
          onChange({
            ...baseOverride,
            mask
          })
        }
      />

      {appearanceLayer && appearanceOverride ? (
        <>
          <Select
            size="xs"
            label="Blend Mode"
            data={[
              { value: "base", label: "Base" },
              { value: "mix", label: "Mix" },
              { value: "multiply", label: "Multiply" },
              { value: "add", label: "Add" },
              { value: "overlay", label: "Overlay" }
            ]}
            value={appearanceOverride.blendMode ?? appearanceLayer.blendMode}
            onChange={(value) => {
              if (!value) return;
              onChange({
                ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                blendMode: value as AppearanceLayer["blendMode"]
              });
            }}
          />

          {appearanceTextureLayer ? (() => {
            const tuning =
              appearanceOverride.contentTuning?.for === "texture"
                ? appearanceOverride.contentTuning
                : null;
            const currentTiling = tuning?.tiling ?? appearanceTextureLayer.content.tiling;
            return (
              <>
                <NumberInput
                  size="xs"
                  label="Tile X"
                  value={currentTiling[0]}
                  onChange={(value) => {
                    if (typeof value !== "number" || !Number.isFinite(value)) return;
                    onChange({
                      ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                      contentTuning: {
                        for: "texture",
                        tiling: [value, currentTiling[1]]
                      }
                    });
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile Y"
                  value={currentTiling[1]}
                  onChange={(value) => {
                    if (typeof value !== "number" || !Number.isFinite(value)) return;
                    onChange({
                      ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                      contentTuning: {
                        for: "texture",
                        tiling: [currentTiling[0], value]
                      }
                    });
                  }}
                />
              </>
            );
          })() : null}

          {appearanceMaterialLayer ? (() => {
            const materialDefinition =
              materialDefinitions.find(
                (definition) =>
                  definition.definitionId === appearanceMaterialLayer.content.materialDefinitionId
              ) ?? null;
            if (!materialDefinition) {
              return null;
            }
            const tuning =
              appearanceOverride.contentTuning?.for === "material"
                ? appearanceOverride.contentTuning
                : null;
            return (
              <MaterialParameterEditor
                materialDefinition={buildEffectiveMaterial(
                  materialDefinition,
                  tuning?.parameterOverrides,
                  tuning?.textureBindingOverrides
                )}
                shaderDefinition={shaderForMaterial(materialDefinition, shaderDefinitions)}
                textureDefinitions={textureDefinitions}
                onChangeParameterValue={(parameter, value) => {
                  const nextParameterOverrides = { ...(tuning?.parameterOverrides ?? {}) };
                  if (value === null) {
                    delete nextParameterOverrides[parameter.parameterId];
                  } else {
                    nextParameterOverrides[parameter.parameterId] = value;
                  }
                  onChange({
                    ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                    contentTuning: {
                      for: "material",
                      parameterOverrides: nextParameterOverrides,
                      textureBindingOverrides: {
                        ...(tuning?.textureBindingOverrides ?? {})
                      }
                    }
                  });
                }}
                onChangeTextureBinding={(parameter, textureDefinitionId) => {
                  const nextTextureBindingOverrides = {
                    ...(tuning?.textureBindingOverrides ?? {})
                  };
                  if (textureDefinitionId) {
                    nextTextureBindingOverrides[parameter.parameterId] = textureDefinitionId;
                  } else {
                    delete nextTextureBindingOverrides[parameter.parameterId];
                  }
                  onChange({
                    ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                    contentTuning: {
                      for: "material",
                      parameterOverrides: {
                        ...(tuning?.parameterOverrides ?? {})
                      },
                      textureBindingOverrides: nextTextureBindingOverrides
                    }
                  });
                }}
              />
            );
          })() : null}

          {appearanceShaderLayer ? (() => {
            const tuning =
              appearanceOverride.contentTuning?.for === "shader"
                ? appearanceOverride.contentTuning
                : null;
            const materialDefinition = buildInlineShaderMaterial(
              appearanceShaderLayer,
              appearanceOverride
            );
            if (!materialDefinition) {
              return null;
            }
            const shaderDefinition =
              shaderDefinitions.find(
                (definition) =>
                  definition.shaderDefinitionId === appearanceShaderLayer.content.shaderDefinitionId
              ) ?? null;
            return (
              <MaterialParameterEditor
                materialDefinition={materialDefinition}
                shaderDefinition={shaderDefinition}
                textureDefinitions={textureDefinitions}
                onChangeParameterValue={(parameter, value) => {
                  const nextParameterValues = { ...(tuning?.parameterValues ?? {}) };
                  if (value === null) {
                    delete nextParameterValues[parameter.parameterId];
                  } else {
                    nextParameterValues[parameter.parameterId] = value as ShaderParameterValue;
                  }
                  onChange({
                    ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                    contentTuning: {
                      for: "shader",
                      parameterValues: nextParameterValues,
                      textureBindings: { ...(tuning?.textureBindings ?? {}) }
                    }
                  });
                }}
                onChangeTextureBinding={(parameter, textureDefinitionId) => {
                  const nextTextureBindings = { ...(tuning?.textureBindings ?? {}) };
                  if (textureDefinitionId) {
                    nextTextureBindings[parameter.parameterId] = textureDefinitionId;
                  } else {
                    delete nextTextureBindings[parameter.parameterId];
                  }
                  onChange({
                    ...(cloneLayerOverride(appearanceOverride) as AppearanceLayerOverride),
                    contentTuning: {
                      for: "shader",
                      parameterValues: { ...(tuning?.parameterValues ?? {}) },
                      textureBindings: nextTextureBindings
                    }
                  });
                }}
              />
            );
          })() : null}
        </>
      ) : null}

      {scatterLayer && scatterOverride ? (
        <LabeledSlider
          label="Density Multiplier"
          min={0}
          max={4}
          step={0.05}
          value={scatterOverride.densityMultiplier ?? 1}
          onChange={(value) =>
            onChange({
              ...(cloneLayerOverride(scatterOverride) as ScatterLayerOverride),
              densityMultiplier: value
            })
          }
        />
      ) : null}

      {emissionLayer && emissionOverride ? (
        <>
          {emissionLayer.content.kind === "color" ? (
            <LabeledSlider
              label="Intensity"
              min={0}
              max={2}
              value={
                emissionOverride.contentTuning?.for === "color" &&
                emissionOverride.contentTuning.intensity !== undefined
                  ? emissionOverride.contentTuning.intensity
                  : emissionLayer.content.intensity
              }
              onChange={(value) =>
                onChange({
                  ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                  contentTuning: {
                    for: "color",
                    intensity: value
                  }
                })
              }
            />
          ) : null}

          {emissionTextureLayer ? (() => {
            const tuning =
              emissionOverride.contentTuning?.for === "texture"
                ? emissionOverride.contentTuning
                : null;
            const currentTiling = tuning?.tiling ?? emissionTextureLayer.content.tiling;
            const currentIntensity = tuning?.intensity ?? emissionTextureLayer.content.intensity;
            return (
              <>
                <LabeledSlider
                  label="Intensity"
                  min={0}
                  max={2}
                  value={currentIntensity}
                  onChange={(value) =>
                    onChange({
                      ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                      contentTuning: {
                        for: "texture",
                        intensity: value,
                        tiling: [...currentTiling] as [number, number]
                      }
                    })
                  }
                />
                <NumberInput
                  size="xs"
                  label="Tile X"
                  value={currentTiling[0]}
                  onChange={(value) => {
                    if (typeof value !== "number" || !Number.isFinite(value)) return;
                    onChange({
                      ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                      contentTuning: {
                        for: "texture",
                        intensity: currentIntensity,
                        tiling: [value, currentTiling[1]]
                      }
                    });
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile Y"
                  value={currentTiling[1]}
                  onChange={(value) => {
                    if (typeof value !== "number" || !Number.isFinite(value)) return;
                    onChange({
                      ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                      contentTuning: {
                        for: "texture",
                        intensity: currentIntensity,
                        tiling: [currentTiling[0], value]
                      }
                    });
                  }}
                />
              </>
            );
          })() : null}

          {emissionMaterialLayer ? (() => {
            const materialDefinition =
              materialDefinitions.find(
                (definition) =>
                  definition.definitionId === emissionMaterialLayer.content.materialDefinitionId
              ) ?? null;
            if (!materialDefinition) {
              return null;
            }
            const tuning =
              emissionOverride.contentTuning?.for === "material"
                ? emissionOverride.contentTuning
                : null;
            return (
              <MaterialParameterEditor
                materialDefinition={buildEffectiveMaterial(
                  materialDefinition,
                  tuning?.parameterOverrides,
                  tuning?.textureBindingOverrides
                )}
                shaderDefinition={shaderForMaterial(materialDefinition, shaderDefinitions)}
                textureDefinitions={textureDefinitions}
                onChangeParameterValue={(parameter, value) => {
                  const nextParameterOverrides = { ...(tuning?.parameterOverrides ?? {}) };
                  if (value === null) {
                    delete nextParameterOverrides[parameter.parameterId];
                  } else {
                    nextParameterOverrides[parameter.parameterId] = value;
                  }
                  onChange({
                    ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                    contentTuning: {
                      for: "material",
                      parameterOverrides: nextParameterOverrides,
                      textureBindingOverrides: {
                        ...(tuning?.textureBindingOverrides ?? {})
                      }
                    }
                  });
                }}
                onChangeTextureBinding={(parameter, textureDefinitionId) => {
                  const nextTextureBindingOverrides = {
                    ...(tuning?.textureBindingOverrides ?? {})
                  };
                  if (textureDefinitionId) {
                    nextTextureBindingOverrides[parameter.parameterId] = textureDefinitionId;
                  } else {
                    delete nextTextureBindingOverrides[parameter.parameterId];
                  }
                  onChange({
                    ...(cloneLayerOverride(emissionOverride) as EmissionLayerOverride),
                    contentTuning: {
                      for: "material",
                      parameterOverrides: {
                        ...(tuning?.parameterOverrides ?? {})
                      },
                      textureBindingOverrides: nextTextureBindingOverrides
                    }
                  });
                }}
              />
            );
          })() : null}
        </>
      ) : null}
    </Stack>
  );
}
