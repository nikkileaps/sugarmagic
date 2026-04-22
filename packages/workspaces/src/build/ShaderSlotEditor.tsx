/**
 * Build-mode shader slot editor.
 *
 * Owns editor-facing slot authoring UI for asset and presence inspectors. It
 * depends on domain shader documents, so it lives in workspaces rather than
 * the lower-level UI package.
 */

import { Fragment, useMemo } from "react";
import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import type {
  ShaderGraphDocument,
  ShaderParameterOverride,
  ShaderParameterValue,
  ShaderSlotBindingMap,
  ShaderSlotKind
} from "@sugarmagic/domain";
import { SHADER_SLOT_KINDS } from "@sugarmagic/domain";
import { ColorField, HDRColorField } from "@sugarmagic/ui";
import type { ShaderBindingResolutionDiagnostic } from "@sugarmagic/runtime-core";

const SLOT_LABELS: Record<ShaderSlotKind, string> = {
  surface: "Surface",
  deform: "Deform",
  effect: "Effect"
};

const SLOT_TARGET_KINDS: Record<ShaderSlotKind, ShaderGraphDocument["targetKind"]> = {
  surface: "mesh-surface",
  deform: "mesh-deform",
  effect: "mesh-effect"
};

function parameterValueForSlot(
  slot: ShaderSlotKind,
  parameterId: string,
  overrides: ShaderParameterOverride[]
): ShaderParameterValue | null {
  const slotOverride = overrides.find(
    (override) => override.parameterId === parameterId && override.slot === slot
  );
  if (slotOverride) {
    return slotOverride.value;
  }
  const legacyOverride = overrides.find(
    (override) => override.parameterId === parameterId && override.slot === undefined
  );
  return legacyOverride?.value ?? null;
}

export interface ShaderSlotEditorProps {
  bindings: ShaderSlotBindingMap;
  shaderDefinitions: ShaderGraphDocument[];
  slots?: readonly ShaderSlotKind[];
  parameterOverrides?: ShaderParameterOverride[];
  diagnostics?: ShaderBindingResolutionDiagnostic[];
  onChangeBinding: (slot: ShaderSlotKind, shaderDefinitionId: string | null) => void;
  onChangeParameterOverride?: (
    slot: ShaderSlotKind,
    override: ShaderParameterOverride
  ) => void;
  onClearParameterOverride?: (slot: ShaderSlotKind, parameterId: string) => void;
  onEditShaderGraph?: (shaderDefinitionId: string) => void;
}

export function ShaderSlotEditor({
  bindings,
  shaderDefinitions,
  slots = SHADER_SLOT_KINDS,
  parameterOverrides = [],
  diagnostics = [],
  onChangeBinding,
  onChangeParameterOverride,
  onClearParameterOverride,
  onEditShaderGraph
}: ShaderSlotEditorProps) {
  const definitionsById = useMemo(
    () =>
      new Map(shaderDefinitions.map((definition) => [definition.shaderDefinitionId, definition])),
    [shaderDefinitions]
  );

  return (
    <Stack gap="md">
      {slots.map((slot) => {
        const currentShaderId = bindings[slot] ?? null;
        const currentShader = currentShaderId ? definitionsById.get(currentShaderId) ?? null : null;
        const availableDefinitions = shaderDefinitions.filter(
          (definition) => definition.targetKind === SLOT_TARGET_KINDS[slot]
        );
        const slotDiagnostics = diagnostics.filter((diagnostic) => diagnostic.slot === slot);

        return (
          <Stack key={slot} gap="xs">
            <Group justify="space-between" align="center">
              <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
                {SLOT_LABELS[slot]}
              </Text>
              {currentShader && onEditShaderGraph ? (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => onEditShaderGraph(currentShader.shaderDefinitionId)}
                >
                  Edit Shader Graph
                </Button>
              ) : null}
            </Group>
            <Select
              size="xs"
              data={[
                { value: "__none__", label: "No Shader" },
                ...availableDefinitions.map((definition) => ({
                  value: definition.shaderDefinitionId,
                  label: definition.displayName
                }))
              ]}
              value={currentShaderId ?? "__none__"}
              onChange={(value) =>
                onChangeBinding(slot, value && value !== "__none__" ? value : null)
              }
            />
            {slotDiagnostics.length > 0 ? (
              <Stack gap={2}>
                {slotDiagnostics.map((diagnostic) => (
                  <Text key={`${slot}:${diagnostic.shaderDefinitionId ?? "none"}:${diagnostic.message}`} size="xs" c="red">
                    {diagnostic.message}
                  </Text>
                ))}
              </Stack>
            ) : null}
            {currentShader && onChangeParameterOverride ? (
              <Stack gap="xs">
                {currentShader.parameters.map((parameter) => {
                  const overrideValue = parameterValueForSlot(
                    slot,
                    parameter.parameterId,
                    parameterOverrides
                  );
                  const value = overrideValue ?? parameter.defaultValue;

                  if (parameter.dataType === "color" && Array.isArray(value) && value.length === 3) {
                    const field =
                      parameter.colorSpace === "hdr" ? (
                        <HDRColorField
                          label={parameter.displayName}
                          value={value as [number, number, number]}
                          onChange={(next) =>
                            onChangeParameterOverride(slot, {
                              parameterId: parameter.parameterId,
                              slot,
                              value: next
                            })
                          }
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
                            onChangeParameterOverride(slot, {
                              parameterId: parameter.parameterId,
                              slot,
                              value: [
                                ((next >> 16) & 0xff) / 255,
                                ((next >> 8) & 0xff) / 255,
                                (next & 0xff) / 255
                              ]
                            })
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
                            onChangeParameterOverride(slot, {
                              parameterId: parameter.parameterId,
                              slot,
                              value: next
                            });
                          }
                        }}
                      />
                    );
                  }

                  if (
                    parameter.dataType === "vec2" &&
                    Array.isArray(value) &&
                    value.length === 2
                  ) {
                    return (
                      <Group key={parameter.parameterId} grow>
                        <NumberInput
                          label={`${parameter.displayName} X`}
                          size="xs"
                          value={value[0]}
                          onChange={(next) => {
                            if (typeof next === "number" && Number.isFinite(next)) {
                              onChangeParameterOverride(slot, {
                                parameterId: parameter.parameterId,
                                slot,
                                value: [next, value[1]]
                              });
                            }
                          }}
                        />
                        <NumberInput
                          label={`${parameter.displayName} Y`}
                          size="xs"
                          value={value[1]}
                          onChange={(next) => {
                            if (typeof next === "number" && Number.isFinite(next)) {
                              onChangeParameterOverride(slot, {
                                parameterId: parameter.parameterId,
                                slot,
                                value: [value[0], next]
                              });
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
                {onClearParameterOverride ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      for (const parameter of currentShader.parameters) {
                        onClearParameterOverride(slot, parameter.parameterId);
                      }
                    }}
                  >
                    Reset Slot Parameters
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}
