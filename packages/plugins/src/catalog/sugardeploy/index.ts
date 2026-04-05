import type { DiscoveredPluginDefinition } from "../../sdk";

export const SUGARDEPLOY_PLUGIN_ID = "sugardeploy";

export const pluginDefinition: DiscoveredPluginDefinition = {
  manifest: {
    pluginId: SUGARDEPLOY_PLUGIN_ID,
    displayName: "SugarDeploy",
    summary:
      "Deployment plugin that plans targets, fulfills requirements, and manages generated deployment files.",
    capabilityIds: ["design.workspace", "deployment.plugin"]
  },
  defaultConfig: {},
  shell: {
    designWorkspaces: [
      {
        pluginId: SUGARDEPLOY_PLUGIN_ID,
        workspaceKind: SUGARDEPLOY_PLUGIN_ID,
        label: "SugarDeploy",
        icon: "🚀",
        summary: "Plan deployment targets, inspect requirement fulfillment, and manage generated deployment surfaces."
      }
    ]
  }
};
