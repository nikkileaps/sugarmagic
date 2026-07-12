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
    textureDefinitions,
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
  // The selected shader's texture2d parameters each get a picker from
  // the texture library (e.g. the Silhouette input on Card Foliage).
  // Bindings live on the layer, not the shader, so one shader serves
  // many painted silhouettes without forking.
  const selectedShader =
    scatterShaders.find(
      (shader) => shader.shaderDefinitionId === layer.shaderDefinitionId
    ) ?? null;
  const textureParameters =
    selectedShader?.parameters.filter(
      (parameter) => parameter.dataType === "texture2d"
    ) ?? [];
  // Switching (or clearing) the layer shader prunes textureBindings
  // to the parameters the NEW shader actually declares -- shared ids
  // (e.g. "silhouette" across card-foliage variants) carry over,
  // stale ones stop lingering in the document (065.12c).
  const changeShader = (next: string | null) => {
    const nextShader = next
      ? scatterShaders.find(
          (shader) => shader.shaderDefinitionId === next
        ) ?? null
      : null;
    const validIds = new Set(
      (nextShader?.parameters ?? [])
        .filter((parameter) => parameter.dataType === "texture2d")
        .map((parameter) => parameter.parameterId)
    );
    const prunedBindings = Object.fromEntries(
      Object.entries(layer.textureBindings ?? {}).filter(([parameterId]) =>
        validIds.has(parameterId)
      )
    );
    onChange({
      ...layer,
      shaderDefinitionId: next ?? null,
      textureBindings: prunedBindings
    });
  };
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
                comboboxProps={{ withinPortal: true }}
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
                comboboxProps={{ withinPortal: true }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={changeShader}
              />
            </Stack>
          ) : kind === "flowers" && layer.content.kind === "flowers" ? (
            <Stack gap="xs">
              <Select
                size="xs"
                label="Flower Type"
                comboboxProps={{ withinPortal: true }}
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
                comboboxProps={{ withinPortal: true }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={changeShader}
              />
            </Stack>
          ) : kind === "rocks" && layer.content.kind === "rocks" ? (
            <Stack gap="xs">
              <Select
                size="xs"
                label="Rock Type"
                comboboxProps={{ withinPortal: true }}
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
                comboboxProps={{ withinPortal: true }}
                data={scatterShaders.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))}
                value={layer.shaderDefinitionId}
                onChange={changeShader}
              />
            </Stack>
          ) : null
        }
      />
      {textureParameters.map((parameter) => (
        <Select
          key={parameter.parameterId}
          size="xs"
          label={parameter.displayName}
          clearable
          searchable
          comboboxProps={{ withinPortal: true }}
          placeholder="Pick a texture"
          data={textureDefinitions.map((definition) => ({
            value: definition.definitionId,
            label: definition.displayName
          }))}
          value={layer.textureBindings?.[parameter.parameterId] ?? null}
          onChange={(next) => {
            const bindings = { ...(layer.textureBindings ?? {}) };
            if (next) {
              bindings[parameter.parameterId] = next;
            } else {
              delete bindings[parameter.parameterId];
            }
            onChange({ ...layer, textureBindings: bindings });
          }}
        />
      ))}
      <Select
        size="xs"
        label="Wind"
        clearable
        comboboxProps={{ withinPortal: true }}
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
