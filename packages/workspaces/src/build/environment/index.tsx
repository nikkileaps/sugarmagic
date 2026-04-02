import { Select, Stack, Text } from "@mantine/core";
import type { EnvironmentDefinition } from "@sugarmagic/domain";
import { getLightingPresetOptions } from "@sugarmagic/runtime-core";
import { Inspector } from "@sugarmagic/ui";
import type { WorkspaceViewContribution } from "../../workspace-view";

export interface EnvironmentWorkspaceViewProps {
  selectedEnvironment: EnvironmentDefinition | null;
  boundRegionNames: string[];
  onSelectLightingPreset: (preset: EnvironmentDefinition["lighting"]["preset"]) => void;
}

export function useEnvironmentWorkspaceView(
  props: EnvironmentWorkspaceViewProps
): WorkspaceViewContribution {
  const { selectedEnvironment, boundRegionNames, onSelectLightingPreset } = props;

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
