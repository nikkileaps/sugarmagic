/**
 * Appearance layer editor.
 *
 * Strongly-typed editor for one AppearanceLayer: blend mode plus
 * the content union (color / texture / material / shader). Kept as
 * a per-kind branch (not a generic content picker) so layer
 * mutations cannot accidentally cross content unions.
 */

import { NumberInput, Select, Stack } from "@mantine/core";
import type { AppearanceLayer } from "@sugarmagic/domain";
import {
  createColorAppearanceContent,
  createMaterialAppearanceContent,
  createShaderAppearanceContent,
  createTextureAppearanceContent
} from "@sugarmagic/domain";
import { ColorField, KindTabs } from "@sugarmagic/ui";
import { MaterialParameterEditor } from "../MaterialParameterEditor";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";

const SHADER_OVERRIDE_DEFAULT = "__default__";

export interface AppearanceLayerEditorProps {
  layer: AppearanceLayer;
  isBaseLayer: boolean;
  onChange: (next: AppearanceLayer) => void;
}

export function AppearanceLayerEditor({
  layer,
  isBaseLayer,
  onChange
}: AppearanceLayerEditorProps) {
  const { textureDefinitions, materialDefinitions, shaderDefinitions } =
    useSurfaceAuthoring();
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
            const boundMaterial = materialDefinitions.find(
              (material) =>
                material.definitionId === materialContent.materialDefinitionId
            );
            const shaderOverride =
              materialContent.shaderOverrideDefinitionId ?? null;
            const layerTiling = materialContent.tiling ?? [1, 1];
            const materialOwnShaderId = boundMaterial?.shaderDefinitionId ?? null;
            const materialOwnShaderName = materialOwnShaderId
              ? surfaceShaders.find(
                  (s) => s.shaderDefinitionId === materialOwnShaderId
                )?.displayName ?? "(picked shader)"
              : "auto (PBR routing)";
            return (
              <Stack gap="xs">
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
                        content: createMaterialAppearanceContent(next, {
                          shaderOverrideDefinitionId: shaderOverride,
                          tiling: materialContent.tiling ?? null
                        })
                      });
                    }
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile X"
                  min={0.01}
                  value={layerTiling[0]}
                  onChange={(next) => {
                    if (typeof next === "number" && Number.isFinite(next) && next > 0) {
                      onChange({
                        ...layer,
                        content: createMaterialAppearanceContent(
                          materialContent.materialDefinitionId,
                          {
                            shaderOverrideDefinitionId: shaderOverride,
                            tiling:
                              next === 1 && layerTiling[1] === 1
                                ? null
                                : [next, layerTiling[1]]
                          }
                        )
                      });
                    }
                  }}
                />
                <NumberInput
                  size="xs"
                  label="Tile Y"
                  min={0.01}
                  value={layerTiling[1]}
                  onChange={(next) => {
                    if (typeof next === "number" && Number.isFinite(next) && next > 0) {
                      onChange({
                        ...layer,
                        content: createMaterialAppearanceContent(
                          materialContent.materialDefinitionId,
                          {
                            shaderOverrideDefinitionId: shaderOverride,
                            tiling:
                              layerTiling[0] === 1 && next === 1
                                ? null
                                : [layerTiling[0], next]
                          }
                        )
                      });
                    }
                  }}
                />
                <Select
                  size="xs"
                  label="Shader"
                  comboboxProps={{ withinPortal: false }}
                  data={[
                    { value: SHADER_OVERRIDE_DEFAULT, label: `Default (${materialOwnShaderName})` },
                    ...surfaceShaders.map((shader) => ({
                      value: shader.shaderDefinitionId,
                      label: shader.metadata?.builtIn
                        ? `${shader.displayName} (built-in)`
                        : shader.displayName
                    }))
                  ]}
                  value={shaderOverride ?? SHADER_OVERRIDE_DEFAULT}
                  onChange={(next) => {
                    const nextOverride =
                      next === null || next === SHADER_OVERRIDE_DEFAULT
                        ? null
                        : next;
                    onChange({
                      ...layer,
                      content: createMaterialAppearanceContent(
                        materialContent.materialDefinitionId,
                        {
                          shaderOverrideDefinitionId: nextOverride,
                          tiling: materialContent.tiling ?? null
                        }
                      )
                    });
                  }}
                  allowDeselect={false}
                />
              </Stack>
            );
          }
          if (kind === "shader" && layer.content.kind === "shader") {
            const shaderContent = layer.content;
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
                <MaterialParameterEditor
                  shaderDefinition={
                    surfaceShaders.find(
                      (shader) =>
                        shader.shaderDefinitionId === shaderContent.shaderDefinitionId
                    ) ?? null
                  }
                  parameterValues={shaderContent.parameterValues}
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
                />
              </Stack>
            );
          }
          return null;
        }}
      />
    </Stack>
  );
}
