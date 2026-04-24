/**
 * Layer detail panel.
 *
 * Edits one selected layer with strongly-typed per-kind branches so layer
 * mutations cannot accidentally cross content unions.
 */

import { NumberInput, Select, Stack } from "@mantine/core";
import type {
  AppearanceLayer,
  EmissionLayer,
  FlowerTypeDefinition,
  GrassTypeDefinition,
  Layer,
  MaterialDefinition,
  MaskTextureDefinition,
  RockTypeDefinition,
  ScatterLayer,
  ShaderGraphDocument,
  SurfaceContext,
  TextureDefinition
} from "@sugarmagic/domain";
import {
  createColorAppearanceContent,
  createColorEmissionContent,
  createMaterialAppearanceContent,
  createMaterialEmissionContent,
  createShaderAppearanceContent,
  createTextureAppearanceContent,
  createTextureEmissionContent
} from "@sugarmagic/domain";
import { ColorField, KindTabs, LabeledSlider } from "@sugarmagic/ui";
import { MaterialParameterEditor } from "../MaterialParameterEditor";

function mapAppearanceShaderToMaterial(layer: AppearanceLayer): MaterialDefinition | null {
  if (layer.content.kind !== "shader") {
    return null;
  }
  return {
    definitionId: `${layer.layerId}:inline-shader`,
    definitionKind: "material",
    displayName: layer.displayName,
    shaderDefinitionId: layer.content.shaderDefinitionId,
    parameterValues: layer.content.parameterValues,
    textureBindings: layer.content.textureBindings
  };
}

interface SharedProps {
  allowedContext: SurfaceContext;
  materialDefinitions: MaterialDefinition[];
  textureDefinitions: TextureDefinition[];
  maskTextureDefinitions: MaskTextureDefinition[];
  onCreateMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null> | MaskTextureDefinition | null;
  onImportMaskTextureDefinition?: () => Promise<MaskTextureDefinition | null>;
  shaderDefinitions: ShaderGraphDocument[];
  grassTypeDefinitions: GrassTypeDefinition[];
  flowerTypeDefinitions: FlowerTypeDefinition[];
  rockTypeDefinitions: RockTypeDefinition[];
}

