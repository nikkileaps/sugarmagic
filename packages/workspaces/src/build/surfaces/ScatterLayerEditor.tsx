/**
 * Scatter layer editor.
 *
 * Strongly-typed editor for one ScatterLayer: the scatter content
 * union (grass / flowers / rocks), per-layer appearance shader
 * override, and the wind deform pick (empty = inherit the type's
 * own wind).
 */

import { Select, Stack } from "@mantine/core";
import type { ScatterLayer } from "@sugarmagic/domain";
import { KindTabs } from "@sugarmagic/ui";
import { useSurfaceAuthoring } from "./SurfaceAuthoringContext";

export interface ScatterLayerEditorProps {
  layer: ScatterLayer;
  onChange: (next: ScatterLayer) => void;
}

export function ScatterLayerEditor({ layer, onChange }: ScatterLayerEditorProps) {
  const {
    shaderDefinitions,
    grassTypeDefinitions,
    flowerTypeDefinitions,
    rockTypeDefinitions
  } = useSurfaceAuthoring();
  const scatterShaders = shaderDefinitions.filter(
    (shader) => shader.targetKind === "mesh-surface"
  );
  // Wind / deform presets are shaders now. Empty selection = inherit whatever
  // wind the grass/flower/rock type itself carries by default.
  const deformShaders = shaderDefinitions.filter(
    (shader) => shader.targetKind === "mesh-deform"
  );
  const deformValue =
    layer.deform?.kind === "shader" ? layer.deform.shaderDefinitionId : null;
  return (
    <Stack gap="sm">
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
                label="Shader"
                clearable
                comboboxProps={{ withinPortal: false }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    shaderDefinitionId: next ?? null
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
                label="Shader"
                clearable
                comboboxProps={{ withinPortal: false }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    shaderDefinitionId: next ?? null
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
                label="Shader"
                clearable
                comboboxProps={{ withinPortal: false }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={(next) =>
                  onChange({
                    ...layer,
                    shaderDefinitionId: next ?? null
                  })
                }
              />
            </Stack>
          ) : null
        }
      />
      <Select
        size="xs"
        label="Wind"
        clearable
        comboboxProps={{ withinPortal: false }}
        placeholder="Inherit from type"
        data={deformShaders.map((definition) => ({
          value: definition.shaderDefinitionId,
          label: definition.displayName
        }))}
        value={deformValue}
        onChange={(next) =>
          onChange({
            ...layer,
            deform: next
              ? { kind: "shader", shaderDefinitionId: next, parameterValues: {}, textureBindings: {} }
              : null
          })
        }
      />
    </Stack>
  );
}
