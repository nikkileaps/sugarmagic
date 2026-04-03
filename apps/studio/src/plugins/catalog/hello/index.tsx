import { Stack, Text, TextInput } from "@mantine/core";
import { getPluginConfiguration } from "@sugarmagic/domain";
import {
  HELLO_PLUGIN_ID,
  ensureDiscoveredPluginConfiguration,
  normalizeHelloPluginConfig
} from "@sugarmagic/plugins";
import { Inspector } from "@sugarmagic/ui";
import type { StudioPluginWorkspaceDefinition } from "../../sdk";

export const pluginWorkspaceDefinition: StudioPluginWorkspaceDefinition = {
  pluginId: HELLO_PLUGIN_ID,
  workspaceKind: HELLO_PLUGIN_ID,
  createWorkspaceView(props) {
    const { gameProjectId, pluginConfigurations, onCommand } = props;

    const configuration = ensureDiscoveredPluginConfiguration(
      pluginConfigurations,
      HELLO_PLUGIN_ID,
      true
    );
    const hello = normalizeHelloPluginConfig(
      getPluginConfiguration(pluginConfigurations, HELLO_PLUGIN_ID)?.config ??
        configuration.config
    );

    function updateMessage(message: string) {
      if (!gameProjectId) return;
      onCommand({
        kind: "UpdatePluginConfiguration",
        target: {
          aggregateKind: "plugin-config",
          aggregateId: configuration.identity.id
        },
        subject: {
          subjectKind: "plugin-configuration",
          subjectId: configuration.identity.id
        },
        payload: {
          configuration: {
            ...configuration,
            enabled: true,
            config: {
              ...configuration.config,
              message
            }
          }
        }
      });
    }

    return {
      leftPanel: null,
      rightPanel: (
        <Inspector selectionLabel="hello">
          <Stack gap="xs">
            <Text size="sm" c="var(--sm-color-subtext)">
              This plugin contributes one shared runtime banner. The plugin runtime builds the message payload; the target only decides how to display it.
            </Text>
            <Text size="xs" c="var(--sm-color-overlay0)">
              Current message: {hello.message.trim() || "(empty)"}
            </Text>
          </Stack>
        </Inspector>
      ),
      centerPanel: (
        <Stack gap="lg" p="xl" h="100%" style={{ minHeight: 0 }}>
          <Stack gap={4}>
            <Text fw={700} size="lg">
              Hello Plugin
            </Text>
            <Text size="sm" c="var(--sm-color-subtext)">
              Type a message here and the enabled plugin will surface it in the running game as a shared runtime banner.
            </Text>
          </Stack>
          <TextInput
            label="Message"
            placeholder="Hello"
            value={hello.message}
            onChange={(event) => updateMessage(event.currentTarget.value)}
          />
        </Stack>
      ),
      viewportOverlay: null
    };
  }
};
