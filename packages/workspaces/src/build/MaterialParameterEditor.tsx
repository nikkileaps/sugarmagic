/**
 * MaterialParameterEditor
 *
 * Renders the parameter and texture-binding controls for a single material
 * against its parent shader graph. This keeps MaterialDefinition editing in
 * one reusable place so the Build Material Library stays the single UI
 * enforcer for "shader graph + parameter snapshot" authoring.
 */

import { Fragment } from "react";
import { Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type {
  MaterialDefinition,
  ShaderGraphDocument,
  ShaderParameter,
  ShaderParameterValue,
  TextureDefinition
} from "@sugarmagic/domain";
import { ColorField, HDRColorField } from "@sugarmagic/ui";

function parameterValueForMaterial(
  materialDefinition: MaterialDefinition,
  parameter: ShaderParameter
): ShaderParameterValue {
  const overrideValue = materialDefinition.parameterValues[parameter.parameterId];
  return (overrideValue as ShaderParameterValue | undefined) ?? parameter.defaultValue;
}

function textureOptionLabel(definition: TextureDefinition): string {
  return `${definition.displayName} (${definition.packing}, ${definition.colorSpace})`;
}

function textureMatchesRole(
  definition: TextureDefinition,
  role: ShaderParameter["textureRole"]
): boolean {
  if (!role) {
    return true;
  }
  if (role === "color") {
    return definition.colorSpace === "srgb";
  }
  if (role === "normal") {
    return definition.packing === "normal";
  }
  return definition.colorSpace === "linear";
}

export interface MaterialParameterEditorProps {
  materialDefinition: MaterialDefinition;
  shaderDefinition: ShaderGraphDocument | null;
  textureDefinitions: TextureDefinition[];
  onChangeParameterValue: (
    parameter: ShaderParameter,
    value: ShaderParameterValue | null
  ) => void;
  onChangeTextureBinding: (
    parameter: ShaderParameter,
    textureDefinitionId: string | null
  ) => void;
}

export function MaterialParameterEditor({
  materialDefinition,
  shaderDefinition,
  textureDefinitions,
  onChangeParameterValue,
  onChangeTextureBinding
}: MaterialParameterEditorProps) {
  if (!shaderDefinition) {
    return (
      <Text size="xs" c="red">
        This material references a missing parent shader.
      </Text>
    );
  }

  if (shaderDefinition.parameters.length === 0) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        The parent shader has no authored parameters.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {shaderDefinition.parameters.map((parameter) => {
        const value = parameterValueForMaterial(materialDefinition, parameter);

        if (parameter.dataType === "texture2d") {
          const compatibleTextures = textureDefinitions.filter((definition) =>
            textureMatchesRole(definition, parameter.textureRole)
          );

          return (
            <Stack key={parameter.parameterId} gap={4}>
              <Text size="xs" fw={600} c="var(--sm-color-subtext)">
                {parameter.displayName}
              </Text>
              <Select
                size="xs"
                placeholder="Select texture..."
                data={[
                  { value: "__none__", label: "No Texture" },
                  ...compatibleTextures.map((definition) => ({
                    value: definition.definitionId,
                    label: textureOptionLabel(definition)
                  }))
                ]}
                value={
                  materialDefinition.textureBindings[parameter.parameterId] ?? "__none__"
                }
                onChange={(next) =>
                  onChangeTextureBinding(
                    parameter,
                    next && next !== "__none__" ? next : null
                  )
                }
                styles={{
                  input: {
                    background: "var(--sm-color-base)",
                    borderColor: "var(--sm-panel-border)",
                    color: "var(--sm-color-text)"
                  },
                  dropdown: {
                    background: "var(--sm-color-surface1)",
                    borderColor: "var(--sm-panel-border)"
                  },
                  option: {
                    color: "var(--sm-color-text)"
                  }
                }}
              />
              {parameter.textureRole ? (
                <Text size="xs" c="var(--sm-color-overlay0)">
                  Expected texture role: {parameter.textureRole}
                </Text>
              ) : null}
            </Stack>
          );
        }

        if (parameter.dataType === "color" && Array.isArray(value) && value.length === 3) {
          const field =
            parameter.colorSpace === "hdr" ? (
              <HDRColorField
                label={parameter.displayName}
                value={value as [number, number, number]}
                onChange={(next) => onChangeParameterValue(parameter, next)}
              />
            ) : (
              <ColorField
                label={parameter.displayName}
                value={
                  ((Math.round((value[0] ?? 0) * 255) & 0xff) << 16) |
                  ((Math.round((value[1] ?? 0) * 255) & 0xff) << 8) |
                  (Math.round((value[2] ?? 0) * 255) & 0xff)
                }
                onChange={(next) =>
                  onChangeParameterValue(parameter, [
                    ((next >> 16) & 0xff) / 255,
                    ((next >> 8) & 0xff) / 255,
                    (next & 0xff) / 255
                  ])
                }
              />
            );
          return <Fragment key={parameter.parameterId}>{field}</Fragment>;
        }

        if (parameter.dataType === "float" && typeof value === "number") {
          return (
            <NumberInput
              key={parameter.parameterId}
              label={parameter.displayName}
              size="xs"
              value={value}
              onChange={(next) => {
                if (typeof next === "number" && Number.isFinite(next)) {
                  onChangeParameterValue(parameter, next);
                }
              }}
            />
          );
        }

        if (parameter.dataType === "vec2" && Array.isArray(value) && value.length === 2) {
          return (
            <Group key={parameter.parameterId} grow>
              <NumberInput
                label={`${parameter.displayName} X`}
                size="xs"
                value={value[0]}
                onChange={(next) => {
                  if (typeof next === "number" && Number.isFinite(next)) {
                    onChangeParameterValue(parameter, [next, value[1]]);
                  }
                }}
              />
              <NumberInput
                label={`${parameter.displayName} Y`}
                size="xs"
                value={value[1]}
                onChange={(next) => {
                  if (typeof next === "number" && Number.isFinite(next)) {
                    onChangeParameterValue(parameter, [value[0], next]);
                  }
                }}
              />
            </Group>
          );
        }

        return (
          <Text key={parameter.parameterId} size="xs" c="var(--sm-color-overlay0)">
            {parameter.displayName}: unsupported parameter type `{parameter.dataType}`
          </Text>
        );
      })}
    </Stack>
  );
}