function AppearanceLayerEditor(
  props: SharedProps & {
    layer: AppearanceLayer;
    isBaseLayer: boolean;
    onChange: (next: AppearanceLayer) => void;
  }
) {
  const {
    layer,
    isBaseLayer,
    textureDefinitions,
    materialDefinitions,
    shaderDefinitions,
    onChange
  } = props;
  const surfaceShaders = shaderDefinitions.filter(
    (shader) => shader.targetKind === "mesh-surface"
  );

  return (
    <Stack gap="xs">
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
        value={layer.blendMode}
        disabled={isBaseLayer}
        onChange={(next) => {
          if (!next) {
            return;
          }
          onChange({
            ...layer,
            blendMode: isBaseLayer ? "base" : (next as AppearanceLayer["blendMode"])
          });
        }}
      />
      <KindTabs
        value={layer.content.kind}
        options={[
          { value: "color", label: "Color" },
          { value: "texture", label: "Texture" },
          { value: "material", label: "Material" },
          { value: "shader", label: "Shader" }
        ]}
        onChange={(kind) => {
          switch (kind) {
            case "color":
              onChange({ ...layer, content: createColorAppearanceContent(0x6f8f52) });
              break;
            case "texture":
              onChange({
                ...layer,
                content: createTextureAppearanceContent(
                  textureDefinitions[0]?.definitionId ?? "",
                  [1, 1]
                )
              });
              break;
            case "material":
              onChange({
                ...layer,
                content: createMaterialAppearanceContent(
                  materialDefinitions[0]?.definitionId ?? ""
                )
              });
              break;
            case "shader":
              onChange({
                ...layer,
                content: createShaderAppearanceContent(
                  surfaceShaders[0]?.shaderDefinitionId ?? "",
                  {},
                  {}
                )
              });
              break;
          }
        }}
        renderPanel={(kind) => {
          if (kind === "color" && layer.content.kind === "color") {
            const colorContent = layer.content;
            return (
              <ColorField
                label="Color"
                value={colorContent.color}
                onChange={(next) =>
                  onChange({ ...layer, content: createColorAppearanceContent(next) })
                }
              />
            );
          }
          if (kind === "texture" && layer.content.kind === "texture") {
            const textureContent = layer.content;
            return (
              <Stack gap="xs">
                <Select
                  size="xs"
                  label="Texture"
                  comboboxProps={{ withinPortal: false }}
                  data={textureDefinitions.map((texture) => ({
                    value: texture.definitionId,
                    label: texture.displayName
                  }))}
                  value={textureContent.textureDefinitionId}
                  onChange={(next) => {
                    if (next) {
                      onChange({
                        ...layer,
                        content: createTextureAppearanceContent(next, textureContent.tiling)
                      });
                    }
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile X"
                  value={textureContent.tiling[0]}
                  onChange={(next) => {
                    if (typeof next === "number" && Number.isFinite(next)) {
                      onChange({
                        ...layer,
                        content: createTextureAppearanceContent(
                          textureContent.textureDefinitionId,
                          [next, textureContent.tiling[1]]
                        )
                      });
                    }
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile Y"
                  value={textureContent.tiling[1]}
                  onChange={(next) => {
                    if (typeof next === "number" && Number.isFinite(next)) {
                      onChange({
                        ...layer,
                        content: createTextureAppearanceContent(
                          textureContent.textureDefinitionId,
                          [textureContent.tiling[0], next]
                        )
                      });
                    }
                  }}
                />
              </Stack>
            );
          }
          if (kind === "material" && layer.content.kind === "material") {
            const materialContent = layer.content;
            return (
              <Select
                size="xs"
                label="Material"
                comboboxProps={{ withinPortal: false }}
                data={materialDefinitions.map((material) => ({
                  value: material.definitionId,
                  label: material.displayName
                }))}
                value={materialContent.materialDefinitionId}
                onChange={(next) => {
                  if (next) {
                    onChange({
                      ...layer,
                      content: createMaterialAppearanceContent(next)
                    });
                  }
                }}
              />
            );
          }
          if (kind === "shader" && layer.content.kind === "shader") {
            const shaderContent = layer.content;
            const inlineMaterial = mapAppearanceShaderToMaterial(layer);
            return (
              <Stack gap="xs">
                <Select
                  size="xs"
                  label="Shader"
                  comboboxProps={{ withinPortal: false }}
                  data={surfaceShaders.map((shader) => ({
                    value: shader.shaderDefinitionId,
                    label: shader.displayName
                  }))}
                  value={shaderContent.shaderDefinitionId}
                  onChange={(next) => {
                    if (next) {
                      onChange({
                        ...layer,
                        content: createShaderAppearanceContent(next, {}, {})
                      });
                    }
                  }}
                />
                {inlineMaterial ? (
                  <MaterialParameterEditor
                    materialDefinition={inlineMaterial}
                    shaderDefinition={
                      surfaceShaders.find(
                        (shader) =>
                          shader.shaderDefinitionId === shaderContent.shaderDefinitionId
                      ) ?? null
                    }
                    textureDefinitions={textureDefinitions}
                    onChangeParameterValue={(parameter, value) =>
                      onChange({
                        ...layer,
                        content: createShaderAppearanceContent(
                          shaderContent.shaderDefinitionId,
                          value === null
                            ? Object.fromEntries(
                                Object.entries(shaderContent.parameterValues).filter(
                                  ([parameterId]) => parameterId !== parameter.parameterId
                                )
                              )
                            : {
                                ...shaderContent.parameterValues,
                                [parameter.parameterId]: value
                              },
                          shaderContent.textureBindings
                        )
                      })
                    }
                    onChangeTextureBinding={(parameter, textureDefinitionId) =>
                      onChange({
                        ...layer,
                        content: createShaderAppearanceContent(
                          shaderContent.shaderDefinitionId,
                          shaderContent.parameterValues,
                          textureDefinitionId
                            ? {
                                ...shaderContent.textureBindings,
                                [parameter.parameterId]: textureDefinitionId
                              }
                            : Object.fromEntries(
                                Object.entries(shaderContent.textureBindings).filter(
                                  ([parameterId]) => parameterId !== parameter.parameterId
                                )
                              )
                        )
                      })
                    }
                  />
                ) : null}
              </Stack>
            );
          }
          return null;
        }}
      />
    </Stack>
  );
}

function ScatterLayerEditor(
  props: SharedProps & {
    layer: ScatterLayer;
    onChange: (next: ScatterLayer) => void;
  }
) {
  const {
    layer,
    materialDefinitions,
    shaderDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions,
    onChange
  } = props;
  const scatterMaterials = materialDefinitions.filter((material) => {
    const shader = shaderDefinitions.find(
      (candidate) => candidate.shaderDefinitionId === material.shaderDefinitionId
    );
    return shader?.targetKind === "mesh-surface";
  });
  return (
    <KindTabs
      value={layer.content.kind}
      options={[
        { value: "grass", label: "Grass" },
        { value: "flowers", label: "Flowers" },
        { value: "rocks", label: "Rocks" }
      ]}
      onChange={(kind) => {
        if (kind === "grass") {
          onChange({
            ...layer,
            content: {
              kind: "grass",
              grassTypeId: grassTypeDefinitions[0]?.definitionId ?? ""
            }
          });
        } else if (kind === "flowers") {
          onChange({
            ...layer,
            content: {
              kind: "flowers",
              flowerTypeId: flowerTypeDefinitions[0]?.definitionId ?? ""
            }
          });
        } else {
          onChange({
            ...layer,
            content: {
              kind: "rocks",
              rockTypeId: rockTypeDefinitions[0]?.definitionId ?? ""
            }
          });
        }
      }}
      renderPanel={(kind) =>
        kind === "grass" && layer.content.kind === "grass" ? (
          <Stack gap="xs">
            <Select
              size="xs"
              label="Grass Type"
              comboboxProps={{ withinPortal: false }}
              data={grassTypeDefinitions.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.content.grassTypeId}
              onChange={(next) => {
                if (next) {
                  onChange({
                    ...layer,
                    content: { kind: "grass", grassTypeId: next }
                  });
                }
              }}
            />
            <Select
              size="xs"
              label="Material"
              clearable
              comboboxProps={{ withinPortal: false }}
              data={scatterMaterials.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.materialDefinitionId}
              onChange={(next) =>
                onChange({
                  ...layer,
                  materialDefinitionId: next ?? null
                })
              }
            />
          </Stack>
        ) : kind === "flowers" && layer.content.kind === "flowers" ? (
          <Stack gap="xs">
            <Select
              size="xs"
              label="Flower Type"
              comboboxProps={{ withinPortal: false }}
              data={flowerTypeDefinitions.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.content.flowerTypeId}
              onChange={(next) => {
                if (next) {
                  onChange({
                    ...layer,
                    content: { kind: "flowers", flowerTypeId: next }
                  });
                }
              }}
            />
            <Select
              size="xs"
              label="Material"
              clearable
              comboboxProps={{ withinPortal: false }}
              data={scatterMaterials.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.materialDefinitionId}
              onChange={(next) =>
                onChange({
                  ...layer,
                  materialDefinitionId: next ?? null
                })
              }
            />
          </Stack>
        ) : kind === "rocks" && layer.content.kind === "rocks" ? (
          <Stack gap="xs">
            <Select
              size="xs"
              label="Rock Type"
              comboboxProps={{ withinPortal: false }}
              data={rockTypeDefinitions.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.content.rockTypeId}
              onChange={(next) => {
                if (next) {
                  onChange({
                    ...layer,
                    content: { kind: "rocks", rockTypeId: next }
                  });
                }
              }}
            />
            <Select
              size="xs"
              label="Material"
              clearable
              comboboxProps={{ withinPortal: false }}
              data={scatterMaterials.map((definition) => ({
                value: definition.definitionId,
                label: definition.displayName
              }))}
              value={layer.materialDefinitionId}
              onChange={(next) =>
                onChange({
                  ...layer,
                  materialDefinitionId: next ?? null
                })
              }
            />
          </Stack>
        ) : null
      }
    />
  );
}

function EmissionLayerEditor(
  props: SharedProps & {
    layer: EmissionLayer;
    onChange: (next: EmissionLayer) => void;
  }
) {
  const { layer, textureDefinitions, materialDefinitions, onChange } = props;
  return (
    <KindTabs
      value={layer.content.kind}
      options={[
        { value: "color", label: "Color" },
        { value: "texture", label: "Texture" },
        { value: "material", label: "Material" }
      ]}
      onChange={(kind) => {
        if (kind === "color") {
          onChange({
            ...layer,
            content: createColorEmissionContent(0xf6cd7c, 0.2)
          });
        } else if (kind === "texture") {
          onChange({
            ...layer,
            content: createTextureEmissionContent(
              textureDefinitions[0]?.definitionId ?? "",
              0.2,
              [1, 1]
            )
          });
        } else {
          onChange({
            ...layer,
            content: createMaterialEmissionContent(
              materialDefinitions[0]?.definitionId ?? ""
            )
          });
        }
      }}
      renderPanel={(kind) => {
        if (kind === "color" && layer.content.kind === "color") {
          const colorContent = layer.content;
          return (
            <Stack gap="xs">
              <ColorField
                label="Color"
                value={colorContent.color}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createColorEmissionContent(next, colorContent.intensity)
                  })
                }
              />
              <LabeledSlider
                label="Intensity"
                min={0}
                max={2}
                value={colorContent.intensity}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createColorEmissionContent(colorContent.color, next)
                  })
                }
              />
            </Stack>
          );
        }
        if (kind === "texture" && layer.content.kind === "texture") {
          const textureContent = layer.content;
          return (
            <Stack gap="xs">
              <Select
                size="xs"
                label="Texture"
                comboboxProps={{ withinPortal: false }}
                data={textureDefinitions.map((texture) => ({
                  value: texture.definitionId,
                  label: texture.displayName
                }))}
                value={textureContent.textureDefinitionId}
                onChange={(next) => {
                  if (next) {
                    onChange({
                      ...layer,
                      content: createTextureEmissionContent(
                        next,
                        textureContent.intensity,
                        textureContent.tiling
                      )
                    });
                  }
                }}
              />
              <LabeledSlider
                label="Intensity"
                min={0}
                max={2}
                value={textureContent.intensity}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    content: createTextureEmissionContent(
                      textureContent.textureDefinitionId,
                      next,
                      textureContent.tiling
                    )
                  })
                }
              />
            </Stack>
          );
        }
        if (kind === "material" && layer.content.kind === "material") {
          const materialContent = layer.content;
          return (
            <Select
              size="xs"
              label="Material"
              comboboxProps={{ withinPortal: false }}
              data={materialDefinitions.map((material) => ({
                value: material.definitionId,
                label: material.displayName
              }))}
              value={materialContent.materialDefinitionId}
              onChange={(next) => {
                if (next) {
                  onChange({
                    ...layer,
                    content: createMaterialEmissionContent(next)
                  });
                }
              }}
            />
          );
        }
        return null;
      }}
    />
  );
}

