/**
 * Environment workspace inspector.
 *
 * Owns Build-mode authoring controls for the canonical EnvironmentDefinition:
 * explicit lighting, fog, and the authored post-process stack. It does not
 * interpret environment semantics itself; it only edits the one persisted
 * source of truth through callbacks supplied by the Build host.
 */

import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text
} from "@mantine/core";
import type {
  EnvironmentDefinition,
  PostProcessShaderBinding,
  ShaderGraphDocument,
  ShaderParameter,
  ShaderParameterOverride,
  ShaderParameterValue
} from "@sugarmagic/domain";
import { createBuiltInFogTintShaderId } from "@sugarmagic/domain";
import { getLightingPresetOptions } from "@sugarmagic/runtime-core";
import { ColorField, Inspector, PanelSection } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

const ENVIRONMENT_SWATCHES = [
  "#fff2d9",
  "#ffd59e",
  "#ffb86c",
  "#f38ba8",
  "#89dceb",
  "#74c7ec",
  "#94e2d5",
  "#a6e3a1",
  "#cdd6f4",
  "#6c7086",
  "#313244",
  "#11111b"
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colorNumberToVec3(value: number): [number, number, number] {
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255
  ];
}

function vec3ToColorNumber(value: ShaderParameterValue | null): number {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every((channel) => typeof channel === "number" && Number.isFinite(channel))
  ) {
    return (
      (Math.round(clampNumber(value[0] ?? 0, 0, 1) * 255) << 16) |
      (Math.round(clampNumber(value[1] ?? 0, 0, 1) * 255) << 8) |
      Math.round(clampNumber(value[2] ?? 0, 0, 1) * 255)
    );
  }

  return 0xffffff;
}

function getParameterOverrideValue(
  binding: PostProcessShaderBinding,
  parameter: ShaderParameter
): ShaderParameterValue {
  return (
    binding.parameterOverrides.find(
      (override) => override.parameterId === parameter.parameterId
    )?.value ?? parameter.defaultValue
  );
}

function reorderBindings(
  bindings: PostProcessShaderBinding[],
  shaderDefinitionId: string,
  direction: -1 | 1
): PostProcessShaderBinding[] {
  const sorted = bindings
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((binding) => ({ ...binding, parameterOverrides: [...binding.parameterOverrides] }));
  const currentIndex = sorted.findIndex(
    (binding) => binding.shaderDefinitionId === shaderDefinitionId
  );
  const nextIndex = currentIndex + direction;

  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= sorted.length
  ) {
    return sorted;
  }

  const [moved] = sorted.splice(currentIndex, 1);
  sorted.splice(nextIndex, 0, moved!);
  return sorted.map((binding, index) => ({ ...binding, order: index }));
}

function LightDirectionPreview(props: { azimuthDeg: number; elevationDeg: number; color: number }) {
  const { azimuthDeg, elevationDeg, color } = props;
  const radius = 28;
  const radians = ((azimuthDeg - 90) * Math.PI) / 180;
  const distance = radius * (1 - clampNumber((elevationDeg + 90) / 180, 0, 1) * 0.7);
  const x = 36 + Math.cos(radians) * distance;
  const y = 36 + Math.sin(radians) * distance;

  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="var(--sm-color-subtext)">
        Direction Preview
      </Text>
      <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="Sun direction preview">
        <circle
          cx="36"
          cy="36"
          r="28"
          fill="none"
          stroke="var(--sm-panel-border)"
          strokeWidth="2"
        />
        <line x1="36" y1="8" x2="36" y2="64" stroke="var(--sm-panel-border)" strokeDasharray="2 3" />
        <line x1="8" y1="36" x2="64" y2="36" stroke="var(--sm-panel-border)" strokeDasharray="2 3" />
        <circle
          cx={x}
          cy={y}
          r="6"
          fill={`#${color.toString(16).padStart(6, "0")}`}
          stroke="white"
          strokeWidth="2"
        />
      </svg>
    </Stack>
  );
}

function SliderNumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  onChange: (value: number) => void;
}) {
  const { label, value, min, max, step, precision, onChange } = props;

  return (
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text size="xs" fw={600} c="var(--sm-color-subtext)">
          {label}
        </Text>
        <NumberInput
          value={value}
          onChange={(next) => {
            if (typeof next === "number" && Number.isFinite(next)) {
              onChange(clampNumber(next, min, max));
            }
          }}
          min={min}
          max={max}
          step={step}
          decimalScale={precision}
          size="xs"
          w={96}
        />
      </Group>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(next) => onChange(next)}
      />
    </Stack>
  );
}

function PostProcessParameterField(props: {
  binding: PostProcessShaderBinding;
  parameter: ShaderParameter;
  onChange: (override: ShaderParameterOverride) => void;
}) {
  const { binding, parameter, onChange } = props;
  const value = getParameterOverrideValue(binding, parameter);

  if (parameter.dataType === "color") {
    return (
      <ColorField
        label={parameter.displayName}
        value={vec3ToColorNumber(value)}
        onChange={(next) =>
          onChange({
            parameterId: parameter.parameterId,
            value: colorNumberToVec3(next)
          })
        }
        swatches={ENVIRONMENT_SWATCHES}
      />
    );
  }

  if (parameter.dataType === "float" && typeof value === "number") {
    return (
      <NumberInput
        label={parameter.displayName}
        value={value}
        onChange={(next) => {
          if (typeof next === "number" && Number.isFinite(next)) {
            onChange({ parameterId: parameter.parameterId, value: next });
          }
        }}
        size="xs"
      />
    );
  }

  return (
    <Text size="xs" c="var(--sm-color-overlay0)">
      {parameter.displayName}: unsupported parameter type `{parameter.dataType}`
    </Text>
  );
}

export interface EnvironmentWorkspaceViewProps {
  projectId: string;
  selectedEnvironment: EnvironmentDefinition | null;
  boundRegionNames: string[];
  shaderDefinitions: ShaderGraphDocument[];
  onSelectLightingPreset: (preset: EnvironmentDefinition["lighting"]["preset"]) => void;
  onUpdateEnvironmentDefinition: (definition: EnvironmentDefinition) => void;
  onAddPostProcessShader: (shaderDefinitionId: string) => void;
  onUpdatePostProcessShaderParameter: (
    shaderDefinitionId: string,
    override: ShaderParameterOverride
  ) => void;
  onTogglePostProcessShader: (shaderDefinitionId: string, enabled: boolean) => void;
  onRemovePostProcessShader: (shaderDefinitionId: string) => void;
}

