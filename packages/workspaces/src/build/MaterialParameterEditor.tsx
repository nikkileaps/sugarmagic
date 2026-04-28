/**
 * MaterialParameterEditor
 *
 * Renders parameter controls (color/float/vec2) for a shader graph's
 * authored parameters. Used by shader-backed surface layers. Texture
 * inputs are NOT edited here — texture parameters bake into the shader
 * definition itself (set via the shader inspector's `Texture` parameter
 * default). To customize a shader's textures, fork the shader in
 * Render > Shaders and edit the parameter defaults there.
 */

import { Fragment } from "react";
import { Group, NumberInput, Stack, Text } from "@mantine/core";
import type {
  ShaderGraphDocument,
  ShaderParameter,
  ShaderParameterValue
} from "@sugarmagic/domain";
import { ColorField, HDRColorField } from "@sugarmagic/ui";

function parameterValueForShader(
  parameterValues: Record<string, unknown>,
  parameter: ShaderParameter
): ShaderParameterValue {
  const overrideValue = parameterValues[parameter.parameterId];
  return (overrideValue as ShaderParameterValue | undefined) ?? parameter.defaultValue;
}

export interface MaterialParameterEditorProps {
  shaderDefinition: ShaderGraphDocument | null;
  parameterValues: Record<string, unknown>;
  onChangeParameterValue: (
    parameter: ShaderParameter,
    value: ShaderParameterValue | null
  ) => void;
}

export function MaterialParameterEditor({
  shaderDefinition,
  parameterValues,
  onChangeParameterValue
}: MaterialParameterEditorProps) {
  if (!shaderDefinition) {
    return (
      <Text size="xs" c="red">
        This material references a missing parent shader.
      </Text>
    );
  }

  const editableParameters = shaderDefinition.parameters.filter(
    (parameter) => parameter.dataType !== "texture2d"
  );

  if (editableParameters.length === 0) {
    return (
      <Text size="xs" c="var(--sm-color-overlay0)">
        The parent shader has no per-use editable parameters.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {editableParameters.map((parameter) => {
        const value = parameterValueForShader(parameterValues, parameter);

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