export interface LayerDetailPanelProps extends SharedProps {
  layer: Layer;
  isBaseLayer: boolean;
  onChange: (next: Layer) => void;
}

export function LayerDetailPanel({
  layer,
  isBaseLayer,
  allowedContext,
  materialDefinitions,
  textureDefinitions,
  maskTextureDefinitions,
  onCreateMaskTextureDefinition,
  onImportMaskTextureDefinition,
  shaderDefinitions,
  grassTypeDefinitions,
  flowerTypeDefinitions,
  rockTypeDefinitions,
  onChange
}: LayerDetailPanelProps) {
  const sharedProps: SharedProps = {
    allowedContext,
    materialDefinitions,
    textureDefinitions,
    maskTextureDefinitions,
    onCreateMaskTextureDefinition,
    onImportMaskTextureDefinition,
    shaderDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions
  };

  return (
    <Stack gap="xs">
      <LabeledSlider
        label="Opacity"
        min={0}
        max={1}
        value={layer.opacity}
        onChange={(next) =>
          onChange({
            ...layer,
            opacity: next
          })
        }
      />

      {layer.kind === "appearance" ? (
        <AppearanceLayerEditor
          {...sharedProps}
          layer={layer}
          isBaseLayer={isBaseLayer}
          onChange={onChange}
        />
      ) : null}
      {layer.kind === "scatter" ? (
        <ScatterLayerEditor
          {...sharedProps}
          layer={layer}
          onChange={onChange}
        />
      ) : null}
      {layer.kind === "emission" ? (
        <EmissionLayerEditor
          {...sharedProps}
          layer={layer}
          onChange={onChange}
        />
      ) : null}
    </Stack>
  );
}