export function useEnvironmentWorkspaceView(
  props: EnvironmentWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    projectId,
    selectedEnvironment,
    boundRegionNames,
    shaderDefinitions,
    onSelectLightingPreset,
    onUpdateEnvironmentDefinition,
    onAddPostProcessShader,
    onUpdatePostProcessShaderParameter,
    onTogglePostProcessShader,
    onRemovePostProcessShader
  } = props;

  const fogShaderDefinitionId = createBuiltInFogTintShaderId(projectId);
  const postProcessDefinitions = shaderDefinitions.filter(
    (definition) => definition.targetKind === "post-process"
  );
  const addablePostProcessDefinitions = postProcessDefinitions.filter(
    (definition) => definition.shaderDefinitionId !== fogShaderDefinitionId
  );

  const updateDefinition = (updater: (definition: EnvironmentDefinition) => EnvironmentDefinition) => {
    if (!selectedEnvironment) {
      return;
    }
    onUpdateEnvironmentDefinition(updater(selectedEnvironment));
  };

  const postProcessBindings = selectedEnvironment
    ? selectedEnvironment.postProcessShaders
        .slice()
        .sort((left, right) => left.order - right.order)
    : [];

  return {
    leftPanel: null,
    rightPanel: (
      <Inspector
        selectionLabel={selectedEnvironment?.displayName ?? null}
        selectionIcon="🌅"
      >
        {selectedEnvironment ? (
          <Stack gap="md">
            <PanelSection title="Preset" icon="🌇">
              <Select
                label="Lighting Template"
                data={getLightingPresetOptions()}
                value={selectedEnvironment.lighting.preset}
                onChange={(value) => {
                  if (!value) return;
                  onSelectLightingPreset(
                    value as EnvironmentDefinition["lighting"]["preset"]
                  );
                }}
                size="xs"
              />
            </PanelSection>

            <PanelSection title="Sun" icon="☀️">
              <Stack gap="md">
                <LightDirectionPreview
                  azimuthDeg={selectedEnvironment.lighting.sun.azimuthDeg}
                  elevationDeg={selectedEnvironment.lighting.sun.elevationDeg}
                  color={selectedEnvironment.lighting.sun.color}
                />
                <SliderNumberField
                  label="Azimuth"
                  value={selectedEnvironment.lighting.sun.azimuthDeg}
                  min={0}
                  max={360}
                  step={1}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        sun: {
                          ...definition.lighting.sun,
                          azimuthDeg: value
                        }
                      }
                    }))
                  }
                />
                <SliderNumberField
                  label="Elevation"
                  value={selectedEnvironment.lighting.sun.elevationDeg}
                  min={-90}
                  max={90}
                  step={1}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        sun: {
                          ...definition.lighting.sun,
                          elevationDeg: value
                        }
                      }
                    }))
                  }
                />
                <ColorField
                  label="Sun Color"
                  value={selectedEnvironment.lighting.sun.color}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        sun: {
                          ...definition.lighting.sun,
                          color: value
                        }
                      }
                    }))
                  }
                  swatches={ENVIRONMENT_SWATCHES}
                />
                <SliderNumberField
                  label="Intensity"
                  value={selectedEnvironment.lighting.sun.intensity}
                  min={0}
                  max={4}
                  step={0.01}
                  precision={2}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        sun: {
                          ...definition.lighting.sun,
                          intensity: value
                        }
                      }
                    }))
                  }
                />
                <Switch
                  label="Cast Shadows"
                  checked={selectedEnvironment.lighting.sun.castShadows}
                  onChange={(event) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        sun: {
                          ...definition.lighting.sun,
                          castShadows: event.currentTarget.checked
                        }
                      }
                    }))
                  }
                />
              </Stack>
            </PanelSection>

            <PanelSection title="Rim Light" icon="💡">
              <Stack gap="md">
                <Switch
                  label="Enable Rim Light"
                  checked={selectedEnvironment.lighting.rim !== null}
                  onChange={(event) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        rim: event.currentTarget.checked
                          ? definition.lighting.rim ?? {
                              azimuthDeg: 40,
                              elevationDeg: 18,
                              color: 0x8ab4ff,
                              intensity: 0.2
                            }
                          : null
                      }
                    }))
                  }
                />
                {selectedEnvironment.lighting.rim ? (
                  <>
                    <SliderNumberField
                      label="Azimuth"
                      value={selectedEnvironment.lighting.rim.azimuthDeg}
                      min={0}
                      max={360}
                      step={1}
                      onChange={(value) =>
                        updateDefinition((definition) => ({
                          ...definition,
                          lighting: {
                            ...definition.lighting,
                            rim: definition.lighting.rim
                              ? {
                                  ...definition.lighting.rim,
                                  azimuthDeg: value
                                }
                              : null
                          }
                        }))
                      }
                    />
                    <SliderNumberField
                      label="Elevation"
                      value={selectedEnvironment.lighting.rim.elevationDeg}
                      min={-90}
                      max={90}
                      step={1}
                      onChange={(value) =>
                        updateDefinition((definition) => ({
                          ...definition,
                          lighting: {
                            ...definition.lighting,
                            rim: definition.lighting.rim
                              ? {
                                  ...definition.lighting.rim,
                                  elevationDeg: value
                                }
                              : null
                          }
                        }))
                      }
                    />
                    <ColorField
                      label="Rim Color"
                      value={selectedEnvironment.lighting.rim.color}
                      onChange={(value) =>
                        updateDefinition((definition) => ({
                          ...definition,
                          lighting: {
                            ...definition.lighting,
                            rim: definition.lighting.rim
                              ? {
                                  ...definition.lighting.rim,
                                  color: value
                                }
                              : null
                          }
                        }))
                      }
                      swatches={ENVIRONMENT_SWATCHES}
                    />
                    <SliderNumberField
                      label="Intensity"
                      value={selectedEnvironment.lighting.rim.intensity}
                      min={0}
                      max={2}
                      step={0.01}
                      precision={2}
                      onChange={(value) =>
                        updateDefinition((definition) => ({
                          ...definition,
                          lighting: {
                            ...definition.lighting,
                            rim: definition.lighting.rim
                              ? {
                                  ...definition.lighting.rim,
                                  intensity: value
                                }
                              : null
                          }
                        }))
                      }
                    />
                  </>
                ) : null}
              </Stack>
            </PanelSection>

            <PanelSection title="Ambient" icon="🌤️">
              <Stack gap="md">
                <Select
                  label="Mode"
                  size="xs"
                  data={[
                    { value: "sky-driven", label: "Sky Driven" },
                    { value: "flat", label: "Flat" }
                  ]}
                  value={selectedEnvironment.lighting.ambient.mode}
                  onChange={(value) => {
                    if (!value) return;
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        ambient: {
                          ...definition.lighting.ambient,
                          mode: value as EnvironmentDefinition["lighting"]["ambient"]["mode"]
                        }
                      }
                    }));
                  }}
                />
                {selectedEnvironment.lighting.ambient.mode === "flat" ? (
                  <ColorField
                    label="Ambient Color"
                    value={selectedEnvironment.lighting.ambient.color}
                    onChange={(value) =>
                      updateDefinition((definition) => ({
                        ...definition,
                        lighting: {
                          ...definition.lighting,
                          ambient: {
                            ...definition.lighting.ambient,
                            color: value
                          }
                        }
                      }))
                    }
                    swatches={ENVIRONMENT_SWATCHES}
                  />
                ) : (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    Ambient fill derives from the sky gradient in sky-driven mode.
                  </Text>
                )}
                <SliderNumberField
                  label="Intensity"
                  value={selectedEnvironment.lighting.ambient.intensity}
                  min={0}
                  max={2}
                  step={0.01}
                  precision={2}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      lighting: {
                        ...definition.lighting,
                        ambient: {
                          ...definition.lighting.ambient,
                          intensity: value
                        }
                      }
                    }))
                  }
                />
              </Stack>
            </PanelSection>

            <PanelSection title="Fog" icon="🌫️">
              <Stack gap="md">
                <Switch
                  label="Enable Fog"
                  checked={selectedEnvironment.atmosphere.fog.enabled}
                  onChange={(event) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      atmosphere: {
                        ...definition.atmosphere,
                        fog: {
                          ...definition.atmosphere.fog,
                          enabled: event.currentTarget.checked
                        }
                      }
                    }))
                  }
                />
                <ColorField
                  label="Fog Color"
                  value={selectedEnvironment.atmosphere.fog.color}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      atmosphere: {
                        ...definition.atmosphere,
                        fog: {
                          ...definition.atmosphere.fog,
                          color: value
                        }
                      }
                    }))
                  }
                  swatches={ENVIRONMENT_SWATCHES}
                />
                <SliderNumberField
                  label="Density"
                  value={selectedEnvironment.atmosphere.fog.density}
                  min={0}
                  max={0.05}
                  step={0.0005}
                  precision={4}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      atmosphere: {
                        ...definition.atmosphere,
                        fog: {
                          ...definition.atmosphere.fog,
                          density: value
                        }
                      }
                    }))
                  }
                />
                <SliderNumberField
                  label="Height Falloff"
                  value={selectedEnvironment.atmosphere.fog.heightFalloff}
                  min={0}
                  max={4}
                  step={0.01}
                  precision={2}
                  onChange={(value) =>
                    updateDefinition((definition) => ({
                      ...definition,
                      atmosphere: {
                        ...definition.atmosphere,
                        fog: {
                          ...definition.atmosphere.fog,
                          heightFalloff: value
                        }
                      }
                    }))
                  }
                />
              </Stack>
            </PanelSection>

            <PanelSection title="Post Process Stack" icon="🎞️">
              <Stack gap="md">
                <Select
                  placeholder="Add post-process shader..."
                  size="xs"
                  data={addablePostProcessDefinitions.map((definition) => ({
                    value: definition.shaderDefinitionId,
                    label: definition.displayName
                  }))}
                  value={null}
                  onChange={(value) => {
                    if (value) {
                      onAddPostProcessShader(value);
                    }
                  }}
                />
                {postProcessBindings.length > 0 ? (
                  postProcessBindings.map((binding, index) => {
                    const definition =
                      postProcessDefinitions.find(
                        (candidate) =>
                          candidate.shaderDefinitionId === binding.shaderDefinitionId
                      ) ?? null;
                    const isFogBinding =
                      binding.shaderDefinitionId === fogShaderDefinitionId;
                    return (
                      <Stack
                        key={binding.shaderDefinitionId}
                        gap="xs"
                        p="xs"
                        style={{
                          border: "1px solid var(--sm-panel-border)",
                          borderRadius: 8,
                          background: "var(--sm-color-surface0)"
                        }}
                      >
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={600} c="var(--sm-color-text)" truncate>
                              {definition?.displayName ?? binding.shaderDefinitionId}
                            </Text>
                            <Group gap="xs">
                              <Text size="xs" c="var(--sm-color-overlay0)">
                                Order {binding.order}
                              </Text>
                              {isFogBinding ? (
                                <Text size="xs" c="var(--sm-color-subtext)">
                                  Linked to fog
                                </Text>
                              ) : null}
                            </Group>
                          </Stack>
                          <Group gap={4} wrap="nowrap">
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              disabled={index === 0}
                              onClick={() =>
                                updateDefinition((definition) => ({
                                  ...definition,
                                  postProcessShaders: reorderBindings(
                                    definition.postProcessShaders,
                                    binding.shaderDefinitionId,
                                    -1
                                  )
                                }))
                              }
                            >
                              ↑
                            </ActionIcon>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              disabled={index === postProcessBindings.length - 1}
                              onClick={() =>
                                updateDefinition((definition) => ({
                                  ...definition,
                                  postProcessShaders: reorderBindings(
                                    definition.postProcessShaders,
                                    binding.shaderDefinitionId,
                                    1
                                  )
                                }))
                              }
                            >
                              ↓
                            </ActionIcon>
                            <Switch
                              checked={binding.enabled}
                              onChange={(event) =>
                                onTogglePostProcessShader(
                                  binding.shaderDefinitionId,
                                  event.currentTarget.checked
                                )
                              }
                              size="xs"
                            />
                            {!isFogBinding ? (
                              <Button
                                size="compact-xs"
                                color="red"
                                variant="subtle"
                                onClick={() =>
                                  onRemovePostProcessShader(binding.shaderDefinitionId)
                                }
                              >
                                Remove
                              </Button>
                            ) : null}
                          </Group>
                        </Group>
                        {definition?.parameters.length ? (
                          <Stack gap="xs">
                            {definition.parameters.map((parameter) => (
                              <PostProcessParameterField
                                key={parameter.parameterId}
                                binding={binding}
                                parameter={parameter}
                                onChange={(override) =>
                                  onUpdatePostProcessShaderParameter(
                                    binding.shaderDefinitionId,
                                    override
                                  )
                                }
                              />
                            ))}
                          </Stack>
                        ) : (
                          <Text size="xs" c="var(--sm-color-overlay0)">
                            No parameters.
                          </Text>
                        )}
                      </Stack>
                    );
                  })
                ) : (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    No post-process shaders bound to this environment.
                  </Text>
                )}
              </Stack>
            </PanelSection>

            <PanelSection title="Bound Regions" icon="🗺️">
              <Stack gap={4}>
                {boundRegionNames.length > 0 ? (
                  boundRegionNames.map((regionName) => (
                    <Text key={regionName} size="xs" c="var(--sm-color-text)">
                      {regionName}
                    </Text>
                  ))
                ) : (
                  <Text size="xs" c="var(--sm-color-overlay0)">
                    No regions are currently bound to this environment.
                  </Text>
                )}
              </Stack>
            </PanelSection>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select or create an environment to edit its lighting and post-process stack.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}
