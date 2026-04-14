import { Button, Group, Select, Stack, Switch, Text } from "@mantine/core";
import type {
  EnvironmentDefinition,
  ShaderGraphDocument
} from "@sugarmagic/domain";
import { getLightingPresetOptions } from "@sugarmagic/runtime-core";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

export interface EnvironmentWorkspaceViewProps {
  selectedEnvironment: EnvironmentDefinition | null;
  boundRegionNames: string[];
  shaderDefinitions: ShaderGraphDocument[];
  onSelectLightingPreset: (preset: EnvironmentDefinition["lighting"]["preset"]) => void;
  onAddPostProcessShader: (shaderDefinitionId: string) => void;
  onTogglePostProcessShader: (shaderDefinitionId: string, enabled: boolean) => void;
  onRemovePostProcessShader: (shaderDefinitionId: string) => void;
}

export function useEnvironmentWorkspaceView(
  props: EnvironmentWorkspaceViewProps
): WorkspaceViewContribution {
  const {
    selectedEnvironment,
    boundRegionNames,
    shaderDefinitions,
    onSelectLightingPreset,
    onAddPostProcessShader,
    onTogglePostProcessShader,
    onRemovePostProcessShader
  } = props;

  return {
    leftPanel: null,
    rightPanel: (
      <Inspector
        selectionLabel={selectedEnvironment?.displayName ?? null}
        selectionIcon="🌅"
      >
        {selectedEnvironment ? (
          <Stack gap="md">
            <Select
              label="Light Preset"
              data={getLightingPresetOptions()}
              value={selectedEnvironment.lighting.preset}
              onChange={(value) => {
                if (!value) return;
                onSelectLightingPreset(
                  value as EnvironmentDefinition["lighting"]["preset"]
                );
              }}
              size="xs"
              styles={{
                label: {
                  color: "var(--sm-color-subtext)",
                  fontSize: "var(--sm-font-size-sm)",
                  marginBottom: 4
                },
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

            <Stack gap={4}>
              <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
                Bound Regions
              </Text>
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
            <Stack gap="xs">
              <Text size="xs" fw={600} c="var(--sm-color-subtext)" tt="uppercase">
                Post Process Chain
              </Text>
              <Select
                placeholder="Add post-process shader..."
                size="xs"
                data={shaderDefinitions
                  .filter((definition) => definition.targetKind === "post-process")
                  .map((definition) => ({
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
              {selectedEnvironment.postProcessShaders.length > 0 ? (
                selectedEnvironment.postProcessShaders
                  .slice()
                  .sort((left, right) => left.order - right.order)
                  .map((binding) => {
                    const definition =
                      shaderDefinitions.find(
                        (candidate) =>
                          candidate.shaderDefinitionId === binding.shaderDefinitionId
                      ) ?? null;
                    return (
                      <Group
                        key={binding.shaderDefinitionId}
                        justify="space-between"
                        align="center"
                        wrap="nowrap"
                      >
                        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" truncate c="var(--sm-color-text)">
                            {definition?.displayName ?? binding.shaderDefinitionId}
                          </Text>
                          <Text size="xs" c="var(--sm-color-overlay0)">
                            Order {binding.order}
                          </Text>
                        </Stack>
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
                      </Group>
                    );
                  })
              ) : (
                <Text size="xs" c="var(--sm-color-overlay0)">
                  No post-process shaders bound to this environment.
                </Text>
              )}
            </Stack>
          </Stack>
        ) : (
          <Text size="xs" c="var(--sm-color-overlay0)">
            Select or create an environment to edit its light preset.
          </Text>
        )}
      </Inspector>
    ),
    viewportOverlay: null
  };
}
