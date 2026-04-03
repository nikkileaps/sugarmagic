import type { DiscoveredPluginDefinition } from "../../sdk";

export const HELLO_PLUGIN_ID = "hello";

export interface HelloPluginConfig {
  message: string;
}

export function normalizeHelloPluginConfig(
  config: Record<string, unknown> | null | undefined
): HelloPluginConfig {
  return {
    message: typeof config?.message === "string" ? config.message : "Hello"
  };
}

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: HELLO_PLUGIN_ID,
    displayName: "Hello",
    summary: "Hello World test plugin",
    capabilityIds: ["design.workspace", "runtime.banner"]
  },
  defaultConfig: {
    message: "Hello"
  },
  runtime: {
    createRuntimePlugin: ({ configuration }) => {
      const hello = normalizeHelloPluginConfig(configuration.config);
      const trimmedMessage = hello.message.trim();

      return {
        pluginId: configuration.pluginId,
        displayName: "Hello",
        contributions: trimmedMessage
          ? [
              {
                pluginId: configuration.pluginId,
                contributionId: "hello.runtime-banner",
                kind: "runtime.banner",
                displayName: "Hello Runtime Banner",
                priority: 10,
                payload: {
                  message: trimmedMessage,
                  placement: "top-center",
                  tone: "info"
                }
              }
            ]
          : [],
        serializeState: () => ({ enabled: configuration.enabled })
      };
    }
  },
  shell: {
    designWorkspaces: [
      {
        pluginId: HELLO_PLUGIN_ID,
        workspaceKind: HELLO_PLUGIN_ID,
        label: "Hello",
        icon: "👋",
        summary: "Simple plugin workspace that binds a message to a runtime banner."
      }
    ]
  }
};
